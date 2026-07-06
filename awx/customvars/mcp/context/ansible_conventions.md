---
name: ansible
title: Ansible Conventions (Geerling)
description: Best-practice conventions for Ansible — inventory, group_vars/host_vars, variable precedence, roles (defaults vs vars), playbook/role layout, idempotence. Grounded in Jeff Geerling's "Ansible for DevOps". Use when authoring or reviewing Ansible playbooks/roles or designing variable structure. Also maps these conventions onto awx-ng.
skill_type: domain-knowledge
---

# Ansible Conventions — Jeff Geerling style

Reference cheat-sheet for writing clean, maintainable Ansible. Based on Jeff
Geerling's *Ansible for DevOps* (manuscript: `github.com/geerlingguy/ansible-for-devops-manuscript`,
examples: `github.com/geerlingguy/ansible-for-devops`, CC BY-SA 4.0). Use it when
authoring/reviewing playbooks & roles, or deciding *where a variable belongs*.

## Golden rules

1. **Variables don't live in the inventory file.** Put them in `group_vars/` and
   `host_vars/` directories next to the inventory (or playbook). Keep the inventory
   about *which hosts exist and which groups they're in*.
2. **Tunables go in `defaults/main.yml`** (lowest precedence, meant to be overridden).
   Fixed / platform-specific values go in `vars/main.yml` (high precedence).
3. **Playbooks map roles to host groups.** A play is `hosts: <group> ; roles: [...]`.
   Steer behaviour via variables, not by editing the role.
4. **Idempotence first.** Use modules (not `command`/`shell`) where possible; when you
   must shell out, add `creates:`/`removes:` or a `changed_when:`/`when:` guard.
5. **Name everything.** Every task gets a `name:`. Comment non-obvious intent.

## Directory layout

```
inventory/
  hosts                 # INI/YAML: groups + host membership (no vars here)
group_vars/
  all.yml               # defaults for every host
  <group>.yml           # per-group vars (e.g. webservers.yml, docker.yml)
host_vars/
  <hostname>.yml        # per-host overrides
roles/
  <role>/
    defaults/main.yml   # overridable tunables  (LOW precedence)
    vars/main.yml       # fixed / platform vars (HIGH precedence)
    tasks/main.yml
    handlers/main.yml
    templates/  files/  meta/main.yml
playbooks/
  site.yml              # maps roles → groups
ansible.cfg             # roles_path, inventory, forks, …
requirements.yml        # external roles/collections (pin versions)
```

## Variable precedence (low → high — the ones that matter daily)

1. role `defaults/main.yml`
2. `group_vars/all`
3. `group_vars/<group>` (parent groups before child groups)
4. inventory inline host vars
5. `host_vars/<host>`
6. `vars/main.yml` of a role (and `vars:` in a play)
7. task vars / `set_fact` / blocks
8. **extra vars** (`-e` on the CLI) — always wins

Mental model: *defaults are suggestions, host_vars are decisions, `-e` is an override hammer.*

## Roles

- One role = one logically-coupled concern (e.g. `docker`, `nginx`), loosely coupled,
  reusable. Bundle related config together.
- `defaults/main.yml`: everything a consumer might want to change — give sane defaults.
- `vars/main.yml`: things the role needs but consumers shouldn't tweak (e.g. package
  names per OS). Pattern: define `__role_pkg` in `vars/`, then `set_fact` to the public
  var so a playbook can still override it.
- `meta/main.yml`: `galaxy_info`, `dependencies`, supported `platforms`,
  `min_ansible_version`.
- `handlers/main.yml`: service restarts etc., triggered via `notify:`.

## YAML & task style

- Spaces only, never tabs. 2-space indent.
- Quote ambiguous scalars (`"yes"`, version numbers) to avoid type coercion.
- Prefer structured `key: value` (one param per line) over one-line `k=v` — better
  diffs, preserves types. Reserve folded scalars (`>`) for long `command`/`shell`.
- Split files: >15–20 tasks → break into `tasks/<topic>.yml` via `import_tasks`/
  `include_tasks`; keep playbooks readable.

## Dependencies & execution

- `requirements.yml` + project-level `ansible.cfg` to pin role/collection versions.
- Vet community roles: maintenance, downloads, readable code, before adopting.
- Raise `--forks` above the default 5 for larger fleets.
- Run from a central controller (AWX/Tower) rather than laptops for shared infra.

## How this maps onto awx-ng

awx-ng (our AWX fork) surfaces these conventions in the WebUI — same model, no second
source of truth (everything lands in native AWX `Host.variables` / `Group.variables`):

| Ansible concept | awx-ng location |
|---|---|
| role `defaults/main.yml` (scanned) | **Roles** screen; shown as the baseline in Role Variables tabs |
| `host_vars/<host>` | Host → **Role Variables** tab (main editor) + raw YAML on Details/Edit |
| `group_vars/<group>` | Inventory Group → **Variables** tab (structured) or native group vars |
| precedence role<group<host | `GET /api/v2/hosts/{id}/aggregated_variables/` (shows layers) |
| playbook → group mapping | **Playbooks** screen (plays: target hosts, roles, tags) |
| `--limit` host pattern | Job Template **Limit** field + "Select from inventory" picker |
| editing playbooks/roles | **Playbook Editor** (Monaco + YAML/ansible-lint) |
| facts | populate via a Job Template with "Enable Fact Storage" + `gather_facts` |

Rule of thumb in awx-ng: **shared config → group variables; exceptions → host variables;
sensible baselines → role defaults.**

## Quick references

- Variables guide: https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html
- Geerling manuscript (best practices): `appendix-b.txt`; inventory/variables/roles:
  `chapter3`–`chapter6` of the manuscript repo.
