#!/usr/bin/env bash
# Expose tracking-api on localhost:31000 from Windows browser (WSL k3s).
# Run in Ubuntu and keep terminal open:
#   bash infra/k8s/port-forward-tracking.sh
# Then web-shop: TRACKING_FORWARD_URL=http://localhost:31000/track

set -euo pipefail

echo "Tracking API -> http://localhost:31000"
echo "Press Ctrl+C to stop."
k3s kubectl -n realtime port-forward --address 0.0.0.0 svc/tracking-api 31000:3000
