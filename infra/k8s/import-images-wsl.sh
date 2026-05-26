#!/usr/bin/env bash
# Build app images and import into k3s containerd.
#
# Docker sources (first match wins):
#   1. `docker` in WSL (Docker Desktop WSL integration)
#   2. Docker Desktop binary on Windows host
#
#   cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
#   bash infra/k8s/import-images-wsl.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

resolve_docker() {
  if [[ -n "${DOCKER_BIN:-}" ]] && command -v "$DOCKER_BIN" >/dev/null 2>&1; then
    echo "$DOCKER_BIN"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    echo docker
    return 0
  fi
  local win_docker="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
  if [[ -x "$win_docker" ]]; then
    echo "$win_docker"
    return 0
  fi
  return 1
}

if ! docker info >/dev/null 2>&1; then
  if groups | grep -q '\bdocker\b'; then
    cat <<'EOF' >&2
ERROR: Docker socket permission denied.

Restart WSL after enabling Docker Desktop integration:
  PowerShell: wsl --shutdown
  Then reopen Ubuntu and run this script again.
EOF
    exit 1
  fi
  cat <<'EOF' >&2
ERROR: permission denied on /var/run/docker.sock

Fix (run once in Ubuntu, then restart WSL):

  sudo usermod -aG docker "$USER"
  newgrp docker

Or from PowerShell: wsl --shutdown
Then reopen Ubuntu and run: bash infra/k8s/import-images-wsl.sh
EOF
  exit 1
fi

DOCKER="$(resolve_docker)" || {
  cat <<'EOF' >&2
ERROR: Docker not found.

Option A — enable WSL integration (recommended):
  Docker Desktop → Settings → Resources → WSL Integration → enable "Ubuntu"

Option B — use Windows Docker from WSL (script tries docker.exe automatically).
  Ensure Docker Desktop is running on Windows.

Then re-run: bash infra/k8s/import-images-wsl.sh
EOF
  exit 1
}

echo "Using Docker: $DOCKER"

echo "Building tracking-api:dev ..."
"$DOCKER" build -t tracking-api:dev services/tracking-api

echo "Building streaming-processor:dev ..."
"$DOCKER" build -t streaming-processor:dev services/streaming-processor

for img in tracking-api:dev streaming-processor:dev; do
  echo "Importing $img into k3s ..."
  "$DOCKER" save "$img" | sudo k3s ctr images import -
done

echo "Done. Images in k3s:"
sudo k3s ctr images ls | grep -E 'tracking-api|streaming-processor' || true
