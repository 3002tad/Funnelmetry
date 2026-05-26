#!/usr/bin/env bash
# Expose dashboard on localhost:8090 from Windows browser (WSL k3s).
# Run in Ubuntu and keep terminal open:
#   bash infra/k8s/port-forward-dashboard.sh

set -euo pipefail

echo "Dashboard UI  -> http://localhost:8090"
echo "Dashboard API -> http://localhost:3200 (direct)"
echo "Press Ctrl+C to stop."
k3s kubectl -n realtime port-forward --address 0.0.0.0 svc/dashboard-ui 8090:80
