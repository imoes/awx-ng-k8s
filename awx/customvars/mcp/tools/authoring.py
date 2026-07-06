"""
MCP authoring tools — the "prose → idempotent playbook" context + authoring layer.

Design goal (see plan): supply enough *structured, retrievable* context that a small
local model (7B on Ollama/vLLM/llama.cpp) can author correct Ansible — by shrinking the
task (RAG-style retrieval, read-don't-recall module specs, schema-constrained tool I/O,
lint→retry, --check dry-run) rather than relying on a large model's parametric knowledge.

Block 1 (this file, initial): context-delivery tools.
  - ansible_conventions() : byte-stable Geerling conventions text (client prompt-caches it)
  - get_catalog()         : byte-stable compact module digest (client prompt-caches it)
  - search_modules()      : find relevant modules for a task (lexical now; pgvector later)
  - get_module()          : full typed param spec for one module ("read don't recall")
  - list_roles()/get_role(): the project's own roles as higher-level building blocks

Later blocks add the authoring loop (draft/lint/check_run) and the pgvector RAG +
generation cache. search_modules is written so the semantic backend can drop in behind
it without changing the tool's contract.
"""
import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path

from awx.customvars.models import RoleVariable, RoleTag, RoleHandler, EmbeddedBlock, AuthoringCacheEntry
from awx.customvars.mcp.server import mcp
from awx.customvars.mcp.tools._client import awx_http
from awx.customvars.mcp import embeddings

# Fuzzy cache-hit threshold: bge-m3 cosine on short prose. Conservative (yolo-man uses 0.85).
_CACHE_SIM_THRESHOLD = 0.85

# The module catalog is generated for the UI (playbookBuilder/tools/gen-module-catalog.py)
# and copied into this package so the backend can read it without the UI source tree.
# If you regenerate the UI catalog, refresh this copy too.
_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "moduleCatalog.generated.json"
_CONVENTIONS_PATH = Path(__file__).resolve().parent.parent / "context" / "ansible_conventions.md"


@lru_cache(maxsize=1)
def _catalog() -> list:
    """Load and cache the module catalog (list of {name, short_name, short_description, params})."""
    try:
        return json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


# ansible-doc descriptions use markup macros — C(code), M(module), I(italic/param),
# O(option), V(value), U(url), L(link). Flatten them to plain text so a small model
# reads clean prose and doesn't waste tokens/attention on the markup.
_MACRO_RE = re.compile(r"\b[CMIOULV]\(([^)]*)\)")


def _clean_desc(text) -> str:
    if isinstance(text, list):
        text = " ".join(str(t) for t in text)
    if not text:
        return ""
    return _MACRO_RE.sub(r"\1", str(text)).strip()


def _short_desc(text, cap: int = 160) -> str:
    """First sentence of a (cleaned) description, capped — keeps get_module token-lean so a
    small-context model (e.g. a 4k/8k local 7B–14B) can read a full module spec without blowing
    its context. The param name/type/required/choices/aliases carry most of the signal anyway."""
    d = _clean_desc(text)
    if not d:
        return ""
    first = d.split(". ")[0].rstrip(".")
    if len(first) > cap:
        first = first[:cap].rsplit(" ", 1)[0] + "…"
    return first


def _module_by_name(name: str) -> dict | None:
    """Find a catalog module by short name (apt) or FQCN (ansible.builtin.apt)."""
    short = name.split(".")[-1]
    for mod in _catalog():
        if mod.get("short_name") == short or mod.get("name") == name:
            return mod
    return None


def _required_params(mod: dict) -> list:
    return [p["name"] for p in mod.get("params", []) if p.get("required")]


@mcp.tool()
def ansible_conventions() -> str:
    """Return house Ansible best-practice conventions (Geerling style) as Markdown.

    Byte-stable text — paste it once into your system prompt with prompt caching and reuse
    it across turns. Covers variable precedence, defaults/ vs vars/, role layout, idempotence
    rules, and how these map onto AWX-ng. Read this BEFORE authoring a playbook or role.

    Returns: the conventions document as a Markdown string.
    """
    try:
        return _CONVENTIONS_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return "# Ansible conventions unavailable (context file missing)."


