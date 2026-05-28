#!/usr/bin/env bash
# Install Headlamp (Kubernetes SIG UI) via Helm.
set -euo pipefail

KUBECTL="${KUBECTL:-k3s kubectl}"
NS="kube-system"
RELEASE="headlamp"
CHART="headlamp/headlamp"

if ! command -v helm >/dev/null 2>&1; then
  echo "Helm 3 required. Install: https://helm.sh/docs/intro/install/"
  exit 1
fi

echo "Adding helm repo headlamp..."
if ! helm repo list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "headlamp"; then
  helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
else
  echo "Repo already exists: headlamp"
fi
helm repo update

echo "Installing ${RELEASE} into namespace ${NS}..."
helm upgrade --install "${RELEASE}" "${CHART}" \
  --namespace "${NS}"

echo "Applying admin ServiceAccount (cluster-admin — demo only)..."
${KUBECTL} apply -f "$(dirname "$0")/admin-user.yaml"

echo ""
echo "Done. Next steps:"
echo "  1. bash infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh"
echo "  2. bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh"
echo "  3. Open http://localhost:8443 and login with token"
