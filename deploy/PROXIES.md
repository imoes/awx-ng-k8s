# Remote Ansible-Runner Proxies (Execution Nodes)

awx-ng nutzt das **Receptor-Protokoll** für verteilte Job-Ausführung. Remote-Proxies
verbinden sich **ausgehend** (NAT-freundlich, kein eingehender Port nötig) zum zentralen
awx-ng Control-Node auf Port 2222 und führen Playbooks lokal aus.

## Architektur

```
awx-ng (8052)
  └─ awx_ee [local] (port 2222)   ← Receptor Control Node
       ├─ ansible03.example.com   ← Remote Proxy (Site: MUE-0)
       ├─ ansible01.dierichs.de   ← Remote Proxy (Site: Dierichs)
       └─ ... weitere Proxies
```

Jeder Proxy wird in awx-ng einer **Site/Location** zugeordnet. Job-Templates können
dann über die Location gesteuert werden, welcher Proxy den Job ausführt.

**Wichtig:** AWX registriert Receptor-Nodes **nicht** automatisch. Ein Proxy, der sich
über Receptor verbindet, erscheint als `"Unrecognized node advertising on mesh"` in den
Logs und wird ignoriert, bis ein Instance-Datensatz in AWX angelegt wurde (Schritt 2
in den Anleitungen unten).

## Docker (empfohlen)

Voraussetzungen: Docker + Docker Compose auf dem Remote-Host.

```bash
# 1. Dateien auf den Remote-Host kopieren
scp deploy/docker-compose.proxy.yml \
    deploy/scripts/setup-proxy.sh \
    deploy/receptor/receptor-proxy.conf.template \
    user@ansible03:~/awx-runner/

# 2. Auf dem Remote-Host: receptor.conf generieren + Verzeichnisse anlegen
cd ~/awx-runner
./setup-proxy.sh ansible03 awx-ng.example.com 2222

# 3. Container starten (Receptor verbindet sich ausgehend zu Port 2222)
docker compose -f docker-compose.proxy.yml up -d

# 4. In AWX UI registrieren: Administration → Runners → "Register runner"
#    hostname=ansible03, node_type=execution
#    → AWX legt den Instance-Datensatz an

# 5. Health check klicken (oder ~20s warten)
#    → AWX erkennt den Receptor-Node im Mesh → node_state=ready, Capacity > 0
```

Für Hosts hinter einem Corporate-HTTP-Proxy: `docker-compose.override.yml` anlegen
(gitignored) mit `HTTP_PROXY` / `HTTPS_PROXY` Environment-Variablen.

Ansible-Collections (z.B. `netbox.netbox`) werden beim ersten Job-Run automatisch
aus der `requirements.yml` des Projects in `data/projects/` installiert.

## Manuelle Installation (ohne Docker)

Voraussetzungen auf dem Remote-Host:
- Linux (Debian/Ubuntu/RHEL)
- `ansible-runner` installiert: `pip3 install ansible-runner`
- `receptor` Binary installiert (siehe unten)
- Ausgehende TCP-Verbindung zu awx-ng-Control-Host:2222

### Via Ansible-Playbook

```bash
# Aus einem Ansible-Host ausführen:
ansible-playbook deploy/ansible/install-receptor-proxy.yml \
  -i "ansible03.example.com," \
  -e "proxy_node_id=ansible03" \
  -e "awx_ng_control_host=awx-ng.example.com" \
  -e "awx_ng_control_port=2222" \
  --become
```

### Manuell

```bash
# 1. receptor installieren
pip3 install receptorctl
# oder Binary herunterladen:
curl -Lo /usr/local/bin/receptor \
  https://github.com/ansible/receptor/releases/latest/download/receptor_linux_amd64
chmod +x /usr/local/bin/receptor

# 2. ansible-runner installieren
pip3 install ansible-runner

# 3. Receptor-Konfiguration anlegen
mkdir -p /etc/receptor /var/run/receptor
# Template aus deploy/receptor/receptor-proxy.conf.template anpassen:
cat > /etc/receptor/receptor.conf << EOF
---
- node:
    id: ansible03

- log-level: info

- tcp-peer:
    address: awx-ng.example.com:2222
    redial: true

- control-service:
    service: control
    filename: /var/run/receptor/receptor.sock

- work-command:
    worktype: ansible-runner
    command: ansible-runner
    params: worker
    allowruntimeparams: true
    verifysignature: false
EOF

# 4. Systemd-Service anlegen
cat > /etc/systemd/system/receptor.service << 'EOF'
[Unit]
Description=Receptor - AWX-NG Execution Node Proxy
After=network.target

[Service]
ExecStart=/usr/local/bin/receptor --config /etc/receptor/receptor.conf
Restart=always
RestartSec=10
User=awx

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now receptor
```

Danach: In AWX UI registrieren (Administration → Runners → „Register runner",
hostname=ansible03).

## Bekannte Proxy-Hosts

| Hostname                  | Node-ID                    | Site       |
|---------------------------|----------------------------|------------|
| ansible03.example.com     | ansible03                  | MUE-0      |
| ansible01.dierichs.de     | ansible01-dierichs-de      | Dierichs   |

(Diese Tabelle nach Registrierung in awx-ng pflegen.)