def _namespace_of(mod: dict) -> str:
    return (mod.get("name") or "").rsplit(".", 1)[0]


@mcp.tool()
def get_catalog() -> str:
    """Return a compact, byte-stable Markdown digest of the available modules.

    Lists every `ansible.builtin` module in full (name — purpose — required params), then, for the
    larger collections (community.general etc.), only a per-namespace count with a pointer to
    search_modules — a full dump of all ~700 modules would blow a small model's context. So: skim
    builtin here, and use search_modules() for anything in the other collections; get_module() reads
    one module's full parameter spec.

    Returns: Markdown string (builtin bullets + a namespace summary).
    """
    cat = _catalog()
    builtin = [m for m in cat if _namespace_of(m) == "ansible.builtin"]
    other = [m for m in cat if _namespace_of(m) != "ansible.builtin"]
    lines = ["# Module catalog", "", "## ansible.builtin (use these names directly)", ""]
    for mod in sorted(builtin, key=lambda m: m.get("short_name", "")):
        req = _required_params(mod)
        req_txt = f" — required: {', '.join(req)}" if req else ""
        lines.append(
            f"- **{mod.get('short_name')}** ({mod.get('name')}): "
            f"{_clean_desc(mod.get('short_description'))}{req_txt}"
        )
    if other:
        from collections import Counter
        counts = Counter(_namespace_of(m) for m in other)
        lines += ["", "## Other collections (search_modules to find these, then get_module)", ""]
        for ns, n in sorted(counts.items()):
            lines.append(f"- **{ns}**: {n} modules — e.g. use search_modules(\"…\") to discover")
    return "\n".join(lines)


def _lexical_score(mod: dict, terms: list) -> int:
    """Cheap relevance score: short_name hit weighs most, then description, then param names."""
    short = (mod.get("short_name") or "").lower()
    desc = _clean_desc(mod.get("short_description")).lower()
    params = " ".join(p.get("name", "") for p in mod.get("params", [])).lower()
    score = 0
    for t in terms:
        if not t:
            continue
        if t == short:
            score += 5
        elif t in short:
            score += 3
        if t in desc:
            score += 2
        if t in params:
            score += 1
    return score


def _module_hit(mod: dict, score) -> dict:
    return {
        "short_name": mod.get("short_name"),
        "name": mod.get("name"),
        "short_description": _clean_desc(mod.get("short_description")),
        "required_params": _required_params(mod),
        "score": score,
    }


def _lexical_modules(query: str, top_k: int) -> list:
    terms = [t for t in re.split(r"\W+", (query or "").lower()) if t]
    scored = []
    for mod in _catalog():
        s = _lexical_score(mod, terms)
        if s > 0:
            scored.append((s, mod))
    scored.sort(key=lambda x: (-x[0], x[1].get("short_name", "")))
    return [_module_hit(mod, s) for s, mod in scored[: max(1, top_k)]]


def _semantic_refs(kind: str, project_id: int, query: str, top_k: int):
    """Semantic top-k refs for a kind, or None to signal 'fall back to lexical'.

    Returns None when the embedding endpoint is down OR nothing is indexed yet — so every
    caller degrades to lexical search without an error.
    """
    qv = embeddings.embed_one(query)
    if qv is None:
        return None
    rows = list(EmbeddedBlock.objects.filter(kind=kind, project_id=project_id).only("ref", "embedding"))
    if not rows:
        return None
    return embeddings.rank(qv, [(r.ref, r.embedding) for r in rows], top_k)


@mcp.tool()
def search_modules(query: str, top_k: int = 8) -> list:
    """Find the ansible.builtin modules most relevant to a task described in words.

    Uses semantic search (bge-m3 embeddings) when the index is populated (awx-manage mcp_reindex);
    otherwise falls back to lexical keyword scoring. Returns compact hits (not full specs) so only
    relevant building blocks enter the model's context — follow up with get_module(name).

    Args:
        query:  Natural-language task or keywords (e.g. "install a package", "open firewall port", "create user")
        top_k:  Maximum number of modules to return (default 8)

    Returns: list of {short_name, name, short_description, required_params, score}, best first.
             (score is cosine similarity for semantic hits, a keyword count for lexical.)
    """
    ranked = _semantic_refs(EmbeddedBlock.KIND_MODULE, 0, query, top_k)
    if ranked is None:
        return _lexical_modules(query, top_k)
    hits = []
    for ref, score in ranked:
        mod = _module_by_name(ref)
        if mod:
            hits.append(_module_hit(mod, round(score, 4)))
    return hits or _lexical_modules(query, top_k)


