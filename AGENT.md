# AGENT.md — awx-ng Fork-Wartung

Anleitung für KI-Agenten (und Menschen), die diesen AWX-Fork pflegen — besonders
beim **Upgrade auf eine neue AWX-Version**. Lies das zuerst.

## Was ist awx-ng?

Fork von **AWX 24.6.1** mit Foreman-artiger Variablenverwaltung. Zwei Repos:

| Repo | Pfad | Zweck |
|---|---|---|
| Dev-Repo (dieses) | `/home/mutkluge/Dev/code/ansible-manager/` | Voller AWX-Quellcode + unsere Patches. Branch `custom`. Hier wird entwickelt und rebased. |
| Public-Repo | `deploy/` (eigenes `.git/`) | Self-contained Deployment. `git clone && docker compose build`. Nur unsere Dateien + gebaute UI. |

**Grundprinzip:** Core-Eingriffe minimal halten. Eigenständiger Code lebt in
`awx/customvars/` (Backend) und `awx/ui/src/screens/CustomVars/` (UI). Nur eine
Handvoll Upstream-Dateien wird angefasst — die müssen beim Versionssprung geprüft werden.

## Unsere Änderungen am Upstream (die „Patch-Oberfläche")

### Backend — neue, eigenständige Dateien (kollidieren fast nie beim Rebase)
- `awx/customvars/` — komplette Django-App (Models, API, Migrations, extract.py)

### Backend — gepatchte Upstream-Dateien (beim Versionssprung PRÜFEN)
| Datei | Änderung |
|---|---|
| `awx/main/tasks/jobs.py` | In `RunProjectUpdate.post_run_hook` Aufruf von `scan_project_roles` (nach git-Sync). Suche Marker `awx-ng:`. |
| `awx/main/tasks/receptor.py` | Container-Isolation-Bypass bei `AWX_DISABLE_CONTAINER_ISOLATION`. Suche Marker `_disable_isolation`. |
| `awx/api/urls/project.py` | Routen: `role_variables/`, `role_tags/`, `role_handlers/`, `scan/…` |
| `awx/api/urls/host.py` | Routen: `aggregated_variables/`, `set_root_password/`, `assign_roles/`, `role_variables/…` |
| `awx/api/urls/job_template.py` | Route: `generate_survey/` |
| `awx/api/urls/urls.py` | Routen: `locations/…`, `execution_node_locations/…`, `tools/hash_password/` |

Alle Eingriffe sind **additiv** und mit `# awx-ng:` markiert. Beim Rebase:
`git log --oneline` der custom-Commits durchgehen, Marker `awx-ng` in den obigen
Dateien suchen, additive Zeilen erneut einfügen.

### UI — neue, eigenständige Dateien
- `awx/ui/src/screens/CustomVars/` — alle eigenen Screens (Locations, Subnetze,
  Runner-Site, Host-Variablen-Verwaltung)
- `awx/ui/src/customvars.css` — CSS-Tweaks (u.a. größeres Host-Variablenfeld)

### UI — gepatchte Upstream-Dateien (beim Versionssprung PRÜFEN)
| Datei | Änderung |
|---|---|
| `awx/ui/src/routeConfig.js` | Import der CustomVars-Screens + neue Navigationsgruppe „awx-ng". Marker `awx-ng:`. |
| `awx/ui/src/index.js` | Import von `customvars.css`. Marker `awx-ng:`. |

## UI bauen & ins Image bringen

Die UI (React 17 + PatternFly 4, Create-React-App) wird **auf dem Host** gebaut und
als `deploy/custom/ui-build/` eingecheckt. Das Image kopiert sie an zwei Orte:
1. `…/site-packages/awx/ui/build/index.html` (Django-Template)
2. `/var/lib/awx/public/static/{js,css,media}/` (nginx serviert die Assets)

```bash
# Voraussetzung: Node ≥ 18 (getestet: Node 22)
./build-ui.sh            # baut awx/ui → deploy/custom/ui-build/
./build-ui.sh --clean    # mit frischem npm ci (--force, wg. React-16-Peer-Konflikten)

cd deploy
docker compose build awx_web awx_task
docker compose up -d --no-deps awx_web awx_task
```

**Wichtig:** `npm ci` braucht `--force` (steht im `build-ui.sh`), weil alte
Enzyme-Pakete React 16 als Peer fordern — sonst ERESOLVE-Abbruch. Das ist ein
bekanntes Alt-AWX-UI-Problem, kein Fehler in unserem Code.

## Versionssprung-Checkliste (z.B. 24.6.1 → nächster Stable-Tag)

1. **Upstream mergen** im Dev-Repo: `git fetch upstream && git rebase upstream/<tag> custom`
   (`git rerere` vorher aktivieren — wiederkehrende Konflikte lösen sich dann selbst).
2. **Backend-Patches prüfen** — die 6 Dateien oben; Marker `awx-ng:` wieder einfügen
   wo der Rebase sie verworfen hat. `awx/customvars/` bleibt meist unberührt.
3. **UI prüfen:** Hat sich `routeConfig.js`-Struktur geändert? PatternFly-Major-Sprung?
   - Bei PatternFly 4 → 5 (ab AWX ~24.x devel): Imports/Props der CustomVars-Screens
     anpassen (Komponenten-API ändert sich). Das ist der größte Posten.
4. **Basis-Image-Tag** in `deploy/Dockerfile` (`FROM ghcr.io/ansible/awx:<tag>`) und
   `deploy/Dockerfile.ee` hochziehen.
5. **UI-Build-Pfad prüfen:** Im neuen Image `…/site-packages/awx/ui/build/index.html`
   und `/var/lib/awx/public/static/js/` verifizieren (kann sich versionsabhängig ändern).
6. **Migrations:** `docker compose run --rm awx_init awx-manage migrate customvars`
7. **Bauen, hochfahren, Smoke-Test** (siehe deploy/README.md → Custom-API-Endpoints).
8. **In BEIDE Repos committen** (Dev-Repo + `deploy/`). `deploy/custom/` muss die
   gesyncten Dateien + neu gebaute `ui-build/` enthalten.

## Sync-Regel Dev-Repo → Public-Repo

Nach jeder Backend-Änderung die geänderte Datei nach `deploy/custom/awx/…` kopieren.
Nach jeder UI-Änderung `./build-ui.sh` laufen lassen (synct `deploy/custom/ui-build/`).
Dann in beiden Repos committen.

## Rebuild-Regel (Bind-Mount vs. Image)

- **Bind-Mount, kein Rebuild:** `deploy/config/custom.py`, `config/nginx_awx.conf`,
  `data/`, `receptor/*.conf`
- **Im Image, Rebuild nötig:** alles unter `deploy/custom/` (Backend-Patches + UI)
  → `docker compose build … && docker compose up -d --no-deps …` (NICHT `restart`)
