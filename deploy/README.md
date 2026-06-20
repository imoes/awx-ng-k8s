# awx-ng

AWX fork with Foreman-style variable management for Ansible automation.

Based on [AWX 24.6.1](https://github.com/ansible/awx) (Apache 2.0).

## What's different from upstream AWX?

| Feature | AWX upstream | awx-ng |
|---|---|---|
| Role variable extraction | ✗ | ✓ Scanned automatically after every git sync |
| Per-host aggregated variables | ✗ | ✓ Merged view: role defaults → group vars → host vars |
| Survey generation from roles | ✗ | ✓ One click → survey spec from role defaults |
| Location/Site management | ✗ | ✓ Sites + SSH keys per site, NetBox reconcile |
| Root password hashing | ✗ | ✓ sha512crypt, stored in host vars |
| NetBox integration | ✗ | ✓ Location reconcile, inventory source ready |
| SSO / Keycloak | optional | ✓ OIDC preconfigured via env vars |

Vollständige Schritt-für-Schritt-Dokumentation: **[WORKFLOW.md](WORKFLOW.md)**

## Quickstart

```bash
git clone https://github.com/imoes/awx-ng.git
cd awx-ng

# 1. Secrets generieren
mkdir -p secrets
python3 -c "import secrets; print(secrets.token_hex(32))" > secrets/secret_key
python3 -c "import secrets; print(secrets.token_hex(16))" > secrets/pg_password
chmod 600 secrets/*

# 2. Konfiguration anlegen
cp .env.example .env
$EDITOR .env   # mindestens AWX_ADMIN_PASSWORD und ANSIBLE_REPO_PATH setzen

# 3. Daten-Verzeichnisse anlegen
mkdir -p data/postgres data/redis data/projects
mkdir -p data/receptor && chmod 777 data/receptor

# 4. Bauen und starten
docker compose build
docker compose up -d

# 5. Status prüfen (Web-UI startet nach ~60s)
docker compose ps
```

Web-UI: **http://localhost:8052** — Login: `admin` / Passwort aus `.env`

## Voraussetzungen

- Docker ≥ 24
- Docker Compose v2
- 4 GB RAM, 20 GB freier Platz
- Erreichbares Ansible-Repository (Pfad in `ANSIBLE_REPO_PATH`)

## Architektur

```
Browser / API-Client
        │
        ▼
  ┌─────────────┐
  │  awx_web    │  nginx + uWSGI · Port 8052
  └──────┬──────┘
         │ Job-Dispatch
         ▼
  ┌─────────────┐
  │  awx_task   │  Dispatcher · Rollen-Scan-Hook
  └──────┬──────┘
         │ Receptor-Socket
         ▼
  ┌─────────────┐
  │   awx_ee    │  ansible-runner · führt Playbooks aus
  └─────────────┘
```

`AWX_DISABLE_CONTAINER_ISOLATION=True` — Jobs laufen direkt im `awx_ee`-Container,
kein nested Docker nötig.

## Konfiguration

### .env

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `AWX_ADMIN_PASSWORD` | ✓ | Admin-Passwort für die Web-UI |
| `ANSIBLE_REPO_PATH` | ✓ | Pfad zum Ansible-Repository auf dem Host |
| `NETBOX_URL` | — | NetBox-URL für Location-Reconcile |
| `NETBOX_TOKEN` | — | NetBox API-Token |
| `OIDC_ENDPOINT` | — | Keycloak-Endpoint (`https://.../auth/realms/<realm>`) |
| `OIDC_KEY` | — | Keycloak Client-ID |
| `OIDC_SECRET` | — | Keycloak Client-Secret |

### config/custom.py

Django-Settings-Overlay — wird als Bind-Mount eingehängt, kein Rebuild nötig.
Enthält u.a. `INSTALLED_APPS`, `NETBOX_URL`, `AWX_DISABLE_CONTAINER_ISOLATION`.

## Custom API-Endpoints

Alle Endpoints: `http://localhost:8052/api/v2/`

### Rollen-Variablen

```
GET  /api/v2/projects/{id}/role_variables/               # Variablen aus defaults/ + vars/
GET  /api/v2/projects/{id}/role_variables/?role_name=img_docker
POST /api/v2/projects/{id}/role_variables/scan/trigger/  # manueller Scan
GET  /api/v2/projects/{id}/role_tags/                    # Tags aus tasks/**/*.yml
GET  /api/v2/projects/{id}/role_tags/?role_name=img_system&tag_name=rootpw
GET  /api/v2/projects/{id}/role_handlers/                # Handlers aus handlers/main.yml
GET  /api/v2/projects/{id}/role_handlers/?role_name=img_docker
```

Scan läuft automatisch nach jedem erfolgreichen `git sync`.

### Host-Variablen

```
GET  /api/v2/hosts/{id}/aggregated_variables/   # gemergter Variablen-Stack
POST /api/v2/hosts/{id}/set_root_password/      # Passwort hashen + speichern
POST /api/v2/hosts/{id}/assign_roles/           # host_roles setzen
```

### Survey & Tools

```
POST /api/v2/job_templates/{id}/generate_survey/   # Survey aus Rollen erzeugen
POST /api/v2/tools/hash_password/                  # sha512crypt-Hash
```

### Standorte

```
GET  /api/v2/locations/               # alle Standorte
GET  /api/v2/locations/{id}/          # Location detail
POST /api/v2/locations/reconcile/     # Abgleich mit NetBox
```

## Rebuild nach Code-Änderungen

Custom-Code (`custom/`) ist ins Docker-Image gebaut — bei Änderungen:

```bash
docker compose build awx_web awx_task
docker compose up -d --no-deps awx_web awx_task
```

Config-Dateien (`config/`) sind Bind-Mounts — reicht `docker compose restart`.

## SSO / Keycloak

Keycloak-Setup (vom Keycloak-Admin):
1. Client `awx-ng` anlegen (confidential)
2. Redirect URI: `http://<host>:8052/sso/complete/oidc/`
3. Client-ID und Secret in `.env` eintragen (`OIDC_KEY`, `OIDC_SECRET`, `OIDC_ENDPOINT`)

## Projektstruktur

```
awx-ng/
├── Dockerfile          # AWX 24.6.1 Basis + unsere Patches
├── Dockerfile.ee       # Execution Environment (ansible-runner + receptor)
├── docker-compose.yml  # Dreiergespann: awx_web + awx_task + awx_ee
├── .env.example        # Konfigurationsvorlage
├── config/
│   ├── custom.py       # Django-Settings-Overlay
│   └── nginx_awx.conf  # nginx-Konfiguration
├── scripts/
│   ├── init_awx.sh              # DB-Migration + Admin-User beim ersten Start
│   └── launch_awx_task_ng.sh    # Task-Container-Entrypoint
├── receptor/
│   └── receptor-control.conf    # Receptor-Konfiguration
├── secrets/            # secret_key + pg_password (nicht in Git)
├── data/               # Laufzeit-Daten (nicht in Git)
└── custom/             # Unsere AWX-Patches und Erweiterungen
    └── awx/
        ├── customvars/           # Django-App (Models, API, Migrations)
        ├── api/urls/             # Gepatchte URL-Routen
        └── main/tasks/           # Gepatchte jobs.py + receptor.py
```

## Lizenz

Apache License 2.0 — Volltext in [LICENSE](LICENSE), Attributionen in [NOTICE](NOTICE).

awx-ng ist ein Fork von [ansible/awx](https://github.com/ansible/awx)
(Copyright Ansible, a Red Hat Company), lizenziert unter Apache 2.0.
Alle Modifikationen stehen ebenfalls unter Apache 2.0.
Geänderte AWX-Dateien tragen Änderungshinweise gemäß Apache 2.0 §4(b);
siehe NOTICE für die Liste der Modifikationen.
