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
dann "Preferred Execution Node" auf einen Proxy einer bestimmten Site setzen.

## Voraussetzungen (Remote Host)

- Linux (Debian/Ubuntu/RHEL)
- `ansible-runner` installiert: `pip3 install ansible-runner`
- `receptor` Binaries installiert (siehe unten)
- Ausgehende TCP-Verbindung zu awx-ng-Control-Host:2222

## Installation via Ansible (empfohlen)

Ein vorgefertigtes Playbook liegt unter `deploy/ansible/install-receptor-proxy.yml`:

```bash
# Aus ansible03 oder einem anderen Ansible-Host ausführen:
ansible-playbook deploy/ansible/install-receptor-proxy.yml \
  -i "ansible03.example.com," \
  -e "proxy_node_id=ansible03-example" \
  -e "awx_ng_control_host=awx-ng.example.com" \
  -e "awx_ng_control_port=2222" \
  -e "site_name=MUE-0" \
  --become
```

## Manuelle Installation

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
    id: ansible03-example

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

## Registrierung in awx-ng

Nach der Installation erscheint der Proxy automatisch unter **Administration →
Execution Environments / Instance Groups** (sobald die Receptor-Verbindung steht).

Zusätzlich in awx-ng:
1. **Administration → Instances** → neuer Execution Node mit `hostname=ansible03-example`
2. **Sites/Locations** (Phase 5) → Site auswählen → "Preferred Execution Node" = dieser Proxy

## Bekannte Proxy-Hosts

| Hostname                  | Node-ID                    | Site       |
|---------------------------|----------------------------|------------|
| ansible03.example.com     | ansible03-example      | MUE-0      |
| ansible01.dierichs.de     | ansible01-dierichs-de      | Dierichs   |

(Diese Tabelle ist nach Registrierung in awx-ng zu pflegen.)
