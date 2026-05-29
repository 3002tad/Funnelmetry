#!/usr/bin/env bash
# Rebuild all app :dev images, re-import into k3s, restart pods.
# Use when code changed but cluster still runs old layers.
#
#   cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
#   bash infra/k8s/rebuild-all-dev-images.sh
#
# Force clean Docker build (slower):
#   NO_CACHE=1 bash infra/k8s/rebuild-all-dev-images.sh

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
BUILD_FLAGS=()
[[ "${NO_CACHE:-}" == "1" ]] && BUILD_FLAGS+=(--no-cache)

IMAGES=(
  tracking-api:dev
  streaming-processor:dev
  dashboard-api:dev
  dashboard-ui:dev
  commerce-backend:dev
  web-demo-worker:dev
)

echo "=== Remove old :dev images from k3s containerd (best-effort) ==="
for img in "${IMAGES[@]}"; do
  sudo k3s ctr images rm "docker.io/library/${img}" 2>/dev/null || true
  sudo k3s ctr images rm "${img}" 2>/dev/null || true
done

echo "=== Build + import all app images ==="
if [[ "${NO_CACHE:-}" == "1" ]]; then
  export DOCKER_BUILDKIT=1
  echo "Building tracking-api ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t tracking-api:dev services/tracking-api
  echo "Building streaming-processor ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t streaming-processor:dev services/streaming-processor
  echo "Building dashboard-api ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t dashboard-api:dev services/dashboard-api
  echo "Building dashboard-ui ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t dashboard-ui:dev \
    --build-arg VITE_DASHBOARD_API_URL= clients/dashboard
  echo "Building commerce-backend ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t commerce-backend:dev services/commerce-backend
  echo "Building web-demo-worker ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t web-demo-worker:dev services/web-demo-worker
  echo "Building commerce-connector ..."
  "$DOCKER" build "${BUILD_FLAGS[@]}" -t commerce-connector:dev services/commerce-connector
  for img in "${IMAGES[@]}"; do
    echo "Importing $img ..."
    "$DOCKER" save "$img" | sudo k3s ctr images import -
  done
else
  bash infra/k8s/import-images.sh
fi

echo "=== Restart app deployments in ${NS} ==="
for dep in tracking-api streaming-processor dashboard-api dashboard-ui \
  commerce-backend web-demo-worker; do
  if ${KUBECTL} -n "${NS}" get deploy "${dep}" >/dev/null 2>&1; then
    ${KUBECTL} -n "${NS}" rollout restart "deploy/${dep}"
  fi
done

echo "=== Wait for rollouts ==="
for dep in tracking-api streaming-processor dashboard-api dashboard-ui \
  commerce-backend web-demo-worker; do
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
