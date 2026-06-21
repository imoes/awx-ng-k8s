# awx-ng — AWX 24.6.1 Fork mit Foreman-artiger Variablenverwaltung
# Basis: offizielles AWX 24.6.1-Image (ghcr.io/ansible/awx:24.6.1)
# Eigene Erweiterungen:
#   - awx.customvars Django-App (Rollen-Extraktion, Locations, Surveys)
#   - Gepatchte URL-Routen (api/urls/)
#   - Gepatchtes jobs.py (Rollen-Scan-Hook nach git-Sync)
#   - Gepatchtes receptor.py (Container-Isolation-Bypass)

FROM ghcr.io/ansible/awx:24.6.1

USER root

ENV AWX_PKG=/var/lib/awx/venv/awx/lib/python3.11/site-packages/awx

# ── nginx + Init-Skripte ──────────────────────────────────────────────────────
COPY config/nginx_awx.conf /etc/nginx/nginx.conf
COPY scripts/init_awx.sh /usr/local/bin/init_awx.sh
COPY scripts/launch_awx_task_ng.sh /usr/bin/launch_awx_task_ng.sh
RUN chmod +x /usr/local/bin/init_awx.sh /usr/bin/launch_awx_task_ng.sh

# ── awx.customvars installieren ───────────────────────────────────────────────
COPY custom/awx/customvars/ ${AWX_PKG}/customvars/

# ── Gepatchte URL-Routen einspielen ──────────────────────────────────────────
COPY custom/awx/urls.py                  ${AWX_PKG}/urls.py
COPY custom/awx/api/urls/project.py      ${AWX_PKG}/api/urls/project.py
COPY custom/awx/api/urls/job_template.py ${AWX_PKG}/api/urls/job_template.py
COPY custom/awx/api/urls/host.py         ${AWX_PKG}/api/urls/host.py
COPY custom/awx/api/urls/group.py        ${AWX_PKG}/api/urls/group.py
COPY custom/awx/api/urls/urls.py         ${AWX_PKG}/api/urls/urls.py

# ── Gepatchtes jobs.py + receptor.py einspielen ──────────────────────────────
COPY custom/awx/main/tasks/jobs.py     ${AWX_PKG}/main/tasks/jobs.py
COPY custom/awx/main/tasks/receptor.py ${AWX_PKG}/main/tasks/receptor.py

# ── Angepasste UI (gebaut aus dem geforkten awx/ui — siehe AGENT.md) ──────────
# Die UI wird auf dem Host gebaut (npm run build) und als custom/ui-build/
# eingecheckt. Sie muss an ZWEI Orten landen:
#   1. index.html-Template (Django TemplateView rendert es)
#   2. die statischen Assets unter /var/lib/awx/public/static/ (nginx serviert sie)
COPY custom/ui-build/index.html          ${AWX_PKG}/ui/build/index.html
COPY custom/ui-build/asset-manifest.json ${AWX_PKG}/ui/build/asset-manifest.json
COPY custom/ui-build/static/             ${AWX_PKG}/ui/build/static/
COPY custom/ui-build/static/js/          /var/lib/awx/public/static/js/
COPY custom/ui-build/static/css/         /var/lib/awx/public/static/css/
COPY custom/ui-build/static/media/       /var/lib/awx/public/static/media/

# ── watchdog + httpx (MCP-Tool-HTTP-Client) ──────────────────────────────────
RUN /var/lib/awx/venv/awx/bin/pip install --no-cache-dir watchdog==4.0.2 "httpx>=0.27,<1"

# ── .pyc-Cache invalidieren ──────────────────────────────────────────────────
RUN find ${AWX_PKG} -name "*.pyc" -delete && \
    find ${AWX_PKG} -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
