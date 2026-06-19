# awx-ng Deployment (docker-compose)

AWX-Fork 24.6.1 mit Foreman-artiger Variablenverwaltung (`awx.customvars`),
deployed als docker-compose-Stack.

> **Hinweis:** Docker-Compose ist upstream offiziell nur für Entwicklung vorgesehen.
> Wir akzeptieren das Upgrade-/HA-Risiko bewusst.

---

## Architektur: Das Dreiergespann

```
Browser / API-Client
        │
        ▼
  ┌─────────────┐
  │  awx_web    │  nginx + uWSGI, Port 8052
  │  (API + UI) │
  └──────┬──────┘
         │ Job-Dispatch (DB)
         ▼
  ┌─────────────┐
  │  awx_task   │  Django-Dispatcher (supervisord)
  │             │  – post_run_hook → Rollen-Scan
  └──────┬──────┘
         │ Receptor (Unix-Socket)
         ▼
  ┌─────────────┐
  │   awx_ee    │  ansible-runner + receptor
  │             │  – führt Playbooks aus
  └─────────────┘
```

`AWX_DISABLE_CONTAINER_ISOLATION=True` in `custom.py` — kein nested-Container-Start,
Jobs laufen direkt im awx_ee-Container via Receptor-Socket.

---

## Voraussetzungen

- Docker ≥ 24, Docker Compose v2
- 4 GB RAM, 20 GB freier Platz

---

## Einmalige Einrichtung

```bash
cd deploy/

# 1. Secrets generieren
python3 -c "import secrets; print(secrets.token_hex(32))" > secrets/secret_key
python3 -c "import secrets; print(secrets.token_hex(16))" > secrets/pg_password
chmod 600 secrets/*

# 2. .env anlegen (aus .env.example kopieren und anpassen)
cp .env.example .env
# Mindestens setzen: AWX_ADMIN_PASSWORD, ANSIBLE_REPO_PATH, NETBOX_URL, NETBOX_TOKEN

# 3. Images bauen
docker compose build

# 4. Stack starten
docker compose up -d

# 5. Beim ersten Start: Admin-Passwort setzen
docker compose exec awx_task awx-manage update_password --username admin --password <pw>
```

---

## Services

