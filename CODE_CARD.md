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
**Resources:**
| `/editor` | ProjectEditor | Playbook-Editor mit Dateibaum (Monaco + YAML-Linting + Git) |
| `/playbooks` | Playbooks | Playbook-Übersicht mit Vars/Plays |
| `/roles` | Roles | Rollen mit Variablen, Tags, Handlers |
| `/vaults` | Vaults | Ansible Vault Store (Key-Value → verschlüsselte YAML, Auto-Inject beim Job) |
| `/playbook-builder` | PlaybookBuilder | Visueller Blockly-Playbook-Builder (siehe eigener Abschnitt unten) |

**Administration:**
| `/locations` | Sites | Site-Verwaltung (= AWX Instance Groups) |
| `/runner_sites` | Runners | Execution Nodes registrieren und Sites zuweisen |
| `/tokens` | UserTokens | Persönliche OAuth2-Token (Bearer-Auth für MCP) |

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
- **PKCS7-Padding auf 16-Byte-Blockgröße VOR der Verschlüsselung** (Ansible macht das auch bei CTR!)
- AES-256-CTR mit exakt 16-Byte-Nonce (`key_material[64:80]`)
- HMAC-SHA256 über Ciphertext
- Header: `$ANSIBLE_VAULT;1.2;AES256;{vault_id}`, Body als 80-Zeichen-Hex-Zeilen
- Ohne PKCS7-Padding: Entschlüsselung schlägt mit `Invalid padding bytes` fehl

**Auto-Injection**: `inject_runner_credential_for_job()` injiziert alle Vault-Credentials beim Job-Start automatisch.

**Playbook-Verwendung**:
```yaml
vars_files:
  - vault-freeipa_client.yml   # Pfad relativ zum Playbook! → bei playbooks/docker.yml liegt
```                             # die Vault-Datei unter playbooks/vault-freeipa_client.yml

**Workflow**: Vault anlegen → Variablen setzen → "Generate" → Datei in Projektpfad schreiben →
`vars_files` im Playbook (Pfad relativ zum Playbook-Verzeichnis!)

### Playbook Builder (Blockly) — `/playbook-builder`
Visueller Block-Editor für Playbooks (analog ioBroker.javascript-Blockly). Reines
Frontend-Feature — Backend liefert nur bereits existierende Endpunkte (Dateien lesen/schreiben/linten,
Projekt-Rollen, Rollen-Variablen, Vaults). Einzige Backend-Änderung: `.json` zu
`_ALLOWED_SUFFIXES` (`customvars/api.py`) für den Blockly-Sidecar. Nutzer-Anleitung:
`awx/ui/src/screens/CustomVars/playbookBuilder/README.md`.

