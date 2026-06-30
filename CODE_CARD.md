# AWX-ng Code Card

Technische Referenz für das AWX-ng Projekt. Wird von Claude bei Bedarf gelesen.

## Repos & Verzeichnisse

| Repo | Pfad | Branch | Remote |
|------|------|--------|--------|
| Quellcode | `/home/mutkluge/Dev/code/ansible-manager/` | `main` | — (lokal) |
| Deploy | `/home/mutkluge/Dev/code/ansible-manager/deploy/` | `master` | `github.com/imoes/awx-ng-docker` |

## Zugangsdaten

| | |
|-|-|
| Admin-User | `admin` |
| Admin-Passwort | in `deploy/.env` → `AWX_ADMIN_PASSWORD` (aktuell: `9xmg82bw`) |
| Port intern | 8050 (uWSGI) |
| Port extern | 8052 (nginx) |

GitHub-Account: `imoes` — Deploy-Repo: `github.com/imoes/awx-ng-docker` (branch: `master`)

## Workflow (Änderung → Live)

```bash
# 1. Datei im Quellcode-Repo bearbeiten

# 2. Backend-Dateien nach deploy/ syncen
cp awx/customvars/api.py deploy/custom/awx/customvars/api.py

# 3. UI bauen (nur bei UI-Änderungen)
cd awx/ui
DISABLE_ESLINT_PLUGIN=true INLINE_RUNTIME_CHUNK=false npx react-scripts build
# ALLE DREI syncen — fehlt index.html, lädt der Browser das alte Bundle!
cp build/index.html ../../deploy/custom/ui-build/index.html
cp build/asset-manifest.json ../../deploy/custom/ui-build/asset-manifest.json
cp -r build/static ../../deploy/custom/ui-build/

# 4. Image bauen und Container neu starten (NICHT restart!)
cd ../../deploy
docker compose build awx_web awx_task
docker compose up -d awx_web awx_task

# 5. Migrations (nur wenn models.py geändert)
docker compose exec awx_web awx-manage migrate customvars
# oder: docker compose run --rm awx_init awx-manage migrate customvars
# Status prüfen: docker compose exec awx_web awx-manage showmigrations customvars

# 6. Dokumentation + Commit in BEIDEN Repos (Pflicht!)
# README.md + README-de.md + CLAUDE.md aktualisieren, dann:
cd /home/mutkluge/Dev/code/ansible-manager && git add ... && git commit
cd deploy && git add ... && git commit
```

**`docker compose restart` lädt kein neues Image** → immer `up -d` verwenden.

## Deployment-Struktur

```
deploy/
├── Dockerfile                      # FROM ghcr.io/ansible/awx:24.6.1
├── Dockerfile.ee                   # ansible-runner EE
├── docker-compose.yml              # awx_web + awx_task + awx_ee + postgres + redis
├── docker-compose.override.yml     # GITIGNORED: Proxy, lokale Ports
├── .env                            # GITIGNORED: Secrets
├── config/nginx_awx.conf           # nginx (Bind-Mount, kein Rebuild nötig)
├── config/custom.py                # Django-Settings-Overlay (Bind-Mount)
└── custom/awx/
    ├── customvars/                 # Django-App (models, api, migrations, mcp/)
    ├── api/urls/                   # Gepatchte URL-Routen
    └── main/tasks/jobs.py, receptor.py
```

**Kein Rebuild nötig** (Bind-Mounts): `config/custom.py`, `config/nginx_awx.conf`  
**Rebuild nötig**: alles unter `custom/awx/`, `custom/ui-build/`

### Ansible-Repo-Mount

Das Ansible-Repo wird in alle drei Container gemountet:
```yaml
- ${ANSIBLE_REPO_PATH}:/var/lib/awx/projects/ansible03:rw
```
AWX-Projekt: SCM Type **Manual**, `local_path = ansible03`.  
Mount in alle drei Services nötig (`awx_web` schreibt, `awx_task` refresht Cache, `awx_ee` führt aus).

## Custom UI-Screens

| Pfad | Screen | Beschreibung |
|------|--------|-------------|
| `/editor` | ProjectEditor | Playbook-Editor mit Dateibaum (Monaco + YAML-Linting + Git) |
| `/playbooks` | Playbooks | Playbook-Übersicht mit Vars/Plays |
| `/roles` | Roles | Rollen mit Variablen, Tags, Handlers |
| `/tokens` | UserTokens | Persönliche OAuth2-Token (Bearer-Auth für MCP) |
| `/locations` | Sites | Site-Verwaltung (= AWX Instance Groups) |
| `/runner_sites` | Runners | Execution Nodes registrieren und Sites zuweisen |
| `/vaults` | Vaults | Ansible Vault Store (Key-Value → verschlüsselte YAML, Auto-Inject beim Job) |

## Custom API-Endpoints

### Dateien & Git
```
GET    /api/v2/projects/{id}/files/                  # Dateibaum
GET    /api/v2/projects/{id}/files/content/?path=... # Datei lesen
PUT    /api/v2/projects/{id}/files/content/?path=... # Datei schreiben
DELETE /api/v2/projects/{id}/files/content/?path=... # Datei löschen
POST   /api/v2/projects/{id}/files/rename/           # Datei umbenennen
POST   /api/v2/projects/{id}/files/upload/           # Upload (tar.gz etc.)
GET    /api/v2/projects/{id}/git/                    # Status, Branch, Log
POST   /api/v2/projects/{id}/git/                    # {"action": "commit"|"push"}
```

