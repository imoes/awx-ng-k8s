# awx-ng — Workflow-Dokumentation

Vollständiger Ablauf von der Ersteinrichtung bis zum Ausführen eines Playbooks.

---

## Teil 1 — Ersteinrichtung (einmalig)

### 1.1 Voraussetzungen

- Docker ≥ 24, Docker Compose v2
- Min. 4 GB RAM, 20 GB freier Speicher
- Ein lokales Ansible-Repository auf dem Host (z.B. `/home/user/ansible/ansible03`)
- Ausgehende TCP-Verbindung auf Port 2222 (für Remote Runner, optional)

### 1.2 Konfiguration anlegen

```bash
cd deploy/

# Secrets generieren (einmalig)
mkdir -p secrets
python3 -c "import secrets; print(secrets.token_hex(32))" > secrets/secret_key
python3 -c "import secrets; print(secrets.token_hex(16))" > secrets/pg_password
chmod 600 secrets/*

# Konfiguration aus Vorlage ableiten
cp .env.example .env
```

`.env` befüllen:
```bash
AWX_ADMIN_PASSWORD=MeinSicheresPasswort   # Login für die Web-UI

# Pfad zum Ansible-Repository auf dem HOST (nicht im Container)
ANSIBLE_REPO_PATH=/home/user/ansible/ansible03

# Optional: NetBox-Anbindung für Location-Reconcile
NETBOX_URL=https://netbox.example.com
NETBOX_TOKEN=<api-token>
```

### 1.3 Verzeichnisse anlegen und starten

```bash
mkdir -p data/postgres data/redis data/projects
mkdir -p data/receptor && chmod 777 data/receptor

docker compose build
docker compose up -d

# Status prüfen — Web-UI startet nach ca. 60–90 Sekunden
docker compose ps
```

**Web-UI:** `http://localhost:8052`  
**Login:** `admin` / Passwort aus `.env`

---

## Teil 2 — AWX Grundkonfiguration (einmalig)

### 2.1 Organisation anlegen

AWX benötigt zwingend eine Organisation als Container für Inventories und Projekte.

1. **Resources → Organizations → Add**
2. Name: z.B. `IT` oder der Firmenname
3. Save

### 2.2 Inventory anlegen

Das Inventory enthält die Hosts und Gruppen, gegen die Playbooks ausgeführt werden.

1. **Resources → Inventories → Add → Add inventory**
2. Name: z.B. `ansible03-inventory`
3. Organization: die in 2.1 erstellte
4. Save

### 2.3 Projekt anlegen (Playbooks + Rollen)

Das Projekt zeigt auf das Ansible-Repository — lokal als Bind-Mount im Container.

1. **Resources → Projects → Add**
2. Name: z.B. `ansible03`
3. Source Control Type: **Manual**
4. Project Base Path: `/var/lib/awx/projects`  
   (bereits als Default gesetzt)
5. Playbook Directory: `ansible03`  
   (entspricht dem Verzeichnisnamen unter `/var/lib/awx/ansible03`)
6. Save

> **Hintergrund:** Das Ansible-Repository liegt auf dem Host unter `ANSIBLE_REPO_PATH`
> und ist im Container als `/var/lib/awx/ansible03` eingehängt (Bind-Mount in
> `docker-compose.yml`). AWX liest Playbooks direkt aus diesem Pfad — kein git-Clone nötig.

---

## Teil 3 — Hosts importieren

### 3.1 Host manuell anlegen

1. **Resources → Hosts → Add**
2. Name: Hostname (z.B. `docker01.example.com`)
3. Inventory: das in 2.2 erstellte
4. Variables (YAML): initiale `host_vars` eintragen, z.B.:
   ```yaml
   ansible_host: 10.32.1.50
   ansible_user: root
   ```
5. Save

Alternativ: Hosts über NetBox-Inventory-Source importieren
(Resources → Inventories → Sources → Add).

### 3.2 Host-Variablen pflegen

Für jede Rolle, die auf den Host angewendet werden soll, gibt es einen eigenen Tab:

1. **Resources → Hosts → [Host auswählen]**
2. Tab **Role Variables**
3. Hier sind alle Rollen-Defaults aus dem Projekt aufgelistet
4. Überschriebene Werte werden fett hervorgehoben
5. Änderungen werden direkt in `host.variables` gespeichert (entspricht `host_vars`)

