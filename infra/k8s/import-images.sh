#!/usr/bin/env bash
# Build all app :dev images and import into k3s containerd.
#
#   bash infra/k8s/import-images.sh
#
# PowerShell (Docker Desktop on Windows): infra/k8s/import-images.ps1

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
  if ! groups | grep -q '\bdocker\b'; then
    cat <<'EOF' >&2
ERROR: Docker not available. Enable Docker Desktop WSL integration for Ubuntu,
or run: infra/k8s/import-images.ps1 from PowerShell.
EOF
    exit 1
  fi
fi

DOCKER="$(resolve_docker)" || {
  echo "ERROR: Docker not found." >&2
  exit 1
}

echo "Using Docker: $DOCKER"

BUILD_FLAGS=()
[[ "${NO_CACHE:-}" == "1" ]] && BUILD_FLAGS+=(--no-cache)

IMPORT_DIR="${IMPORT_DIR:-/tmp/pipeline-k3s-import}"
mkdir -p "${IMPORT_DIR}"

remove_dev_image() {
  local name="$1"
  sudo k3s ctr images rm "docker.io/library/${name}" 2>/dev/null || true
  sudo k3s ctr images rm "${name}" 2>/dev/null || true
  if [[ "${CLEAN:-}" == "1" ]]; then
    "$DOCKER" image rm -f "${name}" 2>/dev/null || true
  fi
}

import_image_tar() {
  local name="$1"
  local tar="${IMPORT_DIR}/${name//[:\/]/_}.tar"
  echo "Importing ${name} (tar) ..."
  "$DOCKER" save "${name}" -o "${tar}"
  sudo k3s ctr images import "${tar}"
  rm -f "${tar}"
}

build_and_import() {
  local name="$1"
  local ctx="$2"
  shift 2
  remove_dev_image "${name}"
  echo "Building ${name} ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t "${name}" "$@" "${ctx}"
  import_image_tar "${name}"
}

build_and_import tracking-api:dev services/tracking-api
build_and_import streaming-processor:dev services/streaming-processor
build_and_import dashboard-api:dev services/dashboard-api
build_and_import dashboard-ui:dev clients/dashboard \
  --build-arg VITE_DASHBOARD_API_URL=
build_and_import commerce-backend:dev services/commerce-backend

echo "Done. Images in k3s:"
sudo k3s ctr images ls | grep -E 'tracking-api|streaming-processor|dashboard-api|dashboard-ui|commerce-' || true
