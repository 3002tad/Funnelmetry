#!/usr/bin/env bash
# Print bearer token for Headlamp login.
set -euo pipefail

KUBECTL="${KUBECTL:-k3s kubectl}"
NS="kube-system"
SA="admin-user"

if ! ${KUBECTL} get namespace "${NS}" >/dev/null 2>&1; then
  echo "Namespace ${NS} not found. Run install.sh first."
  exit 1
fi

${KUBECTL} apply -f "$(dirname "$0")/admin-user.yaml" >/dev/null

echo "Bearer token for ServiceAccount ${SA} (cluster-admin — demo only):"
echo "---"
${KUBECTL} -n "${NS}" create token "${SA}" --duration=24h
echo "---"
echo "Paste at http://localhost:8443 → Token login"
