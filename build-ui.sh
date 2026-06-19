#!/usr/bin/env bash
# awx-ng: baut die geforkte awx/ui und synct das Ergebnis nach deploy/custom/ui-build/
# Voraussetzung: Node ≥ 18 (getestet mit Node 22), npm.
#
#   ./build-ui.sh           # node_modules wiederverwenden (schnell)
#   ./build-ui.sh --clean   # node_modules neu installieren (--force ci)
set -euo pipefail
cd "$(dirname "$0")"

UI=awx/ui
OUT=deploy/custom/ui-build

if [[ "${1:-}" == "--clean" || ! -d "$UI/node_modules" ]]; then
    echo "[build-ui] npm ci (--force, wie AWX-Makefile)…"
    NODE_OPTIONS=--max-old-space-size=6144 npm --prefix "$UI" --loglevel warn --force ci
fi

echo "[build-ui] react-scripts build…"
# DISABLE_ESLINT_PLUGIN: ESLint-Warnungen sollen den Build nicht abbrechen
# (CI=true behandelt sonst jede Warnung als Fehler). Babel/Webpack fangen
# echte Syntax-/Import-Fehler weiterhin ab.
( cd "$UI" && NODE_OPTIONS=--max-old-space-size=6144 CI=true DISABLE_ESLINT_PLUGIN=true npm run build )

echo "[build-ui] sync → $OUT (ohne .map)…"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$UI"/build/* "$OUT"/
find "$OUT" -name "*.map" -delete

echo "[build-ui] fertig. Jetzt: cd deploy && docker compose build awx_web && docker compose up -d --no-deps awx_web"