Tab **Aggregated Variables** zeigt den finalen Variablen-Stack:
- Rolle Default → Gruppen-Override → Host-Override (letzteres gewinnt)

### 3.3 Rollen dem Host zuweisen

Im Tab **Role Variables** → „Assign Roles" Button → Rollen aus dem Projekt auswählen.
Die zugewiesenen Rollen werden als `host_roles`-Variable gespeichert.

---

## Teil 4 — Playbooks und Rollen erkunden

### 4.1 Rollen-Übersicht

**Resources → Roles**

Zeigt alle Rollen des Projekts mit:
- Anzahl der Variablen (Defaults)
- Ob die Rolle auf Disk vorhanden ist
- Letzter Scan-Status

Klick auf eine Rolle → vollständige Variable-Übersicht mit Types und Defaults.

### 4.2 Playbook-Übersicht

**Resources → Playbooks**

Zeigt alle `.yml`-Dateien des Projekts mit den enthaltenen Plays (Roles, Hosts, Tags).

- **Grüner Badge + „Run"-Button**: es existiert bereits ein Job-Template für dieses Playbook
- **„Create template"**: noch kein Template vorhanden — leitet zur Template-Erstellung weiter

---

## Teil 5 — Job Template erstellen

Ein Job Template verbindet Inventory + Projekt + Playbook und kann wiederholt ausgeführt werden.

### 5.1 Template anlegen

1. **Resources → Templates → Add → Add job template**
2. Name: z.B. `Deploy Docker Host`
3. Job Type: `Run`
4. Inventory: das in 2.2 erstellte
5. Project: das in 2.3 erstellte
6. Playbook: aus Dropdown wählen (z.B. `site.yml` oder `docker.yml`)
7. Credentials: Machine Credential mit SSH-Key auswählen (falls SSH-Schlüssel benötigt)
8. **Limit**: Haken bei „Prompt on launch" setzen → bei jedem Start wird nach dem Limit gefragt
9. Save

### 5.2 Optionale Einstellungen

- **Tags** / **Skip Tags**: nur bestimmte Plays ausführen
- **Extra Variables**: statische Variable-Overrides für alle Jobs dieses Templates
- **Verbosity**: Log-Detail-Level (0 = normal, 2 = debug)

---

## Teil 6 — Playbook ausführen

Es gibt drei Wege, ein Playbook zu starten:

### Weg A: Über den Playbooks-Screen (einfachster Weg)

1. **Resources → Playbooks**
2. Playbook-Zeile mit grünem Badge → **Run**-Button klicken
3. Im Dialog:
   - **Template**: falls mehrere Templates für dieses Playbook existieren, auswählen
   - **Limit**: Hostname oder Gruppe (z.B. `docker01.example.com` oder `webservers`)  
     Leer lassen = alle Hosts im Inventory
   - **Location** (optional): falls ein Remote-Runner einer Site zugewiesen ist,
     hier auswählen → Job läuft auf dem Runner dieser Site
4. **Run** klicken

### Weg B: Über den Host-Screen

1. **Resources → Hosts → [Host auswählen]**
2. Tab **Role Variables** → **Run Host**-Button
3. Limit ist bereits mit dem Hostnamen vorbelegt
4. Playbook / Template auswählen, Location optional wählen
5. **Run** klicken

### Weg C: Über Templates (AWX-Standard)

1. **Resources → Templates → [Template auswählen] → Launch**
2. Limit eingeben falls „Prompt on launch" aktiviert
3. **Launch**

### 6.1 Was passiert beim Ausführen

```
AWX (awx_task)
  │
  ├── Generiert Private Data Directory:
  │     project/    → Playbooks + Rollen aus dem Ansible-Repository
  │     inventory/  → Generierte Inventory-Datei mit host_vars aus AWX-DB
  │     env/        → Credentials, Limit, Extra-Vars
  │
  ├── Sendet das Verzeichnis als Tarball via Receptor an den Execution Node
  │
  └── Execution Node (awx_ee lokal oder Remote Runner):
        ansible-runner worker
          → ansible-playbook site.yml --limit docker01.example.com
```

