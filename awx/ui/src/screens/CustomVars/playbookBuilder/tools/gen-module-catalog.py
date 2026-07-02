#!/usr/bin/env python3
"""
Generates moduleCatalog.generated.json from `ansible-doc -j` for every
ansible.builtin module. Run inside an execution environment that has
ansible-doc on PATH (e.g. the awx_ee container):

    docker compose exec -T awx_ee python3 - < gen-module-catalog.py > moduleCatalog.generated.json

Re-run whenever ansible-core is upgraded to pick up new/changed modules.
"""
import json
import subprocess
import sys


def _text(value):
    """ansible-doc descriptions are often a list of strings; join to one."""
    if isinstance(value, list):
        return ' '.join(str(v) for v in value)
    return str(value) if value is not None else ''


def list_builtin_modules():
    out = subprocess.run(
        ['ansible-doc', '-l', 'ansible.builtin'],
        check=True, capture_output=True, text=True,
    ).stdout
    # `ansible-doc -l` intersperses section headers (e.g. "DEPRECATED:")
    # among the module lines — keep only real ansible.builtin.* module names.
    names = (line.split()[0] for line in out.splitlines() if line.strip())
    return sorted(n for n in names if n.startswith('ansible.builtin.'))


def compact_options(options):
    result = []
    for name, opt in (options or {}).items():
        result.append({
            'name': name,
            'type': opt.get('type', 'str'),
            'required': bool(opt.get('required', False)),
            'choices': opt.get('choices'),
            'default': opt.get('default'),
            'description': _text(opt.get('description')),
            # Real playbooks routinely use a param's alias instead of its
            # canonical name (e.g. ansible.builtin.file's `dest:`/`name:` for
            # `path:`, apt's `pkg:`/`package:` for `name:`, systemd's `unit:`
            # for `name:`) — without these, the importer can't recognize the
            # param and falls back to raw_task even for a plain builtin module.
            'aliases': opt.get('aliases') or [],
        })
    return result


class ModuleRemoved(Exception):
    """Raised when ansible-doc no longer knows this module (e.g. removed
    aliases like ansible.builtin.include in modern ansible-core)."""


def fetch_module_doc(fqcn):
    out = subprocess.run(
        ['ansible-doc', '-j', fqcn],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    if fqcn not in data:
        raise ModuleRemoved(fqcn)
    doc = data[fqcn]['doc']
    return {
        'name': fqcn,
        'short_name': fqcn.rsplit('.', 1)[-1],
        'short_description': _text(doc.get('short_description')),
        'params': compact_options(doc.get('options')),
    }


def main():
    modules = list_builtin_modules()
    catalog = []
    errors = []
    for fqcn in modules:
        try:
            catalog.append(fetch_module_doc(fqcn))
        except ModuleRemoved:
            errors.append(f'{fqcn}: removed from ansible-core, skipped')
        except Exception as exc:  # noqa: BLE001 — best-effort catalog build
            errors.append(f'{fqcn}: {exc}')

    print(json.dumps(catalog, indent=2, sort_keys=False))
    if errors:
        print(f'--- {len(errors)} module(s) failed ---', file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)


if __name__ == '__main__':
    main()
