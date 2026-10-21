#!/usr/bin/env bash
# Actualiza Geo Rural en el servidor con lo último de GitHub (rama main).
set -euo pipefail
# Geo Rural necesita Node 24; el Node del sistema (18) lo usan otros sitios.
export PATH=/opt/sia-node/v24.18.0/bin:$PATH
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev
sudo systemctl restart geo_rural
sleep 3
curl -fsS http://127.0.0.1:3001/api/health && echo " <- Geo Rural OK"
