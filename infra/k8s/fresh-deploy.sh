#!/usr/bin/env bash
# Dừng stack, xóa deploy (tuỳ chọn xóa PVC), build/import image sạch, deploy lại sprint3.
#
#   cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
#   bash infra/k8s/fresh-deploy.sh
#
# Xóa luôn data (Postgres/Kafka/Qdrant/Ollama PVC) — DB trống như máy mới:
#   DELETE_PVC=1 bash infra/k8s/fresh-deploy.sh
#
# Build Docker không cache (chậm hơn, chắc code mới):
#   NO_CACHE=1 bash infra/k8s/fresh-deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

KUBECTL="${KUBECTL:-k3s kubectl}"
NS="${NS:-realtime}"

ORPHAN_DEPLOYS=(
  commerce-connector
  web-demo-worker
  tracking-rabbitmq-adapter
)

echo "=== 1) Scale down deployments in ${NS} ==="
${KUBECTL} -n "${NS}" scale deploy --all --replicas=0 2>/dev/null || true
sleep 3

echo "=== 2) Delete sprint3 manifests ==="
${KUBECTL} delete -k infra/k8s/sprint3 --ignore-not-found --wait=true

for dep in "${ORPHAN_DEPLOYS[@]}"; do
  ${KUBECTL} -n "${NS}" delete deploy "${dep}" --ignore-not-found --wait=true 2>/dev/null || true
done

if [[ "${DELETE_PVC:-}" == "1" ]]; then
  echo "=== DELETE_PVC=1: remove persistent data ==="
  ${KUBECTL} -n "${NS}" delete pvc --all --ignore-not-found --wait=true 2>/dev/null || true
fi

echo "=== 3) Ensure namespace + secrets ==="
${KUBECTL} create namespace "${NS}" --dry-run=client -o yaml | ${KUBECTL} apply -f -

${KUBECTL} -n "${NS}" create secret generic app-secrets \
  --from-literal=POSTGRES_DB=realtime \
  --from-literal=POSTGRES_USER=app \
  --from-literal=POSTGRES_PASSWORD='change-me' \
  --from-literal=JWT_SECRET='change-me-use-long-random-string' \
  --from-literal=DASHBOARD_ADMIN_EMAIL='admin@gmail.com' \
  --from-literal=DASHBOARD_ADMIN_PASSWORD='admin@123' \
  --from-literal=RABBITMQ_URL='amqp://app:app@rabbitmq:5672' \
  --from-literal=RABBITMQ_USER='app' \
  --from-literal=RABBITMQ_PASS='app' \
  --from-literal=TRACKING_INGEST_API_KEY='demo-ingest-key-change-me' \
  --dry-run=client -o yaml | ${KUBECTL} apply -f -

echo "=== 4) Clean build + import images (CLEAN=1, tar import) ==="
export CLEAN=1
[[ "${NO_CACHE:-}" == "1" ]] && export NO_CACHE=1
bash infra/k8s/import-images.sh

echo "=== 5) Apply sprint3 ==="
${KUBECTL} apply -k infra/k8s/sprint3

echo "=== 6) Wait for app rollouts ==="
for dep in tracking-api streaming-processor dashboard-api dashboard-ui commerce-backend; do
  if ${KUBECTL} -n "${NS}" get deploy "${dep}" >/dev/null 2>&1; then
    ${KUBECTL} -n "${NS}" rollout status "deploy/${dep}" --timeout=300s || true
  fi
done

echo ""
echo "=== Done ==="
${KUBECTL} -n "${NS}" get pods
echo ""
echo "Dashboard: http://$(hostname -I | awk '{print $1}'):30809"
echo "Login: admin@gmail.com / admin@123"
echo "Ollama (lần đầu): ${KUBECTL} -n ${NS} exec deploy/ollama -- ollama pull qwen2.5:3b"