**Frontend-Dateien**: `awx/ui/src/screens/CustomVars/playbookBuilder/`
| Datei | Zweck |
|-------|-------|
| `BlocklyWorkspace.js` | React-Wrapper um `Blockly.inject` (kein `react-blockly` — React-18-Peer-Dependency-Konflikt; dieses UI läuft auf React 17). `horizontalLayout`+`toolboxPosition:'start'` → Kategorien als Navbar oben statt Baum links; `height`-Prop |
| `blocks.js` | Blockdefinitionen: `play`, `role_use`, `raw_task` (Fallback), + 1 Block pro Katalog-Modul, + Condition-Blöcke (`cond_*`), + Task-Setting-Blöcke (`setting_*`). **Modul-Block = Task** (kein separater Task-Wrapper, `setPreviousStatement/setNextStatement(true,'Task')` direkt auf dem Modul-Block). Zwei getrennte Dropdowns: „add parameter…" (Modul-eigene Optional-Args) und „add task setting…" (erzeugt+verkettet einen `setting_*`-Mini-Block im `SETTINGS`-Statement-Input — siehe unten) |
| `moduleCatalog.generated.json` | Auto-generierter Katalog **aller 71 `ansible.builtin`-Module** (`tools/gen-module-catalog.py`, läuft via `ansible-doc -j` in `awx_ee`) — inkl. `type` je Param (`str`/`bool`/`int`/`float`/`path`/`list`/`dict`/`raw`) |
| `toolbox.js` | Kategorien Play/Modules/Roles/Raw. **Modules und Roles sind dynamische Blockly-`custom`-Kategorien** (`registerToolboxCategoryCallback`) statt statischer `contents` — ermöglicht kategorie-scoped Live-Suche (siehe unten). `moduleFlyoutContents(filter)` / `roleFlyoutContents(roleNames, filter)` sind eigenständig testbar |
| `ansibleGenerator.js` | Blöcke → `plays[]`-Objektbaum → `jsonToYaml()` (bestehendes Util, kein Blockly-eigener String-Generator). `coerceModuleArgValue()` parst jeden Feldwert typgerecht (list/dict/int/float/raw) anhand `paramTypes_`. `conditionBlockToExpr()` wandelt einen Condition-Block-Baum (siehe unten) in den Jinja-Ausdruck für `when:` |
| `playbookImporter.js` | Inverse: YAML → Blöcke; `importPlaybookYaml` (Plays) + `importTasksYaml` (Rollen-Task-Liste); unbekannte Module/Konstrukte als `raw_task` verlustfrei |
| `conditionParser.js` | Best-effort Parser: `when:`-Jinja-Text → Condition-Block-Baum (`parseConditionToBlock`), Fallback `cond_raw` bei nicht unterstützter Grammatik (Filter, Funktionsaufrufe, …) |
| `blocklyUtil.js` | Gemeinsames `newBlock()` (init/render-Guard für Headless-Jest-Workspaces), von `playbookImporter.js` + `conditionParser.js` genutzt |
| `VariablesPanel.js` + `varInsertion.js` | Rechte Variablen-Palette — Rollen-Variablen des aktuellen Dokuments + Vault-Variablen + **`ansible_facts` (immer sichtbar, unabhängig vom Projekt)**; zeigt je Variable Wert/Default bzw. Kurzbeschreibung; Drag&Drop auf ein **Textfeld** fügt `{{ name }}` ein, Drop auf die **leere Canvas** erzeugt stattdessen einen echten `cond_var`-Block (Variable als Blockly-Element, direkt in eine Bedingung einklinkbar) |
| `ansibleFacts.js` | Kuratierte Liste von ~58 `ansible_facts` (System/Hardware/Memory/Netzwerk/Storage/Datum-Zeit/User/Security/Software/Virtualisierung/Custom-Facts) + ~13 „Magic Variables" (`inventory_hostname`, `group_names`, `groups`, `hostvars`, …), abgeglichen gegen `docs.ansible.com/.../playbooks_vars_facts.html`. Facts existieren erst zur Laufzeit auf dem Zielhost, Magic Variables werden von Ansible selbst berechnet — beides daher nicht dynamisch erkennbar (Analogon zu `CURATED_CHOICES` in `blocks.js`). Zwei getrennte Exporte (`ANSIBLE_FACT_VARIABLES`, `ANSIBLE_MAGIC_VARIABLES`), im Panel unterschiedlich getaggt (`ansible fact` vs. `magic variable`) |
| `sidecarPath.js` | `playbooks/site.yml` → `playbooks/site.blockly.json` (Workspace-Layout-Sidecar) |

**Plugins** (Blockly 11 — passende Peer-Versionen!): `@blockly/field-multilineinput@5.0.17` (`registerFieldMultilineInput()`, mehrzeilige Felder für alle Text-Params + `EXTRA`/`RAW_YAML`/`VARS`). **Nicht** die neueste Version nehmen — v13.x verlangt Blockly ^13. `@blockly/toolbox-search` wurde **wieder entfernt** — es durchsucht alle Kategorien gemeinsam; ersetzt durch eigene kategorie-scoped Suche (siehe unten).

**New / Öffnen-Dialog (Hamburger-Menü) & Doc-Mode**: „New playbook"/„New role"/„Open playbook…"/„Open role…" liegen in einem PatternFly-`Dropdown` (☰-Icon, `pb-file-menu-toggle`), nicht mehr als vier Einzel-Buttons. „Open playbook…" listet Playbooks (`/plays/`), „Open role…" listet Rollen (`/roles/`). Beim Öffnen wird zuerst ein vorhandener `.blockly.json`-Sidecar geladen (exaktes Layout), sonst die YAML geparst. **Doc-Mode** `playbook` | `role`: im Rollen-Modus wird `roles/<name>/tasks/main.yml` als **reine Task-Liste** (ohne Play-Wrapper) importiert/generiert (`serializeWorkspace(ws, mode)` / `workspaceToTasks`).

**Kategorie-scoped Live-Suche**: ein einzelnes Filter-Textfeld (`pb-palette-filter`) über der Canvas filtert **nur die gerade offene** Kategorie (Modules ODER Roles — da immer nur eine Flyout-Kategorie gleichzeitig offen ist). Mechanismus: `workspace.registerToolboxCategoryCallback()` + `toolbox.refreshSelection()` bei jedem Tastendruck — kein globales „durchsucht alles"-Verhalten mehr.

**Typ-bewusste Modul-Parameter** (`paramTypes_` je Block, aus dem Katalog): 60 `list`-, 5 `dict`-, 40 `int`-Params im Katalog. `list` (z.B. `apt.name` für Mehrfach-Paketinstallation) akzeptiert Komma-Kurzform ODER volle YAML-Listensyntax; `dict` (z.B. `set_stats.data`) als YAML-Mapping; `int`/`float` werden beim Generieren zu echten Zahlen. Labels bekommen einen `[list]`/`{dict}`-Hinweis. Vorher erzwang JEDER nicht-skalare Wert einen `raw_task`-Fallback — betraf u.a. reale `ansible.builtin.apt`/`yum`/`dnf`-Nutzung mit Paketlisten.

