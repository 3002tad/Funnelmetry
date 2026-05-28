#!/usr/bin/env bash
# One-command Headlamp launcher:
# - ensure Headlamp is installed
# - print a fresh login token
# - start port-forward to localhost
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
KUBECTL="${KUBECTL:-k3s kubectl}"
NS="kube-system"
RELEASE="headlamp"
LOCAL_PORT="${LOCAL_PORT:-8443}"

echo "Checking Headlamp release..."
if ! helm -n "${NS}" ls 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${RELEASE}"; then
  echo "Headlamp not installed. Installing now..."
  bash "${ROOT_DIR}/infra/k8s/ops/kubernetes-dashboard/install.sh"
fi

echo ""
echo "Generating fresh token..."
bash "${ROOT_DIR}/infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh"

echo ""
echo "Starting port-forward on http://localhost:${LOCAL_PORT}"
echo "Keep this terminal open while using Headlamp."
bash "${ROOT_DIR}/infra/k8s/ops/kubernetes-dashboard/port-forward.sh"
