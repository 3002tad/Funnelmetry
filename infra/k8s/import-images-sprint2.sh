#!/usr/bin/env bash
# Build Sprint 2 images and import into k3s.
# Run after import-images-wsl.sh or standalone (builds all app images).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bash infra/k8s/import-images-wsl.sh

resolve_docker() {
  command -v docker >/dev/null && echo docker && return 0
  local win_docker="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
  [[ -x "$win_docker" ]] && echo "$win_docker" && return 0
  return 1
}

DOCKER="$(resolve_docker)"

echo "Building dashboard-api:dev ..."
"$DOCKER" build -t dashboard-api:dev services/dashboard-api

echo "Building dashboard-ui:dev (API proxied via nginx to dashboard-api service) ..."
"$DOCKER" build -t dashboard-ui:dev \
  --build-arg VITE_DASHBOARD_API_URL= \
  clients/dashboard

for img in dashboard-api:dev dashboard-ui:dev; do
  echo "Importing $img into k3s ..."
  "$DOCKER" save "$img" | sudo k3s ctr images import -
done

echo "Done. Sprint 2 images:"
sudo k3s ctr images ls | grep -E 'dashboard-api|dashboard-ui' || true