**Task-Name vs. Modul-eigenes „name"**: 23 Katalog-Module (`apt`, `user`, `package`, `group`, …) haben selbst einen Parameter namens `name`. Das Task-Beschreibungsfeld heißt daher **„task name:"** (Feld-ID bleibt `NAME`), nicht „name:" — sonst erschien „name:" zweimal ohne Unterscheidung.

**`with_items`-Alias**: beim Import wird das alte `with_items:` (Vorgänger von `loop:`) als Synonym erkannt und ins `LOOP`-Feld übernommen; beim Generieren wird immer die moderne Schreibweise `loop:` erzeugt.

**Kuratierte Choices**: `package.state` ist im ganzen Katalog der einzige Fall, wo `ansible-doc` keine `choices` liefert (generischer Passthrough zu apt/yum/dnf) — Override auf `['present','absent','latest']` in `CURATED_CHOICES` (`blocks.js`). Jeder andere state-artige Param hat bereits echte `ansible-doc`-Choices.

**Conditions statt Freitext-`when:`** (Blockly-native, wie vom Nutzer gefordert): `when:` ist kein
Textfeld mehr, sondern ein **Value-Input** (`ENVELOPE_FIELDS` WHEN-Eintrag hat `kind:'value'`,
`check:'Cond'`), in das ein Condition-Block eingeklinkt wird. Blocktypen (`blocks.js`,
`defineConditionBlocks()`): `cond_var` (Variable/Fact-Referenz, freier Text, kein Output-Check →
darf auch direkt in WHEN, da Ansible einen bloßen truthy-Var-Namen als `when:` erlaubt),
`cond_literal` (Literal — Zahl/true/false unquoted, alles andere auto-quoted; explizit gequotete
Werte wie `"6"` bleiben beim Reimport ein String, wichtig weil z.B. `distribution_major_version`
ein String-Fact ist), `cond_compare` (`==`/`!=`/`>`/`<`/`>=`/`<=`/`in`/`not in`), `cond_test`
(„is [x] not [Dropdown: defined/undefined/none/true/false/changed/failed/success/skipped]"),
`cond_not`, `cond_logic` (`and`/`or`, verkettbar für >2 Bedingungen), `cond_raw` (Fallback, hält
einen nicht zerlegbaren Ausdruck verlustfrei als Text — analog `raw_task`). Eigene Toolbox-Rubrik
„Conditions". `conditionParser.js` parst reale `when:`-Ausdrücke (Tokenizer + rekursiver
Abstiegsparser, Operatorpräzedenz wie Jinja/Python: or < and < not < is-Test < Vergleich <
Primary) zurück in Blöcke; alles außerhalb dieser Grammatik (Filter wie `| int`, Funktionsaufrufe,
Listen-Literale, `~`-Konkatenation) landet in `cond_raw`. Live an der echten Rolle `img_docker`
verifiziert: `not _containerd_dir.stat.exists` → `cond_not`+`cond_var` (keine Klammern nötig, da
„not" in Jinja/Python stärker bindet als Vergleiche), `docker.proxy is defined` → `cond_test`.

**Task-Settings als eigene Mini-Block-Kette** (nicht mehr Felder auf dem Modul-Block): Blockly
erlaubt „inline"-Rendering (das eingebettete/rezessierte Aussehen für einen eingesteckten Wert,
z.B. die WHEN-Bedingung) nur pro **ganzem Block**, nicht pro Zeile — ein Modul-Block hat aber
10+ eigene Zeilen (Task-Name, jeder Parameter, …), die zwingend je eine eigene Zeile bleiben
müssen. Ein `setInputsInline(true)` auf dem Modul-Block würde Blockly dazu bringen, ALLE Zeilen
zu einer einzigen Fließzeile zusammenzufassen (live getestet, verworfen — siehe Git-Historie).
Lösung: jede Task-Einstellung (`when`/`tags`/`notify`/`register`/`loop`/`delegate_to`/`become`/
`ignore_errors`) ist jetzt ein **eigenständiger, einzeiliger Blocktyp** (`setting_<key>`,
`defineTaskSettingBlocks()` in `blocks.js`, Check `'TaskSetting'`), der **gefahrlos** inline sein
kann (nichts anderes auf dem Block, das mitgerissen werden könnte). Diese Mini-Blöcke hängen als
Kette an einem **Statement-Input** `SETTINGS` auf dem Modul-Block (`appendStatementInput`) — exakt
wie die `ROLES`/`TASKS`-Ketten des Play-Blocks. `moduleBlock.addEnvelopeField(key)` erzeugt (oder
findet, idempotent) den passenden `setting_<key>`-Block und hängt ihn ans Kettenende; gibt den
Block zurück (Importer nutzt das z.B. um WHEN's Condition-Block in dessen `VALUE`-Input zu
stecken). `saveExtraState`/`loadExtraState` brauchen für Settings **keine eigene Logik mehr** —
verbundene Blöcke werden von Blockly automatisch (de)serialisiert; nur `optional` (Modul-eigene
Zusatzparameter) wird noch selbst getrackt. Ergebnis: `when:`-Bedingungen erscheinen jetzt sauber
eingebettet in einer „settings"-Klammer statt außen am Modul-Block anzudocken (live verifiziert,
Screenshot-Vergleich vorher/nachher).

