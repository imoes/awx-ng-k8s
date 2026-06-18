#!/usr/bin/env bash
# awx-ng Init-Skript: Datenbank-Migration + Admin-User anlegen
# Läuft als One-Shot-Service vor awx_web/awx_task

set -e

ADMIN_USER="${AWX_ADMIN_USER:-admin}"
ADMIN_EMAIL="${AWX_ADMIN_EMAIL:-admin@awx-ng.local}"
ADMIN_PW="${AWX_ADMIN_PASSWORD:-}"

echo "[init] Receptor-Socket-Verzeichnis freigeben..."
chmod 777 /var/run/receptor 2>/dev/null || true

echo "[init] Migrationen ausführen..."
awx-manage migrate --no-input

echo "[init] Admin-User anlegen / Passwort setzen..."
if [ -z "$ADMIN_PW" ]; then
  echo "[init] WARNUNG: AWX_ADMIN_PASSWORD nicht gesetzt — Admin-User wird ohne Passwort angelegt"
fi

awx-manage shell << 'PYEOF'
from django.contrib.auth import get_user_model
import os
U = get_user_model()
admin_user = os.environ.get('AWX_ADMIN_USER', 'admin')
admin_email = os.environ.get('AWX_ADMIN_EMAIL', 'admin@awx-ng.local')
admin_pw = os.environ.get('AWX_ADMIN_PASSWORD', '')
u, created = U.objects.get_or_create(username=admin_user)
u.is_superuser = True
u.is_staff = True
u.email = admin_email
if admin_pw:
    u.set_password(admin_pw)
u.save()
print(f"[init] Admin-User: {admin_user} ({'neu' if created else 'aktualisiert'})")
PYEOF

echo "[init] Preload-Daten anlegen (Demo-Credential etc.)..."
awx-manage create_preload_data

echo "[init] Fertig."