### 6.2 Job-Output beobachten

**Views → Jobs** → laufender oder abgeschlossener Job → Live-Output mit Farbkodierung.

---

## Teil 7 — Remote Runner einrichten (optional)

Ein Remote Runner ist ein Execution Node auf einem anderen Host, der Jobs lokal ausführt
(näher an den Ziel-Hosts). Er verbindet sich **ausgehend** (NAT-freundlich) zum
awx-ng Control Node auf Port 2222.

### 7.1 Benötigte Dateien auf den Remote-Host kopieren

```bash
# Aus dem deploy/-Verzeichnis:
scp Dockerfile.proxy docker-compose.proxy.yml scripts/setup-proxy.sh \
    receptor/receptor-proxy.conf.template \
    collections/netbox-netbox-3.20.0.tar.gz \
    collections/community-general-10.7.0.tar.gz \
    user@ansible03:~/awx-runner/

# Tarballs ins erwartete Unterverzeichnis legen
ssh user@ansible03 "mkdir -p ~/awx-runner/collections && \
  mv ~/awx-runner/*.tar.gz ~/awx-runner/collections/"
```

### 7.2 Auf dem Remote-Host: Image bauen + Runner starten

```bash
ssh user@ansible03
cd ~/awx-runner

# receptor.conf generieren (Node-ID muss mit dem AWX-Hostnamen übereinstimmen)
./setup-proxy.sh ansible03 awx-ng.example.com 2222

# Image einmalig bauen (installiert Ansible-Collections ins Image)
docker compose -f docker-compose.proxy.yml build

# Runner starten
docker compose -f docker-compose.proxy.yml up -d

# Prüfen ob Receptor-Socket vorhanden ist (= Verbindung steht)
docker compose -f docker-compose.proxy.yml ps
```

### 7.3 Runner in AWX registrieren

Ohne Registrierung in der AWX-Datenbank wird der verbundene Receptor-Node ignoriert.

1. **Administration → Runners → Register runner**
2. Hostname: `ansible03` (identisch mit dem Node-ID aus `setup-proxy.sh`)
3. Node type: `execution`
4. Register

Nach ~20 Sekunden (AWX-Heartbeat) erscheint `node_state: ready` und eine Kapazität > 0.

Optional: **health check** klicken zur sofortigen Überprüfung.

### 7.4 Runner einer Site zuweisen

1. In der Runners-Tabelle: **assign site** neben `ansible03`
2. Site auswählen (z.B. `MUE-0`)
3. Optional: SSH User, SSH Credential ID, SSH Private Key (id_rsa), ansible.cfg für diese Site eintragen
4. Save

Damit wird automatisch eine AWX InstanceGroup mit dem Namen der Site angelegt
und der Runner dieser Gruppe zugewiesen.

### 7.5 Playbook gezielt auf dem Remote Runner ausführen

Beim Starten eines Playbooks (Weg A oder B aus Teil 6):
- **Location**-Dropdown erscheint wenn Sites konfiguriert sind
- Site auswählen → Job wird an den Runner dieser Site geroutet

---

## Teil 8 — NetBox-Integration (optional)

### 8.1 Locations aus NetBox importieren

1. **Resources → Locations → Reconcile with NetBox**
2. NetBox-URL und Token müssen in `.env` gesetzt sein
3. Alle NetBox-Sites werden als Locations angelegt

### 8.2 Hosts aus NetBox importieren

1. **Resources → Inventories → [Inventory] → Sources → Add**
2. Source: `NetBox`
3. NetBox-URL und Credentials eintragen
4. Sync starten

---

## Zusammenfassung: Minimaler Workflow

```
1. deploy/.env befüllen (ANSIBLE_REPO_PATH + AWX_ADMIN_PASSWORD)
2. docker compose build && docker compose up -d
3. UI: Organisation anlegen
4. UI: Inventory anlegen
5. UI: Projekt anlegen (SCM: Manual, Dir: ansible03)
6. UI: Host anlegen + host_vars setzen
7. UI: Playbooks → "Create template" für das gewünschte Playbook
8. UI: Playbooks → "Run" → Limit eingeben → Run
9. UI: Views → Jobs → Output beobachten
```
