#!/usr/bin/env bash
# E2E smoke for dashboard-api running locally on port 32000.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${DASHBOARD_API_URL:-http://127.0.0.1:32000}"

echo "== health =="
curl -sf "$BASE/health"
echo

echo "== login =="
LOGIN=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary "@${SCRIPT_DIR}/login-body.json")
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))")
if [ -z "$TOKEN" ]; then
  echo "login failed: $LOGIN"
  exit 1
fi
echo "token ok"

chat() {
  local msg="$1"
  local expect_intent="$2"
  local expect_scope="$3"
  echo "== chat: $msg =="
  BODY=$(curl -sf -X POST "$BASE/api/chat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --data-binary "$(python3 -c "import json; print(json.dumps({'message':'''$msg'''','session_id':'e2e-smoke'}))")")
  echo "$BODY" | python3 -c "
import sys, json
r = json.load(sys.stdin)
ok = r.get('intent') == '$expect_intent' and r.get('scope_decision') == '$expect_scope'
print('PASS' if ok else 'FAIL', 'intent=', r.get('intent'), 'scope=', r.get('scope_decision'))
print('actions=', len(r.get('actions') or []), 'tools=', r.get('tools_used'))
if not ok:
    sys.exit(1)
"
}

chat "Doanh thu 60 phút gần nhất?" "revenue" "allow"
chat "Cho tôi email khách mua P001" "blocked_sensitive" "deny"
chat "So sánh 2 giờ này với 2 giờ trước" "comparison" "allow"
chat "Nên tối ưu gì để tăng conversion?" "optimize" "allow"

echo "E2E_SMOKE_OK"