| Service     | Port  | Beschreibung                              |
|-------------|-------|-------------------------------------------|
| awx_web     | 8052  | AWX Web UI + API (http://localhost:8052)  |
| awx_task    | —     | AWX Task-Dispatcher + Rollen-Scan-Hook    |
| awx_ee      | —     | ansible-runner + Receptor                 |
| postgres    | —     | PostgreSQL 15 (intern)                    |
| redis       | —     | Redis 7 (intern)                          |

---

## Bind-Mounts vs. Docker-Image

**Bind-Mounts** (Änderung wirkt ohne Rebuild):

| Host-Pfad                        | Container-Pfad              |
|----------------------------------|-----------------------------|
| `deploy/config/custom.py`        | `/etc/tower/settings.py`    |
| `deploy/config/nginx_awx.conf`   | `/etc/nginx/nginx.conf`     |
| `deploy/data/projects/`          | `/var/lib/awx/projects/`    |
| `deploy/receptor/receptor-control.conf` | `/etc/receptor/receptor.conf` |
| `~/Dev/ansible/ansible03`        | `/var/lib/awx/ansible03`    |

**Im Docker-Image (COPY via Dockerfile)** — Rebuild nötig bei Änderungen:

- `awx/customvars/` — gesamte Custom-App
- `awx/main/tasks/jobs.py` — Rollen-Scan-Hook
- `awx/main/tasks/receptor.py` — Isolation-Bypass
- Alle anderen AWX-Patches

**Rebuild-Workflow:**

```bash
docker compose build awx_task   # oder awx_web / awx_ee
docker compose up -d --no-deps awx_task
```

Nicht `docker compose restart` — das zieht kein neues Image.

---

## Custom-App: awx.customvars

In `INSTALLED_APPS` registriert via `deploy/config/custom.py`.
Migrations liegen in `awx/customvars/migrations/`.

### Custom API-Endpoints

Alle Endpoints erfordern AWX-Authentication (Bearer Token oder Session).

#### Rollen-Variablen

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| GET | `/api/v2/projects/{id}/role_variables/` | Alle extrahierten Variablen eines Projekts |
| GET | `/api/v2/projects/{id}/role_variables/?role_name=img_docker` | Gefiltert nach Rolle |
| POST | `/api/v2/projects/{id}/role_variables/scan/trigger/` | Scan manuell anstoßen |

Scan läuft automatisch nach jedem erfolgreichen `git sync` (wenn `update_git` in job_tags).
Scannt `roles/*/defaults/main.yml` und `roles/*/vars/main.yml`.

#### Host-Variablen

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| GET | `/api/v2/hosts/{id}/aggregated_variables/` | Gemergter Variablen-Stack: role_defaults < group_vars < host_vars |
| POST | `/api/v2/hosts/{id}/set_root_password/` | Passwort hashen und in `rootpw`-Variable schreiben |
| POST | `/api/v2/hosts/{id}/assign_roles/` | `host_roles`-Variable setzen |

```bash
# Beispiel: Root-Passwort setzen
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8052/api/v2/hosts/3/set_root_password/ \
  -d '{"password": "geheim123"}'
# → {"var_name": "rootpw", "status": "set", "hash_prefix": "$6$..."}

# Beispiel: Rollen zuweisen
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8052/api/v2/hosts/3/assign_roles/ \
  -d '{"roles": ["img_docker", "img_system"]}'
```

#### Survey-Generierung

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| POST | `/api/v2/job_templates/{id}/generate_survey/` | Survey aus Rollen-Variablen erzeugen |

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8052/api/v2/job_templates/7/generate_survey/ \
  -d '{"role_names": ["img_docker", "img_system"], "project_id": 8}'
```

#### Tools

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| POST | `/api/v2/tools/hash_password/` | Passwort als sha512-Crypt hashen (ohne zu speichern) |

#### Standorte & Subnetze

| Methode | Endpoint | Beschreibung |
|---------|----------|--------------|
| GET | `/api/v2/locations/` | Alle Standorte |
| GET | `/api/v2/locations/{id}/` | Standort-Detail inkl. Subnetze |
| POST | `/api/v2/locations/reconcile/` | Standorte/Subnetze mit NetBox abgleichen (SSOT) |

`reconcile` überschreibt keine lokalen Daten — es meldet Drift.

---

## Rollen-Scan-Hook (jobs.py)

In `awx/main/tasks/jobs.py`, `RunProjectUpdate.post_run_hook()`:

```python
if status == 'successful' and 'update_git' in (instance.job_tags or 'update_git'):
    scan_project_roles(instance.project_id, project_path, revision)
```

Bedingung: `update_git` in job_tags — das ist bei jedem normalen git-Sync der Fall.
Reine Install-Runs (`install_roles` ohne `update_git`) lösen keinen Scan aus.

---

## SSO / Keycloak (vorbereitet, noch nicht aktiv)

Konfiguration in `deploy/.env` (Platzhalter):

```
OIDC_ENDPOINT=https://keycloak.ippen.media/auth/realms/<realm-name>
OIDC_KEY=awx-ng
OIDC_SECRET=<secret-vom-keycloak-admin>
OIDC_VERIFY_SSL=true
```

Vom Keycloak-Admin benötigt:
1. Client `awx-ng` anlegen (confidential)
2. Redirect URI: `http://<awx-host>:8052/sso/complete/oidc/`
3. Client-ID und Secret eintragen

OIDC wird in `custom.py` über die Env-Vars aktiviert (wenn alle drei gesetzt sind).

---

## Bekannte Einschränkungen

### netbox.netbox Collection fehlt in awx_ee

Die NetBox-Inventory-Source (`netbox.netbox.nb_inventory`) schlägt fehl, weil die
Collection nicht im awx_ee-Image installiert ist.

**Ursache:** Galaxy-API v3 inkompatibel mit ansible-core 2.15.12 (`KeyError: 'results'`);
docker-Container kann galaxy.ansible.com nicht erreichen.

**Workaround (noch nicht umgesetzt):**
- ansible-core in `deploy/Dockerfile.ee` auf ≥ 2.17 upgraden (hat Galaxy-Fix)
- oder: Collection von GitHub klonen, Tarball lokal bauen, via `COPY` einbinden

Tarball `netbox-netbox-3.20.0.tar.gz` liegt in `deploy/collections/` (nicht in Git).

---

## Secrets-Dateien (NICHT in Git einchecken!)

`deploy/secrets/` und `deploy/.env` sind in `.gitignore` ausgeschlossen:
- `secrets/secret_key` — Django SECRET_KEY
- `secrets/pg_password` — PostgreSQL-Passwort
- `.env` — Admin-Passwort, NetBox-Token, OIDC-Credentials