@mcp.tool()
def search_roles(query: str, project_id: int, top_k: int = 6) -> list:
    """Find the project's own roles most relevant to a task (semantic, lexical fallback).

    Prefer an existing role over hand-writing tasks. Follow up with get_role(project_id, role).

    Args:
        query:      Natural-language task or keywords
        project_id: ID of the project whose roles to search
        top_k:      Maximum number of roles to return (default 6)

    Returns: list of {role_name, score}, best first.
    """
    ranked = _semantic_refs(EmbeddedBlock.KIND_ROLE, project_id, query, top_k)
    if ranked is not None:
        return [{"role_name": ref, "score": round(score, 4)} for ref, score in ranked]
    # Lexical fallback: substring over role names known to this project.
    terms = [t for t in re.split(r"\W+", (query or "").lower()) if t]
    names = set(RoleVariable.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    names |= set(RoleTag.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    names |= set(RoleHandler.objects.filter(project_id=project_id).values_list("role_name", flat=True))
    scored = [(sum(t in rn.lower() for t in terms), rn) for rn in names]
    scored = [(s, rn) for s, rn in scored if s > 0]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{"role_name": rn, "score": s} for s, rn in scored[: max(1, top_k)]]


@mcp.tool()
def search_playbooks(query: str, project_id: int, top_k: int = 6) -> list:
    """Find a project's existing playbooks most relevant to a task (semantic, lexical fallback).

    Args:
        query:      Natural-language task or keywords
        project_id: ID of the project whose playbooks to search
        top_k:      Maximum number of playbook paths to return (default 6)

    Returns: list of {playbook, score}, best first.
    """
    ranked = _semantic_refs(EmbeddedBlock.KIND_PLAYBOOK, project_id, query, top_k)
    if ranked is not None:
        return [{"playbook": ref, "score": round(score, 4)} for ref, score in ranked]
    # Lexical fallback: substring over the project's playbook paths.
    terms = [t for t in re.split(r"\W+", (query or "").lower()) if t]
    with awx_http() as client:
        resp = client.get(f"projects/{project_id}/playbooks/")
        paths = resp.json() if resp.status_code == 200 else []
    scored = [(sum(t in str(p).lower() for t in terms), str(p)) for p in paths]
    scored = [(s, p) for s, p in scored if s > 0]
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [{"playbook": p, "score": s} for s, p in scored[: max(1, top_k)]]


@mcp.tool()
def get_module(name: str) -> dict:
    """Get the full, typed parameter spec for one ansible.builtin module.

    This is the "read don't recall" primitive: rather than trusting the model's memory of a
    module's arguments, hand it the exact schema (types, required flags, choices, aliases,
    defaults, descriptions). Use the returned param names verbatim in the generated task.

    Args:
        name: Module short name ("apt") or FQCN ("ansible.builtin.apt")

    Returns: {name, short_name, short_description, params:[{name,type,required,choices,default,aliases,description}]}
             or {"error": ...} if the module is not in the catalog.
    """
    mod = _module_by_name(name)
    if not mod:
        return {"error": f"Module '{name}' not found in the ansible.builtin catalog."}
    return {
        "name": mod.get("name"),
        "short_name": mod.get("short_name"),
        "short_description": _clean_desc(mod.get("short_description")),
        "params": [
            {
                "name": p.get("name"),
                "type": p.get("type"),
                "required": bool(p.get("required")),
                "choices": p.get("choices"),
                "default": p.get("default"),
                "aliases": p.get("aliases"),
                "description": _short_desc(p.get("description")),
            }
            for p in mod.get("params", [])
        ],
    }


@mcp.tool()
def list_roles(project_id: int) -> list:
    """List the Ansible roles detected in a project (higher-level building blocks than modules).

    Prefer an existing project role over hand-writing tasks when one already does the job.
    Follow up with get_role(project_id, role_name) to read a role's variables/tags/handlers.

    Args:
        project_id: ID of the project (see awx_list_projects)

    Returns: list of {role_name, variable_count, tag_count, handler_count}, sorted by name.
    """
    names = (
        RoleVariable.objects.filter(project_id=project_id)
        .values_list("role_name", flat=True)
        .distinct()
    )
    # Roles may exist with only tasks/handlers and no defaults — union those role names in too.
    names = set(names) | set(
        RoleTag.objects.filter(project_id=project_id).values_list("role_name", flat=True)
    ) | set(
        RoleHandler.objects.filter(project_id=project_id).values_list("role_name", flat=True)
    )
    out = []
    for rn in sorted(names):
        out.append({
            "role_name": rn,
            "variable_count": RoleVariable.objects.filter(project_id=project_id, role_name=rn).count(),
            "tag_count": RoleTag.objects.filter(project_id=project_id, role_name=rn).count(),
            "handler_count": RoleHandler.objects.filter(project_id=project_id, role_name=rn).count(),
        })
    return out


@mcp.tool()
def get_role(project_id: int, role_name: str) -> dict:
    """Get everything about one project role in a single call — maximal context per token.

    Bundles the role's default variables (with type + whether the value contains Jinja), its
    task tags, and its handlers. Use this to decide whether to apply the role (and with which
    variable overrides) instead of writing raw tasks.

    Args:
        project_id: ID of the project
        role_name:  Name of the role (see list_roles)

    Returns: {role_name, variables:[{name,type,default,has_jinja,comment}], tags:[...], handlers:[...]}
    """
    variables = [
        {
            "name": v.var_name,
            "type": v.value_type,
            "default": v.default_value,
            "has_jinja": v.has_jinja,
            "comment": v.comment or "",
        }
        for v in RoleVariable.objects.filter(project_id=project_id, role_name=role_name).order_by("var_name")
    ]
    tags = list(
        RoleTag.objects.filter(project_id=project_id, role_name=role_name)
        .order_by("tag_name")
        .values_list("tag_name", flat=True)
    )
    handlers = [
        {"name": h.handler_name, "module": h.module, "listen": h.listen_targets or []}
        for h in RoleHandler.objects.filter(project_id=project_id, role_name=role_name).order_by("handler_name")
    ]
    if not variables and not tags and not handlers:
        return {"error": f"Role '{role_name}' not found in project {project_id} (or not scanned yet)."}
    return {
        "role_name": role_name,
        "variables": variables,
        "tags": tags,
        "handlers": handlers,
    }


# ── Authoring + verification loop (Block 2) ───────────────────────────────────
# draft → lint → check-mode dry-run. This is the deterministic scaffolding that lets a
# small model be wrong-then-corrected instead of right-first-try: lint returns structured
# errors to retry against, and check_run/check_result preview changes with --check so a bad
# guess is shown, never converged. Real (non-check) execution stays with the separate
# awx_launch_job_template tool + explicit human approval.

def _lint(project_id: int, content: str, path: str) -> dict:
    with awx_http() as client:
        resp = client.post(f"projects/{project_id}/files/lint/", json={"content": content, "path": path})
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def draft_playbook(project_id: int, path: str, content: str) -> dict:
    """Write a draft playbook/role file into a project AND lint it in one step.

    Combines the write + lint round-trips so you get immediate feedback. On lint errors, fix the
    content and call draft_playbook again (or lint_playbook to check without rewriting). A written
    .yml is immediately available to check_run (the project's playbook list auto-refreshes).

    Args:
        project_id: ID of the project (see awx_list_projects)
        path:       File path relative to project root (e.g. "playbooks/nginx.yml")
        content:    Full YAML content

    Returns: {path, written, valid, errors:[{line,col,message,severity,source}]}
    """
    with awx_http() as client:
        resp = client.put(
            f"projects/{project_id}/files/content/",
            params={"path": path},
            json={"content": content},
        )
        resp.raise_for_status()
    lint = _lint(project_id, content, path)
    return {
        "path": path,
        "written": True,
        "valid": lint.get("valid", False),
        "errors": lint.get("errors", []),
    }


@mcp.tool()
def lint_playbook(project_id: int, content: str, path: str = "playbook.yml") -> dict:
    """Lint YAML playbook/role content WITHOUT writing it (YAML syntax + ansible-lint).

    Use this in a validate→retry loop: generate, lint, fix reported errors, repeat until valid,
    then draft_playbook() to persist. Errors are structured (line/col/message) so a small model
    can correct precisely.

    Args:
        project_id: ID of the project (lint runs in the project's context)
        content:    Full YAML content to check
        path:       Nominal path (affects ansible-lint's file-type detection; default "playbook.yml")

    Returns: {valid: bool, errors: [{line, col, message, severity, source, rule}]}
    """
    return _lint(project_id, content, path)


def _find_or_create_check_jt(client, project_id: int, playbook: str, inventory_id: int,
                             credential_id: int = 0) -> dict:
    """Return (create if needed) a check-mode job template for this (project, playbook).

    Named deterministically so repeated check_run calls on the same playbook reuse one JT
    instead of piling up scratch templates. JT creation uses the stock AWX REST API (there is
    no custom create-JT endpoint).
    """
    name = f"[MCP check] {playbook}"
    resp = client.get("job_templates/", params={"name": name})
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if results:
        jt = results[0]
    else:
        create = client.post("job_templates/", json={
            "name": name,
            "description": "Auto-created check-mode dry-run template for MCP prose authoring.",
            "job_type": "check",
            "project": project_id,
            "playbook": playbook,
            "inventory": inventory_id,
            "ask_limit_on_launch": True,
        })
        create.raise_for_status()
        jt = create.json()
        if credential_id:
            client.post(f"job_templates/{jt['id']}/credentials/", json={"id": credential_id})
    return jt


@mcp.tool()
def check_run(project_id: int, playbook: str, inventory_id: int, limit: str = "", credential_id: int = 0) -> dict:
    """Launch a CHECK-MODE (--check) dry run of a playbook — previews changes, converges nothing.

    This is the idempotence safety net: it reports what WOULD change without touching hosts. Create
    the playbook first (draft_playbook). A check job that reports changed>0 on a first run and
    changed==0 on a second run is idempotent. Reuses one auto-created check-mode job template per
    playbook. Poll awx_get_job_status(job_id) until finished, then call check_result(job_id).

    Args:
        project_id:    ID of the project containing the playbook
        playbook:      Playbook path relative to project root (e.g. "playbooks/nginx.yml")
        inventory_id:  Inventory to run against (see awx_list_inventories)
        limit:         Optional Ansible host limit pattern
        credential_id: Optional machine credential ID to attach (SSH) if not provided by Location routing

    Returns: {job_id, template_id, status}
    """
    with awx_http() as client:
        jt = _find_or_create_check_jt(client, project_id, playbook, inventory_id, credential_id)
        payload = {}
        if limit:
            payload["limit"] = limit
        launch = client.post(f"job_templates/{jt['id']}/launch/", json=payload)
        launch.raise_for_status()
        job = launch.json()
    return {"job_id": job.get("id"), "template_id": jt.get("id"), "status": job.get("status", "pending")}


# Matches an ansible PLAY RECAP host line: "host : ok=1 changed=0 unreachable=0 failed=0 ..."
_RECAP_RE = re.compile(
    r"^(?P<host>\S+)\s*:\s*ok=(?P<ok>\d+)\s+changed=(?P<changed>\d+)\s+"
    r"unreachable=(?P<unreachable>\d+)\s+failed=(?P<failed>\d+)",
    re.M,
)


@mcp.tool()
def check_result(job_id: int, stdout_tail_chars: int = 4000) -> dict:
    """Get the outcome of a check_run job: the PLAY RECAP totals + a tail of stdout.

    Call after awx_get_job_status(job_id) reports finished. The parsed recap tells you whether the
    dry run would change anything (total_changed) and whether it failed — the signal for the
    idempotence check.

    Args:
        job_id:            The check job's ID (from check_run)
        stdout_tail_chars: How many trailing chars of stdout to include (default 4000, token budget)

    Returns: {job_id, status, failed, recap:[{host,ok,changed,unreachable,failed}],
              total_changed, total_failed, stdout_tail}
    """
    with awx_http() as client:
        status = client.get(f"jobs/{job_id}/")
        status.raise_for_status()
        job = status.json()
        out = client.get(f"jobs/{job_id}/stdout/", params={"format": "txt"})
        text = out.text if out.status_code == 200 else ""

    recap = [
        {k: (int(v) if k != "host" else v) for k, v in m.groupdict().items()}
        for m in _RECAP_RE.finditer(text)
    ]
    return {
        "job_id": job_id,
        "status": job.get("status"),
        "failed": job.get("failed"),
        "recap": recap,
        "total_changed": sum(h["changed"] for h in recap),
        "total_failed": sum(h["failed"] + h["unreachable"] for h in recap),
        "stdout_tail": text[-max(0, stdout_tail_chars):],
    }


# ── Generation cache (Block 3) ────────────────────────────────────────────────
# Reuse a previously-produced, validated artifact for the same/near-duplicate prose so a
# repeat request costs zero LLM tokens (yolo-man's chunk-similarity cache). Exact match via
# sha256 of the normalized prose; fuzzy match via bge-m3 cosine ≥ threshold.

def _normalize_prose(prose: str) -> str:
    return " ".join((prose or "").split()).lower()


@mcp.tool()
def cache_lookup(prose: str) -> dict:
    """Check whether a validated artifact already exists for this (or a near-identical) prose request.

    Call this BEFORE authoring: on a hit you can return the stored playbook/plan directly and skip
    generation entirely. Exact match = same normalized text; fuzzy match = cosine ≥ 0.85 on bge-m3
    embeddings (falls back to exact-only if the embedding endpoint is down).

    Args:
        prose: The natural-language request to look up.

    Returns: {hit: "exact"|"fuzzy"|null, similarity?, artifact?} — artifact is the stored result.
    """
    norm = _normalize_prose(prose)
    h = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    exact = AuthoringCacheEntry.objects.filter(source_hash=h).first()
    if exact:
        AuthoringCacheEntry.objects.filter(pk=exact.pk).update(hits=exact.hits + 1)
        return {"hit": "exact", "artifact": exact.artifact_json}

    qv = embeddings.embed_one(norm)
    if qv is None:
        return {"hit": None}
    rows = list(AuthoringCacheEntry.objects.exclude(prompt_embedding=None).only("id", "prompt_embedding", "artifact_json"))
    if not rows:
        return {"hit": None}
    ranked = embeddings.rank(qv, [(r, r.prompt_embedding) for r in rows], 1)
    best_row, best_score = ranked[0]
    if best_score >= _CACHE_SIM_THRESHOLD:
        AuthoringCacheEntry.objects.filter(pk=best_row.pk).update(hits=best_row.hits + 1)
        return {"hit": "fuzzy", "similarity": round(best_score, 4), "artifact": best_row.artifact_json}
    return {"hit": None}


@mcp.tool()
def cache_store(prose: str, artifact: dict) -> dict:
    """Store a validated authoring artifact so future identical/near-duplicate prose reuses it.

    Call this AFTER the generated playbook passed lint_playbook and check_run (i.e. it's known-good),
    so cache_lookup can later return it with zero LLM tokens. Upserts by normalized-prose hash.

    Args:
        prose:    The natural-language request that produced the artifact.
        artifact: The validated result to store (e.g. {"path": ..., "content": ...} or a plan object).

    Returns: {stored: true, source_hash, embedded: bool}
    """
    norm = _normalize_prose(prose)
    h = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    vec = embeddings.embed_one(norm)
    AuthoringCacheEntry.objects.update_or_create(
        source_hash=h,
        defaults={"prose": prose, "prompt_embedding": vec, "artifact_json": artifact},
    )
    return {"stored": True, "source_hash": h, "embedded": vec is not None}
