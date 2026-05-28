#!/usr/bin/env bash
# Proxy Headlamp UI to http://localhost:8443
set -euo pipefail

KUBECTL="${KUBECTL:-k3s kubectl}"
NS="kube-system"
LOCAL_PORT="${LOCAL_PORT:-8443}"

SVC="$(${KUBECTL} -n "${NS}" get svc -o name 2>/dev/null | grep -E '/headlamp$' | head -1 || true)"

if [ -z "${SVC}" ]; then
  echo "No headlamp service in ${NS}. Run install.sh first."
  ${KUBECTL} -n "${NS}" get svc 2>/dev/null || true
  exit 1
fi

echo "Forwarding ${SVC} → http://localhost:${LOCAL_PORT}"
echo "Login: run create-admin-token.sh and paste token at UI"
exec ${KUBECTL} -n "${NS}" port-forward "${SVC}" "${LOCAL_PORT}:80"
