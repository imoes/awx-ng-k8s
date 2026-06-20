"""
awx-ng Role Variable Extractor
================================
Scannt nach jedem Project-Sync die roles/*/defaults|vars/main.yml des Repos
und speichert die Top-Level-Keys als RoleVariable-Zeilen.

Delete + Re-Import per Rolle: Jede Rolle wird vollständig gelöscht und neu
eingelesen → keine veralteten Variablen, sauberer Slate.
"""

import logging
import re
import pathlib

import yaml

log = logging.getLogger("awx.customvars.extract")

# ── Sicherer YAML-Loader für Ansible-spezifische Tags ──────────────────────

class _AnsibleSafeLoader(yaml.SafeLoader):
    """
    Erweiterter SafeLoader der Ansible-Tags (!unsafe, !vault, beliebige
    unbekannte Tags) korrekt behandelt, anstatt eine Exception zu werfen.
    """

class _Unsafe(str):
    """Marker: Wert war mit !unsafe getaggt — Jinja darf diesen nicht templaten."""


def _construct_unsafe(loader, node):
    return _Unsafe(loader.construct_scalar(node))


def _construct_vault(loader, node):
    # !vault-Blöcke sind verschlüsselt und opak — niemals editieren
    return {"__vault__": True, "raw": loader.construct_scalar(node)}


def _construct_any(loader, tag_suffix, node):
    """Catch-all für unbekannte Tags → als String behandeln."""
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


_AnsibleSafeLoader.add_constructor("!unsafe", _construct_unsafe)
_AnsibleSafeLoader.add_constructor("!vault", _construct_vault)
_AnsibleSafeLoader.add_multi_constructor("", _construct_any)

JINJA_RE = re.compile(r"\{\{.*?\}\}")