**Param-Aliase (`paramAliases_`)**: `ansible-doc -j` liefert pro Param auch `aliases` (z.B. `ansible.builtin.file`s kanonischer Param `path` hat die Aliase `dest`/`name`; `apt.name` → `pkg`/`package`; `systemd.name` → `unit`). `tools/gen-module-catalog.py` erfasst dieses Feld (`compact_options()`), `blocks.js` baut daraus je Block eine `alias → kanonischer Name`-Map (`this.paramAliases_`). Beim Import (`playbookImporter.js`) wird **jeder** eingehende Arg-Key zuerst über diese Map aufgelöst, bevor `getField`/`addOptionalParam`/`canRepresent` etwas damit tun — vorher waren `dest:`/`pkg:`/`unit:` & Co. komplett unbekannte Keys, wodurch reale Tasks (z.B. Symlinks via `file: src:/dest:`) fälschlich als `raw_task` importiert wurden, obwohl sie ein ganz normales `ansible.builtin`-Modul verwenden. Der Katalog-Audit fand ~60+ solcher Alias-Mappings quer über die 71 Module. Block speichert/erzeugt beim Regenerieren immer den kanonischen Namen (funktional identisch, z.B. `path:` statt `dest:`).

**Wichtige Design-Entscheidungen**:
- Blockly-Sprites/Sounds liegen lokal unter `public/static/blockly-media/` (Original zeigt auf externe `appspot.com`-URL → von der CSP blockiert). Dockerfile kopiert dieses Verzeichnis zusätzlich nach `/var/lib/awx/public/static/blockly-media/`.
- **3D-Look wie ioBroker**: `renderer: 'geras'` + `theme: Blockly.Themes.Classic` (bevellte Kanten). Flache Renderer (`thrasos`/`zelos`) haben keinen 3D-Effekt.
- Modul-Textfelder starten **immer leer**, Dropdowns haben eine führende `(unset)`-Option mit Wert `''` — sonst würden ungenutzte Parameter/Choices beim Generieren immer mit ausgegeben (z.B. `apt` → `upgrade: dist`).
- Checkbox-Felder: nicht angehakt = Parameter wird weggelassen (kein UI-Weg, "explizit false" von "nicht gesetzt" zu unterscheiden).
- `play`-Block hat ein `EXTRA`-Textfeld für Play-Level-Keys ohne eigenen Block (`environment:`, `vars:`, …) — verlustfrei als Inline-YAML. **YAML-Felder** (`EXTRA`/`RAW_YAML`/`VARS`) sind **keine** Variablen-Drop-Ziele, und der Generator merged EXTRA/VARS nur, wenn `yaml.load()` ein Mapping ergibt (sonst würde ein bloßer String in Zeichen-Keys `{0:'c',…}` zerlegt).
- `roles:` hat einen eigenen typisierten Block (`role_use`, separates `ROLES`-Statement-Input neben `TASKS`), andere Extra-Keys bleiben im `EXTRA`-Feld.
- Variablen-Drop läuft über einen **Document-Capture-`drop`-Listener** (nicht nur SVG-Root), damit er auch das offene Blockly-Inline-HTML-`<input>` abfängt und das rohe Einfügen (ohne `{{ }}`) verhindert. Trifft der Drop kein Textfeld, aber die Blockly-`injectionDiv`, wird per `Blockly.utils.svgMath.screenToWsCoordinates()` in Workspace-Koordinaten umgerechnet und dort ein `cond_var`-Block erzeugt.
- Rollen-Namen sind projektspezifisch → über eine Ref (`roleNamesRef`) an den `ROLE_SEARCH`-Kategorie-Callback durchgereicht, aktualisiert bei Projektwechsel via `toolbox.refreshSelection()` (kein `updateToolbox()`-Rebuild mehr nötig).

**Katalog neu generieren** (z.B. nach ansible-core-Upgrade):
```bash
docker compose exec -T awx_ee python3 - < awx/ui/src/screens/CustomVars/playbookBuilder/tools/gen-module-catalog.py \
  > awx/ui/src/screens/CustomVars/playbookBuilder/moduleCatalog.generated.json
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
