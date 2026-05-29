#!/usr/bin/env bash
# Rebuild all app :dev images, re-import into k3s, restart pods.
# Use when code changed but cluster still runs old layers.
#
#   cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
#   bash infra/k8s/rebuild-all-dev-images.sh
#
# Force clean Docker build (slower):
#   NO_CACHE=1 bash infra/k8s/rebuild-all-dev-images.sh
#
# Xóa image :dev trong Docker + k3s rồi build/import lại (sạch nhất):
#   CLEAN=1 bash infra/k8s/rebuild-all-dev-images.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

resolve_docker() {
  command -v docker >/dev/null && echo docker && return 0
  local win_docker="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
  [[ -x "$win_docker" ]] && echo "$win_docker" && return 0
  return 1
}

DOCKER="$(resolve_docker)" || {
  echo "Docker not found. Enable Docker Desktop WSL integration."
  exit 1
}

KUBECTL="${KUBECTL:-k3s kubectl}"
NS="${NS:-realtime}"
IMAGES=(
  tracking-api:dev
  streaming-processor:dev
  dashboard-api:dev
  dashboard-ui:dev
  commerce-backend:dev
)

if [[ "${CLEAN:-}" == "1" ]]; then
  echo "=== CLEAN=1: remove :dev images from k3s + Docker ==="
  export CLEAN=1
  for img in "${IMAGES[@]}"; do
    sudo k3s ctr images rm "docker.io/library/${img}" 2>/dev/null || true
    sudo k3s ctr images rm "${img}" 2>/dev/null || true
    "$DOCKER" image rm -f "${img}" 2>/dev/null || true
  done
fi

echo "=== Build + import all app images (tar import, see import-images.sh) ==="
export DOCKER
[[ "${NO_CACHE:-}" == "1" ]] && export DOCKER_BUILDKIT=1
export DOCKER
bash infra/k8s/import-images.sh

echo "=== Restart app deployments in ${NS} ==="
for dep in tracking-api streaming-processor dashboard-api dashboard-ui \
  commerce-backend; do
  if ${KUBECTL} -n "${NS}" get deploy "${dep}" >/dev/null 2>&1; then
    ${KUBECTL} -n "${NS}" rollout restart "deploy/${dep}"
  fi
done

echo "=== Wait for rollouts ==="
for dep in tracking-api streaming-processor dashboard-api dashboard-ui \
  commerce-backend; do
  if ${KUBECTL} -n "${NS}" get deploy "${dep}" >/dev/null 2>&1; then
    ${KUBECTL} -n "${NS}" rollout status "deploy/${dep}" --timeout=180s || true
  fi
done

echo ""
echo "Images in k3s:"
sudo k3s ctr images ls | grep -E 'tracking-api|streaming-processor|dashboard-api|dashboard-ui|commerce-' || true
echo ""
echo "Pods:"
${KUBECTL} -n "${NS}" get pods
