#!/usr/bin/env bash
# Build Sprint 3 images (sprint2 + commerce services) and import into k3s.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Build/import tracking + streaming + dashboard first.
bash infra/k8s/import-images-sprint2.sh

resolve_docker() {
  command -v docker >/dev/null && echo docker && return 0
  local win_docker="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
  [[ -x "$win_docker" ]] && echo "$win_docker" && return 0
  return 1
}

DOCKER="$(resolve_docker)"

echo "Building commerce-backend:dev ..."
"$DOCKER" build -t commerce-backend:dev services/commerce-backend

echo "Building commerce-connector:dev ..."
"$DOCKER" build -t commerce-connector:dev services/commerce-connector

for img in commerce-backend:dev commerce-connector:dev; do
  echo "Importing $img into k3s ..."
  "$DOCKER" save "$img" | sudo k3s ctr images import -
done

echo "Done. Sprint 3 images:"
sudo k3s ctr images ls | grep -E 'dashboard-api|dashboard-ui|tracking-api|streaming-processor|commerce-backend|commerce-connector' || true
