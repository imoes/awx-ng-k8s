#!/usr/bin/env bash
# awx-ng Task-Node-Starter: überschreibt launch_awx_task.sh
# Provisioniert die AWX-Instance mit explizitem Hostname statt K8s-Auto-Detection

if [ "$(id -u)" -ge 500 ]; then
    echo "awx:x:$(id -u):$(id -g):,,,:/var/lib/awx:/bin/bash" >> /tmp/passwd
    cat /tmp/passwd > /etc/passwd
    rm /tmp/passwd
fi

set -e

wait-for-migrations

# Hostname aus der Umgebung oder Container-Hostname
AWX_HOSTNAME="${AWX_INSTANCE_HOSTNAME:-$(hostname)}"
AWX_NODE_TYPE="${AWX_NODE_TYPE:-hybrid}"

awx-manage provision_instance \
    --hostname "$AWX_HOSTNAME" \
    --node_type "$AWX_NODE_TYPE"

exec supervisord -c /etc/supervisord_task.conf
