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
import json
import re
from functools import lru_cache
from pathlib import Path

from awx.customvars.models import RoleVariable, RoleTag, RoleHandler
from awx.customvars.mcp.server import mcp

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


@mcp.tool()
def get_catalog() -> str:
    """Return a compact, byte-stable Markdown digest of every available ansible.builtin module.

    One line per module (name — purpose — required params). Deterministic ordering so it is
    safe to prompt-cache client-side. Use this to see what building blocks exist, then call
    search_modules() to narrow down and get_module() to read one module's full parameter spec.

    Returns: Markdown string, one bullet per module.
    """
    lines = ["# ansible.builtin module catalog", ""]
    for mod in sorted(_catalog(), key=lambda m: m.get("short_name", "")):
        req = _required_params(mod)
        req_txt = f" — required: {', '.join(req)}" if req else ""
        lines.append(
            f"- **{mod.get('short_name')}** ({mod.get('name')}): "
            f"{_clean_desc(mod.get('short_description'))}{req_txt}"
        )
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


@mcp.tool()
def search_modules(query: str, top_k: int = 8) -> list:
    """Find the ansible.builtin modules most relevant to a task described in words.

    Returns compact hits (not full specs) so only relevant building blocks enter the model's
    context. Follow up with get_module(name) to read the full parameter spec of a chosen module.

    Args:
        query:  Natural-language task or keywords (e.g. "install a package", "open firewall port", "create user")
        top_k:  Maximum number of modules to return (default 8)

    Returns: list of {short_name, name, short_description, required_params, score}, best first.
    """
    terms = [t for t in re.split(r"\W+", (query or "").lower()) if t]
    scored = []
    for mod in _catalog():
        s = _lexical_score(mod, terms)
        if s > 0:
            scored.append((s, mod))
    scored.sort(key=lambda x: (-x[0], x[1].get("short_name", "")))
    return [
        {
            "short_name": mod.get("short_name"),
            "name": mod.get("name"),
            "short_description": _clean_desc(mod.get("short_description")),
            "required_params": _required_params(mod),
            "score": s,
        }
        for s, mod in scored[: max(1, top_k)]
    ]


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
                "description": _clean_desc(p.get("description")),
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
