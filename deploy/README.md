# awx-ng Deployment (docker-compose)

Production-ähnliches docker-compose-Setup für den awx-ng-Fork (AWX 24.6.1).
> **Hinweis:** Docker-Compose ist upstream offiziell nur für Entwicklung vorgesehen.
> Wir akzeptieren das Upgrade-/HA-Risiko bewusst.

## Voraussetzungen

- Docker ≥ 24, Docker Compose v2
- 4 GB RAM, 20 GB freier Platz

## Einmalige Einrichtung

```bash
cd deploy/

# 1. Secrets generieren
python3 -c "import secrets; print(secrets.token_hex(32))" > secrets/SECRET_KEY   # Alias: secret_key
python3 -c "import secrets; print(secrets.token_hex(16))" > secrets/pg_password
# Korrekten Dateinamen für Docker Secrets:
cp secrets/SECRET_KEY secrets/secret_key
chmod 600 secrets/*

# 2. Optional: Ansible03-Repo-Pfad setzen (Standard: ~/Dev/ansible/ansible03)
export ANSIBLE_REPO_PATH=/home/mutkluge/Dev/ansible/ansible03

# 3. Stack starten
docker compose up -d

# 4. Beim ersten Start: Admin-Passwort setzen
docker compose exec awx_task awx-manage createsuperuser
# oder:
docker compose exec awx_task awx-manage update_password --username admin --password <pw>
```

## Services

| Service     | Port | Beschreibung |
|-------------|------|--------------|
| awx_web     | 8052 | AWX Web UI + API (http://localhost:8052) |
| awx_task    | —    | AWX Task/Dispatcher |
| postgres    | —    | PostgreSQL 15 (intern) |
| redis       | —    | Redis 7 (intern) |

## Volumes

| Volume         | Inhalt |
|----------------|--------|
| postgres_data  | Datenbankdateien |
| awx_projects   | Geklonte SCM-Projekte (/var/lib/awx/projects/) |
| awx_receptor   | Receptor-Socket |

## Custom Settings

`deploy/config/custom.py` → wird in `/etc/tower/conf.d/custom.py` gemountet.
Enthält DB, Redis, Channel-Layers, AWX_NG_ANSIBLE03_PATH, INSTALLED_APPS-Erweiterung.

## Update

```bash
# Neues AWX-Image für nächsten Stable-Tag:
# 1. IMAGE-Version in docker-compose.yml ändern
# 2. docker compose pull
# 3. docker compose up -d
# 4. docker compose exec awx_task awx-manage migrate
```

## Secrets-Dateien (NICHT in Git einchecken!)

`deploy/secrets/` enthält:
- `secret_key` — Django SECRET_KEY
- `pg_password` — PostgreSQL-Passwort

Die Dateien sind in `.gitignore` ausgeschlossen.
