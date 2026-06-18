# awx-ng — Eigenes AWX-Image mit customvars-Erweiterungen
# Basis: offizielles AWX 24.6.1-Image
# Fügt hinzu:
#   - awx/customvars/ (neues Django-App-Modul)
#   - Gepatchte awx/api/urls/ (neue Routen)
#   - Gepatchtes awx/main/tasks/jobs.py (post_run_hook-Einhängung)
#   - nginx-Konfiguration (AWX-Proxy zu uWSGI/daphne)
#   - init_awx.sh (DB-Migration + Admin-User)

FROM ghcr.io/ansible/awx:24.6.1

USER root

# lib64 ist ein Symlink auf lib — beide Pfade funktionieren; lib ist kanonisch
ENV AWX_PKG=/var/lib/awx/venv/awx/lib/python3.11/site-packages/awx

# ── nginx-Konfiguration (AWX-Proxy zu uWSGI/daphne) ──────────────────────────
COPY deploy/config/nginx_awx.conf /etc/nginx/nginx.conf

# ── Init-Skript (DB-Migration + Admin-User) ───────────────────────────────────
COPY deploy/scripts/init_awx.sh /usr/local/bin/init_awx.sh
COPY deploy/scripts/launch_awx_task_ng.sh /usr/bin/launch_awx_task_ng.sh
RUN chmod +x /usr/local/bin/init_awx.sh /usr/bin/launch_awx_task_ng.sh

# ── awx.customvars installieren ───────────────────────────────────────────────
COPY awx/customvars/ ${AWX_PKG}/customvars/

# ── Geänderte URL-Dateien einspielen ─────────────────────────────────────────
COPY awx/api/urls/project.py      ${AWX_PKG}/api/urls/project.py
COPY awx/api/urls/job_template.py ${AWX_PKG}/api/urls/job_template.py
COPY awx/api/urls/host.py         ${AWX_PKG}/api/urls/host.py
COPY awx/api/urls/urls.py         ${AWX_PKG}/api/urls/urls.py

# ── Gepatchtes jobs.py einspielen ────────────────────────────────────────────
COPY awx/main/tasks/jobs.py ${AWX_PKG}/main/tasks/jobs.py

# ── .pyc-Cache invalidieren ──────────────────────────────────────────────────
RUN find ${AWX_PKG} -name "*.pyc" -delete && \
    find ${AWX_PKG} -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
# Hinweis: kein USER awx — der User wird vom Entrypoint (launch_awx_web.sh) dynamisch angelegt
