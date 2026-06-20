#!/usr/bin/env bash
# Generate receptor.conf for a remote execution node and prepare data directories.
# Usage: ./scripts/setup-proxy.sh <node-id> <control-host> [control-port]
#
# Example:
#   ./scripts/setup-proxy.sh ansible03 awx-ng.example.com 2222
#
# Then start the runner:
#   docker compose -f docker-compose.proxy.yml up -d
#
# Then register the node in AWX:
#   AWX UI → Administration → Runners → "Register runner" (hostname=<node-id>)

set -e

NODE_ID="${1:?Usage: $0 <node-id> <control-host> [control-port]}"
CONTROL_HOST="${2:?Usage: $0 <node-id> <control-host> [control-port]}"
CONTROL_PORT="${3:-2222}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../receptor/receptor-proxy.conf.template"
OUTPUT="$(pwd)/receptor.conf"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: template not found at $TEMPLATE" >&2
  exit 1
fi

mkdir -p data/projects data/receptor
chmod 777 data/receptor

sed \
  -e "s|{{ PROXY_NODE_ID }}|$NODE_ID|g" \
  -e "s|{{ AWX_NG_CONTROL_HOST }}|$CONTROL_HOST|g" \
  -e "s|{{ AWX_NG_CONTROL_PORT }}|$CONTROL_PORT|g" \
  "$TEMPLATE" \
  > "$OUTPUT"

echo "receptor.conf written: node='$NODE_ID' → $CONTROL_HOST:$CONTROL_PORT"
echo ""
echo "Next steps:"
echo "  0.  docker compose -f docker-compose.proxy.yml build   # once — builds image with Ansible collections"
echo "  1.  docker compose -f docker-compose.proxy.yml up -d"
echo "  2.  AWX UI → Administration → Runners → Register runner (hostname=$NODE_ID)"
echo "  3.  Click 'health check' in the UI — Capacity appears once the mesh link is up"