def _load_yaml(path: pathlib.Path) -> dict | None:
    """Lädt eine YAML-Datei sicher; gibt None bei Fehler zurück."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        data = yaml.load(content, Loader=_AnsibleSafeLoader)
        if not isinstance(data, dict):
            log.warning("extract: %s ist kein Mapping — übersprungen", path)
            return None
        return data
    except yaml.YAMLError as exc:
        log.warning("extract: YAML-Fehler in %s: %s", path, exc)
        return None


def _value_type(val) -> str:
    if isinstance(val, _Unsafe):
        return "unsafe"
    if isinstance(val, dict) and val.get("__vault__"):
        return "vault"
    if isinstance(val, bool):
        return "bool"
    if isinstance(val, int):
        return "int"
    if isinstance(val, float):
        return "float"
    if isinstance(val, list):
        return "list"
    if isinstance(val, dict):
        return "dict"
    if val is None:
        return "null"
    return "str"


def _to_jsonable(val):
    """Wandelt Ansible-spezifische Typen in JSON-serialisierbare Werte um."""
    if isinstance(val, _Unsafe):
        return str(val)
    if isinstance(val, dict) and val.get("__vault__"):
        return {"__vault__": True}
    if isinstance(val, dict):
        return {k: _to_jsonable(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_to_jsonable(i) for i in val]
    return val


def _has_jinja(val) -> bool:
    """Prüft rekursiv ob ein Wert Jinja-Ausdrücke enthält."""
    if isinstance(val, (str, _Unsafe)):
        return bool(JINJA_RE.search(str(val)))
    if isinstance(val, dict):
        return any(_has_jinja(v) for v in val.values())
    if isinstance(val, list):
        return any(_has_jinja(i) for i in val)
    return False


def _schema_hint(val) -> dict:
    """Erzeugt einen simplen Schema-Hinweis für UI-Formular-Rendering."""
    vtype = _value_type(val)
    if vtype in ("unsafe", "vault"):
        return {"type": vtype, "readonly": True}
    if vtype == "bool":
        return {"type": "bool"}
    if vtype == "int":
        return {"type": "int"}
    if vtype == "float":
        return {"type": "float"}
    if vtype == "null":
        return {"type": "null"}
    if vtype == "list":
        item_hint = _schema_hint(val[0]) if val else {"type": "str"}
        return {"type": "list", "item": item_hint}
    if vtype == "dict":
        return {
            "type": "object",
            "properties": {k: _schema_hint(v) for k, v in list(val.items())[:20]},
        }
    # str — Jinja-Ausdrücke als expression markieren
    if JINJA_RE.search(str(val)):
        return {"type": "expression"}
    return {"type": "str"}


def extract_role(role_dir: pathlib.Path, project_id: int, revision: str) -> list[dict]:
    """
    Extrahiert alle Top-Level-Keys aus defaults/main.yml und vars/main.yml
    einer Rolle. Gibt eine Liste von Dicts zurück (ein Dict pro Variable).
    """
    results = []
    for source in ("defaults", "vars"):
        main_yml = role_dir / source / "main.yml"
        if not main_yml.is_file():
            continue
        data = _load_yaml(main_yml)
        if data is None:
            continue
        raw_text = main_yml.read_text(encoding="utf-8", errors="replace")
        for var_name, val in data.items():
            jsonable_val = _to_jsonable(val)
            results.append({
                "project_id": project_id,
                "role_name": role_dir.name,
                "var_name": var_name,
                "source": source,
                "value_type": _value_type(val),
                "default_value": jsonable_val,
                "schema_hint": _schema_hint(val),
                "raw_yaml": _extract_raw_block(raw_text, var_name),
                "has_jinja": _has_jinja(val),
                "comment": _extract_comment(raw_text, var_name),
                "scanned_revision": revision,
            })
    return results


def _extract_raw_block(text: str, key: str) -> str:
    """
    Best-effort: schneidet den YAML-Block für einen Top-Level-Key aus dem
    Dateitext heraus (für den Raw-YAML-Escape-Hatch im UI).
    """
    lines = text.splitlines()
    in_block = False
    block_lines = []
    key_prefix = key + ":"
    for line in lines:
        if line.startswith(key_prefix) or line == key:
            in_block = True
        elif in_block and line and not line[0].isspace() and not line.startswith("#"):
            break
        if in_block:
            block_lines.append(line)
    return "\n".join(block_lines)[:4096]  # max 4KB per Variable


def _extract_comment(text: str, key: str) -> str:
    """Extrahiert den führenden Kommentarblock vor einem Top-Level-Key."""
    lines = text.splitlines()
    comment_lines = []
    for i, line in enumerate(lines):
        if line.startswith(key + ":") or line == key:
            # Suche rückwärts nach Kommentarzeilen
            j = i - 1
            while j >= 0 and lines[j].strip().startswith("#"):
                comment_lines.insert(0, lines[j].strip().lstrip("#").strip())
                j -= 1
            break
    return "\n".join(comment_lines)


# ── Variable usage across a role ("where is this variable used") ─────────────

# Text file extensions we scan for variable usages inside a role.
_USAGE_TEXT_EXTS = {
    ".yml", ".yaml", ".j2", ".jinja2", ".conf", ".cfg", ".ini",
    ".cnf", ".sh", ".service", ".repo", ".list", ".old", ".txt", ".env",
}
_USAGE_YAML_EXTS = {".yml", ".yaml"}
_USAGE_MAX_FILE_BYTES = 256 * 1024
_USAGE_MAX_BLOCKS = 50


def _trim_block(lines: list[str], start: int, end: int) -> tuple[str, int, int]:
    """Slice lines[start:end] (0-based) and trim leading/trailing blank lines.
    Returns (text, line_start_1based, line_end_1based)."""
    s, e = start, max(start + 1, end)
    block = lines[s:e]
    # Trim trailing blanks
    while block and not block[-1].strip():
        block.pop()
        e -= 1
    # Trim leading blanks
    while block and not block[0].strip():
        block.pop(0)
        s += 1
    return "\n".join(block), s + 1, e


def find_variable_blocks(role_dir: pathlib.Path, var_name: str) -> list[dict]:
    """
    Find every block across a role that defines or references ``var_name``.

    Uses the YAML library to split task/handler/mapping files into blocks (line
    ranges from PyYAML node marks) and a line-based grep with context for
    non-YAML files (templates, configs). The variable is matched on word
    boundaries so ``foo`` does not match ``foobar``.

    Returns a list of dicts:
      {file, line_start, line_end, block, kind, is_definition}
    where ``file`` is role-relative and ``kind`` is one of
    definition | mapping | task | template.
    """
    pattern = re.compile(r"\b" + re.escape(var_name) + r"\b")
    results: list[dict] = []

    if not role_dir.is_dir():
        return results

    for path in sorted(role_dir.rglob("*")):
        if len(results) >= _USAGE_MAX_BLOCKS:
            break
        if not path.is_file() or path.suffix not in _USAGE_TEXT_EXTS:
            continue
        try:
            if path.stat().st_size > _USAGE_MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if not pattern.search(text):
            continue

        rel = str(path.relative_to(role_dir))
        lines = text.splitlines()
        file_blocks: list[dict] = []

        if path.suffix in _USAGE_YAML_EXTS:
            file_blocks = _yaml_blocks(text, lines, rel, var_name, pattern)

        # Fall back to grep when not YAML or when YAML parsing found nothing
        # (e.g. unparseable file that still references the variable).
        if not file_blocks:
            file_blocks = _grep_blocks(lines, rel, pattern)

        results.extend(file_blocks)

    # Definition blocks first, then by file path
    results.sort(key=lambda b: (not b["is_definition"], b["file"], b["line_start"]))
    return results[:_USAGE_MAX_BLOCKS]


def _yaml_blocks(text, lines, rel, var_name, pattern) -> list[dict]:
    """Split a YAML file into node blocks and keep those referencing the var."""
    try:
        root = yaml.compose(text, Loader=_AnsibleSafeLoader)
    except Exception:
        return []
    if root is None:
        return []

    blocks: list[dict] = []

    if isinstance(root, yaml.SequenceNode):
        # Task / handler list — each item is a task block
        for item in root.value:
            block, ls, le = _trim_block(lines, item.start_mark.line, item.end_mark.line)
            if block and pattern.search(block):
                blocks.append({
                    "file": rel, "line_start": ls, "line_end": le,
                    "block": block, "kind": "task", "is_definition": False,
                })
    elif isinstance(root, yaml.MappingNode):
        # defaults / vars / meta mapping — each top-level key is a block
        for key_node, val_node in root.value:
            key = getattr(key_node, "value", None)
            start = key_node.start_mark.line
            end = val_node.end_mark.line
            block, ls, le = _trim_block(lines, start, end)
            if not block:
                continue
            is_def = key == var_name
            if is_def or pattern.search(block):
                blocks.append({
                    "file": rel, "line_start": ls, "line_end": le,
                    "block": block,
                    "kind": "definition" if is_def else "mapping",
                    "is_definition": is_def,
                })

    return blocks


def _grep_blocks(lines, rel, pattern) -> list[dict]:
    """Line-based grep with ±2 lines of context; nearby matches are merged."""
    matches = [i for i, ln in enumerate(lines) if pattern.search(ln)]
    if not matches:
        return []

    CONTEXT = 2
    GAP = CONTEXT * 2 + 1
    blocks: list[dict] = []
    group_start = matches[0]
    prev = matches[0]
    for idx in matches[1:]:
        if idx - prev <= GAP:
            prev = idx
            continue
        blocks.append(_window(lines, rel, group_start, prev, CONTEXT))
        group_start = idx
        prev = idx
    blocks.append(_window(lines, rel, group_start, prev, CONTEXT))
    return blocks


def _window(lines, rel, first_match, last_match, context) -> dict:
    start = max(0, first_match - context)
    end = min(len(lines), last_match + context + 1)
    block, ls, le = _trim_block(lines, start, end)
    return {
        "file": rel, "line_start": ls, "line_end": le,
        "block": block, "kind": "template", "is_definition": False,
    }


# ── Tag-Extraktion ───────────────────────────────────────────────────────────

def _collect_tags_from_item(item: dict) -> list[str]:
    """
    Extrahiert Tags aus einem einzelnen Task- oder Block-Item.
    Behandelt alle drei Ansible-Formate:
      tags: single_string
      tags: "comma,separated,string"
      tags: [list, of, tags]
    Rekursiert in block/rescue/always.
    """
    if not isinstance(item, dict):
        return []
    tags = []
    raw = item.get("tags")
    if raw is not None:
        if isinstance(raw, list):
            tags.extend(str(t).strip() for t in raw if str(t).strip())
        elif isinstance(raw, str):
            tags.extend(t.strip() for t in raw.split(",") if t.strip())
    for key in ("block", "rescue", "always"):
        for sub in item.get(key) or []:
            tags.extend(_collect_tags_from_item(sub))
    return tags


def _load_task_list(path: pathlib.Path) -> list:
    """Lädt eine Task-Datei als Liste; gibt [] bei Fehler zurück."""
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        data = yaml.load(content, Loader=_AnsibleSafeLoader)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def extract_role_tags(role_dir: pathlib.Path) -> dict[str, int]:
    """
    Scannt alle .yml-Dateien in tasks/ einer Rolle (rekursiv).
    Gibt {tag_name: task_count} zurück.
    Spezielle Ansible-Tags (always, never) werden mitgezählt.
    """
    tasks_dir = role_dir / "tasks"
    if not tasks_dir.is_dir():
        return {}

    tag_counts: dict[str, int] = {}
    for task_file in sorted(tasks_dir.rglob("*.yml")):
        items = _load_task_list(task_file)
        for item in items:
            for tag in _collect_tags_from_item(item):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    return tag_counts


# ── Handler-Extraktion ───────────────────────────────────────────────────────

# Module die typischerweise in Handlers verwendet werden — alle anderen bleiben
# als Freitext in `module` gespeichert.
_KNOWN_HANDLER_KEYS = {
    "service", "systemd", "ansible.builtin.service", "ansible.builtin.systemd",
    "command", "shell", "ansible.builtin.command", "ansible.builtin.shell",
    "file", "template", "copy", "meta",
}


def _detect_module(item: dict) -> str:
    """Ermittelt das verwendete Modul aus einem Handler-Dict."""
    for key in item:
        if key in _KNOWN_HANDLER_KEYS:
            return key
        if "." in key and key not in ("ansible.builtin.debug",):
            return key
    return ""


def extract_role_handlers(role_dir: pathlib.Path) -> list[dict]:
    """
    Liest handlers/main.yml und gibt eine Liste von Handler-Dicts zurück:
      [{handler_name, module, listen_targets}, ...]
    """
    handler_file = role_dir / "handlers" / "main.yml"
    if not handler_file.is_file():
        return []

    try:
        content = handler_file.read_text(encoding="utf-8", errors="replace")
        data = yaml.load(content, Loader=_AnsibleSafeLoader)
    except Exception:
        return []

    if not isinstance(data, list):
        return []

    results = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = item.get("name", "").strip()
        if not name:
            continue
        listen = item.get("listen", [])
        if isinstance(listen, str):
            listen = [listen]
        results.append({
            "handler_name": name,
            "module": _detect_module(item),
            "listen_targets": list(listen),
        })
    return results


# ── Haupt-Scan-Funktion (wird vom post_run_hook aufgerufen) ─────────────────

def scan_project_roles(project_id: int, project_path: str, revision: str) -> dict:
    """
    Scannt alle roles/* im Projekt-Verzeichnis.
    Für jede Rolle: DELETE existierende RoleVariable-Zeilen, dann INSERT frisch.
    Legt einen RoleScan-Audit-Eintrag an.

    Gibt ein Summary-Dict zurück: {roles_found, vars_extracted, errors}
    """
    from awx.customvars.models import RoleVariable, RoleTag, RoleHandler, RoleScan

    repo = pathlib.Path(project_path)
    roles_dir = repo / "roles"

    errors = []
    all_vars = []
    all_tags: dict[str, dict[str, int]] = {}       # {role_name: {tag: count}}
    all_handlers: dict[str, list[dict]] = {}        # {role_name: [{handler_name, module, listen_targets}]}
    role_names_found = []

    if not roles_dir.is_dir():
        log.info("scan_project_roles: kein roles/-Verzeichnis in %s", project_path)
        scan = RoleScan.objects.create(
            project_id=project_id,
            revision=revision,
            roles_found=0,
            vars_extracted=0,
            errors=["Kein roles/-Verzeichnis gefunden"],
        )
        return {"roles_found": 0, "vars_extracted": 0, "errors": scan.errors}

    # Alle Rollen-Verzeichnisse einsammeln
    for role_dir in sorted(roles_dir.iterdir()):
        if not role_dir.is_dir():
            continue
        role_name = role_dir.name
        try:
            extracted = extract_role(role_dir, project_id, revision)
            tags = extract_role_tags(role_dir)
            handlers = extract_role_handlers(role_dir)
            role_names_found.append(role_name)
            all_vars.extend(extracted)
            all_tags[role_name] = tags
            all_handlers[role_name] = handlers
            log.debug("extract: %s → %d Vars, %d Tags, %d Handlers",
                      role_name, len(extracted), len(tags), len(handlers))
        except Exception as exc:
            msg = f"{role_name}: {exc}"
            errors.append(msg)
            log.warning("scan_project_roles Fehler bei Rolle %s: %s", role_name, exc)

    # ── DELETE + RE-INSERT ────────────────────────────────────────────────
    # Alle vorhandenen Variablen für dieses Projekt löschen und neu einfügen.
    # Pro Rolle atomisch: erst delete, dann bulk_create.
    total_inserted = 0
    for role_name in role_names_found:
        role_vars = [v for v in all_vars if v["role_name"] == role_name]
        try:
            deleted, _ = RoleVariable.objects.filter(
                project_id=project_id,
                role_name=role_name,
            ).delete()
            if deleted:
                log.debug("extract: %d alte RoleVariable-Zeilen für %s gelöscht", deleted, role_name)

            objs = [RoleVariable(**v) for v in role_vars]
            RoleVariable.objects.bulk_create(objs, ignore_conflicts=False)
            total_inserted += len(objs)
            log.info("extract: %s → %d Variablen importiert", role_name, len(objs))
        except Exception as exc:
            msg = f"{role_name} bulk_create: {exc}"
            errors.append(msg)
            log.error("scan_project_roles bulk_create Fehler: %s", exc)

    # ── Tags: DELETE + RE-INSERT ──────────────────────────────────────────────
    total_tags = 0
    for role_name, tag_counts in all_tags.items():
        try:
            RoleTag.objects.filter(project_id=project_id, role_name=role_name).delete()
            objs = [
                RoleTag(
                    project_id=project_id,
                    role_name=role_name,
                    tag_name=tag_name,
                    task_count=count,
                    scanned_revision=revision,
                )
                for tag_name, count in tag_counts.items()
            ]
            RoleTag.objects.bulk_create(objs, ignore_conflicts=False)
            total_tags += len(objs)
        except Exception as exc:
            msg = f"{role_name} tags bulk_create: {exc}"
            errors.append(msg)
            log.error("scan_project_roles tags Fehler: %s", exc)

    # ── Handlers: DELETE + RE-INSERT ─────────────────────────────────────
    total_handlers = 0
    for role_name, handler_list in all_handlers.items():
        try:
            RoleHandler.objects.filter(project_id=project_id, role_name=role_name).delete()
            objs = [
                RoleHandler(
                    project_id=project_id,
                    role_name=role_name,
                    scanned_revision=revision,
                    **h,
                )
                for h in handler_list
            ]
            RoleHandler.objects.bulk_create(objs, ignore_conflicts=False)
            total_handlers += len(objs)
        except Exception as exc:
            msg = f"{role_name} handlers bulk_create: {exc}"
            errors.append(msg)
            log.error("scan_project_roles handlers Fehler: %s", exc)

    # ── Audit-Eintrag ─────────────────────────────────────────────────────
    scan = RoleScan.objects.create(
        project_id=project_id,
        revision=revision,
        roles_found=len(role_names_found),
        vars_extracted=total_inserted,
        tags_extracted=total_tags,
        handlers_extracted=total_handlers,
        errors=errors,
    )
    log.info(
        "scan_project_roles project=%d rev=%s: %d Rollen, %d Vars, %d Tags, %d Handlers, %d Fehler",
        project_id,
        revision[:8] if revision else "?",
        len(role_names_found),
        total_inserted,
        total_tags,
        total_handlers,
        len(errors),
    )
    return {
        "roles_found": len(role_names_found),
        "vars_extracted": total_inserted,
        "tags_extracted": total_tags,
        "handlers_extracted": total_handlers,
        "errors": errors,
    }