### Playbooks & Rollen
```
GET  /api/v2/projects/{id}/plays/                    # Playbook-Liste (live Disk-Scan)
GET  /api/v2/projects/{id}/plays/?playbook=x         # Play-Metadaten
GET  /api/v2/projects/{id}/role_variables/           # Variablen aus Rollen
POST /api/v2/projects/{id}/role_variables/scan/trigger/
POST /api/v2/job_templates/{id}/generate_survey/     # Survey aus Rollen generieren
POST /api/v2/projects/{id}/launch/                   # Job starten
```

### Host-Variablen
```
GET    /api/v2/hosts/{id}/aggregated_variables/      # Zusammengeführter Variablen-Stack
POST   /api/v2/hosts/{id}/assign_roles/              # Rollen zuweisen
POST   /api/v2/hosts/{id}/clone/                     # Host klonen
POST   /api/v2/hosts/{id}/run/                       # Job für diesen Host starten
```

### Sites & Runner
```
GET/POST   /api/v2/locations/                        # Sites auflisten / anlegen
PATCH/DEL  /api/v2/locations/{id}/
POST       /api/v2/locations/reconcile/              # NetBox-Abgleich
GET/POST   /api/v2/execution_node_locations/         # Runner-Site-Zuordnungen
POST       /api/v2/runners/register/
POST       /api/v2/runners/deprovision/
```

### Ansible Vault Store
```
GET    /api/v2/vaults/                               # Alle Vaults (ohne Passwort/Variablen)
POST   /api/v2/vaults/                               # Vault anlegen (generiert Passwort + AWX-Credential)
GET    /api/v2/vaults/{id}/                          # Vault mit Klartext-Variablen
PATCH  /api/v2/vaults/{id}/                          # Variablen / Beschreibung ändern
DELETE /api/v2/vaults/{id}/                          # Vault + AWX-Credential löschen
POST   /api/v2/vaults/{id}/generate/                 # Verschlüsselte Vault-Datei erzeugen
                                                     # Body: {"project_id": N} → schreibt in Projekt
```

### Tokens & MCP
```
GET/POST  /api/v2/tokens/                            # Persönliche OAuth2-Tokens
DELETE    /api/v2/tokens/{id}/
GET/POST  /mcp                                       # MCP-Server (JSON-RPC 2.0, Bearer-Auth)
```

## Architektur-Details

### AWX APIView — `**kwargs` Pflicht
**Jede** `APIView`-Methode muss `**kwargs` im Signature haben:
```python
def get(self, request, **kwargs): ...
def post(self, request, **kwargs): ...
```
Ohne `**kwargs`: `TypeError: got an unexpected keyword argument 'version'` — AWX URL-Routing übergibt `version` als kwarg.

### ansible-vault CLI
`ansible-vault` **nur in `awx_ee`** verfügbar, **nicht in `awx_web`**.  
→ Vault-Datei-Generierung in `awx_web` muss via `cryptography`-Library (pure Python) erfolgen.  
→ `cryptography` ist im `awx_web` venv verfügbar.

### Ansible Vault Store
`AnsibleVault`-Modell (`customvars/models.py`): Klartext-JSONField `variables` + auto-generiertes Passwort (`secrets.token_urlsafe(32)`). Beim Anlegen wird automatisch ein AWX-Credential (`kind=vault`, vault_id=Name) erstellt.

**`_ansible_vault_encrypt()` Algorithmus** (Vault 1.2 Format):
- PBKDF2-SHA256: salt=32B, 10000 Iterations, dklen=80 → key1 (32B AES) + key2 (32B HMAC) + iv (16B)
- AES-256-CTR mit exakt 16-Byte-Nonce (`key_material[64:80]`, NICHT 20 Bytes!)
- HMAC-SHA256 über Ciphertext
- Header: `$ANSIBLE_VAULT;1.2;AES256;{vault_id}`, Body als 80-Zeichen-Hex-Zeilen

**Auto-Injection**: `inject_runner_credential_for_job()` injiziert alle Vault-Credentials beim Job-Start automatisch.

**Playbook-Verwendung**:
```yaml
vars_files:
  - vault-meine-vault.yml   # per POST /api/v2/vaults/{id}/generate/ erzeugt
```

### Playbook-Cache
`project.playbook_files` (JSONField) wird nur beim Project-Sync aktualisiert.  
Editor-Endpunkte rufen `_refresh_playbook_cache(pk)` auf. `could_be_playbook()` prüft Dateiinhalt — nur Dateien mit `hosts:` / `import_playbook:` / `include:` werden erkannt.

### Credential-Injection (SSH)
`ExecutionNodeLocation.ssh_credential_id` → bei Job-Start per `post_save`-Signal in `apps.py:_on_job_created` automatisch injiziert (matched über `execution_node`-Hostname oder Single-Runner-Fallback).

### Runner / Instance Groups
`ExecutionNodeLocation`-Modell: `instance_hostname` = AWX-Instanz-Hostname, `location_name` = Site-Name.  
Lookup im Job-Template-Picker: `GET /api/v2/instance_groups/?instances__hostname={hostname}`

### Migrations (wenn models.py geändert)
```bash
docker compose exec awx_web awx-manage migrate customvars
docker compose exec awx_web awx-manage showmigrations customvars
```
`awx_init` greift manchmal nicht — direkt in laufendem Container ausführen.

## MCP-Server (AWX-ng)

- Endpoint: `https://<host>/mcp` (JSON-RPC 2.0)
- Auth: Bearer-Token (OAuth2) oder Django-Session
- Token erstellen: UI → Resources → API Tokens oder `POST /api/v2/tokens/`
- Tools: `awx_run_playbook`, `awx_list_inventories`, `awx_list_projects`, etc.
