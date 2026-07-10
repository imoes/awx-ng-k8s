"""Tests for the JSON-IR format converters (awx.customvars.formats).

Pure-Python (no Django) — runnable via pytest or standalone:
    python3 -m awx.customvars.test_formats   # prints OK / raises on failure
"""
from awx.customvars import formats as F

PLAY = [
    {
        "name": "configure",
        "hosts": "localhost",
        "connection": "local",
        "gather_facts": False,
        "become": True,
        "vars": {"port": 8080, "ratio": 1.5, "tag": "{{ inventory_hostname }}"},
        "tasks": [
            {"name": "dir", "ansible.builtin.file": {"path": "/opt/x", "state": "directory", "mode": "0755"}},
            {"name": "line", "ansible.builtin.lineinfile": {"path": "/etc/motd", "line": "hi"}},
        ],
    }
]


def test_yaml_roundtrip():
    text = F.obj_to_yaml(PLAY)
    assert F.yaml_to_obj(text) == PLAY
    # ansible reads JSON natively too — JSON ⊂ YAML
    assert F.yaml_to_obj(F.obj_to_json(PLAY)) == PLAY


def test_json_roundtrip():
    assert F.json_to_obj(F.obj_to_json(PLAY)) == PLAY


def test_nestedtext_scalar_typing():
    obj = F.nestedtext_to_obj("a: true\nb: false\nc: 123\nd: 1.5\ne: Europe/Berlin\nf: {{ x }}\n")
    assert obj == {"a": True, "b": False, "c": 123, "d": 1.5, "e": "Europe/Berlin", "f": "{{ x }}"}


def test_nestedtext_preserves_leading_zero_strings():
    # File modes / zero-padded ids must NOT become integers (the octal footgun).
    obj = F.nestedtext_to_obj("mode: 0755\nid: 007\nzero: 0\nport: 8080\nrate: 0.5\n")
    assert obj == {"mode": "0755", "id": "007", "zero": 0, "port": 8080, "rate": 0.5}


def test_nestedtext_no_yaml_norway_problem():
    # NestedText does NOT type-coerce yes/no/on/off/null — that's the whole point.
    obj = F.nestedtext_to_obj("a: no\nb: yes\nc: null\nd: on\n")
    assert obj == {"a": "no", "b": "yes", "c": "null", "d": "on"}


def test_nestedtext_roundtrip_via_ir():
    nt = F.obj_to_nestedtext(PLAY)
    back = F.nestedtext_to_obj(nt)
    assert back == PLAY


def test_convert_between_formats():
    y = F.obj_to_yaml(PLAY)
    nt = F.convert(y, "yaml", "nt")
    y2 = F.convert(nt, "nt", "yaml")
    assert F.yaml_to_obj(y2) == PLAY
    # and straight to json
    j = F.convert(y, "yaml", "json")
    assert F.json_to_obj(j) == PLAY


def test_fmt_from_path():
    assert F.fmt_from_path("roles/x/tasks/main.yml") == "yml"
    assert F.fmt_from_path("playbook.json") == "json"
    assert F.fmt_from_path("vars.nt") == "nt"
    assert F.fmt_from_path("group_vars/all") == "yaml"  # no extension → default


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print("ok  ", fn.__name__)
        except Exception:
            failed += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
