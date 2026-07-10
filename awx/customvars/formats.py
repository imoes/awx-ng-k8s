"""
Format conversion for the JSON-IR architecture.

JSON is the internal representation the tools/AI think in; YAML and NestedText are just
serializations over it. Git stays the source of truth (YAML + Jinja2 .j2 files); ansible-runner
reads them unchanged (a playbook / group_vars file may even be raw JSON — ansible reads .json
natively). These helpers translate between the on-disk/human formats and the JSON-IR ("obj" =
a plain Python dict/list, i.e. the parsed JSON model).

  YAML  ⇄ obj   yaml_to_obj / obj_to_yaml   (JSON ⊂ YAML — obj_to_json/json_to_obj are trivial)
  NT    ⇄ obj   nestedtext_to_obj / obj_to_nestedtext   (+ a scalar-typing layer, see below)

NestedText is intentionally strings-only (no native bools/ints/null — it sidesteps YAML's type
surprises like the "Norway problem"). Ansible needs real types, so on import each leaf string is
coerced conservatively (exact true/false, ints, floats; Jinja {{…}}/{%…%} always kept verbatim;
everything else stays a string). On export scalars are stringified. Jinja2 templates are opaque
text and are NOT parsed here — they pass through untouched.
"""
import json
import re

import yaml

try:
    import nestedtext as _nt
except ImportError:  # pragma: no cover - nestedtext is installed in the image
    _nt = None

# Int: no leading zeros (so a file mode like "0755" or a zero-padded id stays a STRING — this is
# exactly the YAML octal footgun NestedText exists to avoid; we must not re-introduce it).
_INT_RE = re.compile(r"^[+-]?(0|[1-9]\d*)$")
# Float: must actually look like a float (a decimal point or an exponent) — a bare integer string
# is handled by _INT_RE above, never coerced to float.
_FLOAT_RE = re.compile(r"^[+-]?(\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)$")


class FormatError(ValueError):
    """Raised when text can't be parsed in the requested format."""


# ── YAML / JSON ⇄ obj ─────────────────────────────────────────────────────────

def yaml_to_obj(text):
    """Parse YAML (or JSON — it's a subset) into a plain Python object (the JSON-IR)."""
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise FormatError(f"invalid YAML: {exc}") from exc


def obj_to_yaml(obj):
    """Serialize the JSON-IR to human-friendly block-style YAML (key order preserved)."""
    return yaml.safe_dump(obj, sort_keys=False, default_flow_style=False, allow_unicode=True, width=120)


def json_to_obj(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise FormatError(f"invalid JSON: {exc}") from exc


def obj_to_json(obj, indent=2):
    return json.dumps(obj, indent=indent, ensure_ascii=False)


# ── NestedText ⇄ obj (with a scalar-typing layer) ─────────────────────────────

def _coerce_scalar(s):
    """Turn a NestedText leaf string into a real scalar, conservatively.

    Jinja stays a string (templating must survive). Only exact true/false and plain
    int/float literals are typed; everything else is left as a string — we deliberately do
    NOT apply YAML's aggressive coercion (yes/no/on/off/null/dates), which is the whole point
    of using NestedText.
    """
    if not isinstance(s, str):
        return s
    if "{{" in s or "{%" in s:
        return s
    if s == "true":
        return True
    if s == "false":
        return False
    if _INT_RE.match(s):
        return int(s)
    if _FLOAT_RE.match(s):
        try:
            return float(s)
        except ValueError:
            return s
    return s


def _coerce(node):
    if isinstance(node, dict):
        return {k: _coerce(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_coerce(v) for v in node]
    return _coerce_scalar(node)


def _stringify(node):
    """Inverse of _coerce for emission: NestedText leaves must be strings (or dict/list)."""
    if isinstance(node, dict):
        return {str(k): _stringify(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_stringify(v) for v in node]
    if node is True:
        return "true"
    if node is False:
        return "false"
    if node is None:
        return ""
    return str(node)


def nestedtext_to_obj(text, typed=True):
    """Parse NestedText into the JSON-IR. With typed=True, leaf strings are scalar-coerced."""
    if _nt is None:
        raise FormatError("nestedtext package not installed")
    try:
        # top='any': a playbook is a top-level list, a vars file a top-level dict — accept either.
        raw = _nt.loads(text, top="any") if text.strip() else {}
    except _nt.NestedTextError as exc:  # type: ignore[attr-defined]
        raise FormatError(f"invalid NestedText: {exc}") from exc
    return _coerce(raw) if typed else raw


def obj_to_nestedtext(obj):
    """Serialize the JSON-IR to NestedText (scalars stringified)."""
    if _nt is None:
        raise FormatError("nestedtext package not installed")
    return _nt.dumps(_stringify(obj))


# ── Dispatch by format name / file extension ──────────────────────────────────

_LOADERS = {"json": json_to_obj, "yaml": yaml_to_obj, "yml": yaml_to_obj, "nt": nestedtext_to_obj,
            "nestedtext": nestedtext_to_obj}
_DUMPERS = {"json": obj_to_json, "yaml": obj_to_yaml, "yml": obj_to_yaml, "nt": obj_to_nestedtext,
            "nestedtext": obj_to_nestedtext}


def fmt_from_path(path):
    """Guess a format name from a file path's extension (default 'yaml')."""
    ext = (path.rsplit(".", 1)[-1] if "." in path else "").lower()
    if ext in _LOADERS:
        return "nt" if ext == "nestedtext" else ext
    return "yaml"


def to_obj(text, fmt):
    fmt = fmt.lower()
    if fmt not in _LOADERS:
        raise FormatError(f"unknown source format: {fmt}")
    return _LOADERS[fmt](text)


def from_obj(obj, fmt):
    fmt = fmt.lower()
    if fmt not in _DUMPERS:
        raise FormatError(f"unknown target format: {fmt}")
    return _DUMPERS[fmt](obj)


def convert(text, src_fmt, dst_fmt):
    """Translate text between formats via the JSON-IR (e.g. convert(nt, 'nt', 'yaml'))."""
    return from_obj(to_obj(text, src_fmt), dst_fmt)
