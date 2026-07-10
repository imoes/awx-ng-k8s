"""
DB-authoritative project document store (JSON-IR) — ends the DB↔filesystem split-brain.

Editors (Monaco/Blockly/MCP) read/write the DB (read_document/write_document); the on-disk git
checkout is a projection produced by export_project(), and import_project() parses git back into
the DB. Structured files (yaml/yml/json/nt) live as parsed JSON-IR in ProjectDocument.doc (jsonb);
Jinja2 templates and static files live verbatim in .raw so the DB owns the whole project.

Execution is unchanged: edit in DB → export to git → AWX project-sync → ansible-runner.

NOTE (design consequence): a structured file becomes JSON-IR, which has no place for YAML comments
or exact formatting — round-tripping a commented .yml normalizes it and drops comments. That is
inherent to "JSON is the source of truth"; templates/static (.raw) are preserved byte-for-byte.
"""
import os
from pathlib import Path

from awx.customvars.models import ProjectDocument
from awx.customvars import formats

STRUCTURED_EXTS = {"yml", "yaml", "json", "nt"}
SKIP_DIRS = {".git", "__pycache__", ".ansible", ".svn"}
MAX_BYTES = 512 * 1024


def _is_structured(path: str) -> bool:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return ext in STRUCTURED_EXTS


def import_project(project_id: int, project_path) -> dict:
    """git working tree → DB. Parse structured files to JSON-IR, store the rest verbatim.

    A structured file that fails to parse is kept as raw (lossless) and reported in errors.
    Returns {structured, raw, skipped, pruned, errors:[...]}.
    """
    base = Path(project_path)
    stats = {"structured": 0, "raw": 0, "skipped": 0, "pruned": 0, "errors": []}
    seen = set()
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            abs_p = Path(root) / fn
            rel = str(abs_p.relative_to(base))
            try:
                if abs_p.is_symlink() or abs_p.stat().st_size > MAX_BYTES:
                    stats["skipped"] += 1
                    continue
                text = abs_p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                stats["skipped"] += 1  # binary / unreadable — not editable content
                continue
            seen.add(rel)
            if _is_structured(rel):
                fmt = formats.fmt_from_path(rel)
                try:
                    obj = formats.to_obj(text, fmt)
                except formats.FormatError as exc:
                    ProjectDocument.objects.update_or_create(
                        project_id=project_id, path=rel,
                        defaults={"kind": ProjectDocument.RAW, "raw": text, "doc": None, "fmt": fmt})
                    stats["raw"] += 1
                    stats["errors"].append(f"{rel}: {exc}")
                    continue
                ProjectDocument.objects.update_or_create(
                    project_id=project_id, path=rel,
                    defaults={"kind": ProjectDocument.STRUCTURED, "doc": obj, "raw": "", "fmt": fmt})
                stats["structured"] += 1
            else:
                ProjectDocument.objects.update_or_create(
                    project_id=project_id, path=rel,
                    defaults={"kind": ProjectDocument.RAW, "raw": text, "doc": None, "fmt": "raw"})
                stats["raw"] += 1
    # Prune DB docs that no longer exist on disk, so import reflects git exactly.
    stale = ProjectDocument.objects.filter(project_id=project_id).exclude(path__in=seen)
    stats["pruned"] = stale.count()
    stale.delete()
    return stats


def _render(doc: "ProjectDocument") -> str:
    if doc.kind == ProjectDocument.STRUCTURED:
        return formats.from_obj(doc.doc, doc.fmt)
    return doc.raw


def export_project(project_id: int, project_path) -> dict:
    """DB → git working tree. Render structured docs to their format, write raw verbatim.

    The caller (or AWX's own save path) handles `git add`/`commit`. Returns {written, errors:[...]}.
    """
    base = Path(project_path)
    stats = {"written": 0, "errors": []}
    for d in ProjectDocument.objects.filter(project_id=project_id):
        target = base / d.path
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(_render(d), encoding="utf-8")
            stats["written"] += 1
        except Exception as exc:  # noqa: BLE001 — best-effort export, report per-file
            stats["errors"].append(f"{d.path}: {exc}")
    return stats


def read_document(project_id: int, path: str):
    """Editor read (DB only). Returns {path, kind, fmt, content} or None. `content` is the doc
    serialized in its own format (`fmt`) — what the editor displays."""
    try:
        d = ProjectDocument.objects.get(project_id=project_id, path=path)
    except ProjectDocument.DoesNotExist:
        return None
    return {"path": path, "kind": d.kind, "fmt": d.fmt, "content": _render(d)}


def write_document(project_id: int, path: str, content: str, fmt: str = None) -> dict:
    """Editor write (DB only). Structured content is parsed to JSON-IR before storing; raw verbatim.

    Optionally accept a different display format for a structured path (e.g. edit a playbook as
    NestedText): pass fmt='nt'; it is parsed via that format and the fmt is remembered for export.
    """
    if _is_structured(path):
        used_fmt = (fmt or formats.fmt_from_path(path))
        obj = formats.to_obj(content, used_fmt)
        d, _ = ProjectDocument.objects.update_or_create(
            project_id=project_id, path=path,
            defaults={"kind": ProjectDocument.STRUCTURED, "doc": obj, "raw": "", "fmt": used_fmt})
    else:
        d, _ = ProjectDocument.objects.update_or_create(
            project_id=project_id, path=path,
            defaults={"kind": ProjectDocument.RAW, "raw": content, "doc": None, "fmt": "raw"})
    return {"path": path, "kind": d.kind, "fmt": d.fmt}
