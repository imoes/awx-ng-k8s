#!/usr/bin/env python3
"""
Generates moduleCatalog.generated.json from `ansible-doc -j`. Run inside an
execution environment that has ansible-doc on PATH (e.g. the awx_ee container).

  # UI catalog — ansible.builtin only (keeps the Blockly toolbox lean):
  docker compose exec -T awx_ee python3 - < gen-module-catalog.py > moduleCatalog.generated.json

  # Backend/MCP catalog — broader coverage for the prose-authoring semantic search:
  docker compose exec -T awx_ee python3 - ansible.builtin ansible.posix community.general \
      community.docker community.crypto < gen-module-catalog.py > moduleCatalog.generated.json

Namespaces are given as argv (default: ansible.builtin). Re-run whenever ansible-core /
collections are upgraded. NOTE: with multiple namespaces, short_names can collide across
collections (e.g. several `.copy`) — consumers must key on the FQCN `name`, not `short_name`
(the earliest namespace on the command line wins a bare short_name lookup).
"""
import json
import subprocess
import sys

# Namespaces to include, in priority order (earlier wins a bare short_name collision).
NAMESPACES = sys.argv[1:] or ['ansible.builtin']


def _text(value):
    """ansible-doc descriptions are often a list of strings; join to one."""
    if isinstance(value, list):
        return ' '.join(str(v) for v in value)
    return str(value) if value is not None else ''


def list_namespace_modules(namespace):
    out = subprocess.run(
        ['ansible-doc', '-l', namespace],
        check=True, capture_output=True, text=True,
    ).stdout
    # `ansible-doc -l` intersperses section headers (e.g. "DEPRECATED:")
    # among the module lines — keep only real <namespace>.* module names.
    names = (line.split()[0] for line in out.splitlines() if line.strip())
    return sorted(n for n in names if n.startswith(namespace + '.'))


def list_builtin_modules():
    seen = set()
    ordered = []
    for ns in NAMESPACES:
        for n in list_namespace_modules(ns):
            if n not in seen:
                seen.add(n)
                ordered.append(n)
    return ordered


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


def _doc_to_entry(fqcn, doc):
    return {
        'name': fqcn,
        'short_name': fqcn.rsplit('.', 1)[-1],
        'short_description': _text(doc.get('short_description')),
        'params': compact_options(doc.get('options')),
    }


def fetch_batch(fqcns):
    """ansible-doc -j accepts many module names and returns {fqcn: {doc:...}} —
    batching keeps a 700+ module catalog build to seconds, not minutes."""
    out = subprocess.run(
        ['ansible-doc', '-j', *fqcns],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    return {fqcn: data[fqcn]['doc'] for fqcn in fqcns if fqcn in data and 'doc' in data[fqcn]}


def main():
    modules = list_builtin_modules()
    catalog = []
    errors = []
    BATCH = 40
    for i in range(0, len(modules), BATCH):
        batch = modules[i:i + BATCH]
        try:
            docs = fetch_batch(batch)
        except Exception as exc:  # noqa: BLE001 — fall back to per-module on batch failure
            docs = {}
            for fqcn in batch:
                try:
                    docs.update(fetch_batch([fqcn]))
                except Exception as exc2:  # noqa: BLE001
                    errors.append(f'{fqcn}: {exc2}')
        for fqcn in batch:
            if fqcn in docs:
                catalog.append(_doc_to_entry(fqcn, docs[fqcn]))
            else:
                errors.append(f'{fqcn}: no doc (removed/alias), skipped')

    print(json.dumps(catalog, indent=2, sort_keys=False))
    if errors:
        print(f'--- {len(errors)} module(s) failed/skipped ---', file=sys.stderr)
        for e in errors[:40]:
            print(e, file=sys.stderr)


if __name__ == '__main__':
    main()
