# @funnelmetry/edge-relay

Edge Relay là public, durable store-and-forward boundary cho Browser behavior event. Nó không canonicalize
event và không thay Pipeline Input Gateway/Kafka. Browser nhận `relay_queued` sau SQLite/WAL commit; chỉ
Input Gateway mới trả `accepted` khi raw event đã durable tại Pipeline.

## Runtime tối thiểu

Relay yêu cầu Node 22+ vì dùng `node:sqlite`. Chạy local với biến môi trường trong `infra/.env`:

```powershell
cd apps/edge-relay
npm install
npm start
```

Ví dụ cấu hình development không chứa secret thật:

```env
RELAY_BROWSER_KEYS_JSON={"relay-browser":{"source_id":"medusa-reference","secret":"change-me","allowed_origins":["http://localhost:8000"]}}
RELAY_UPSTREAM_ENABLED=false
RELAY_DATABASE_PATH=./data/funnelmetry-edge-relay.sqlite
```

Khi Pipeline/Tailscale sẵn sàng, bật `RELAY_UPSTREAM_ENABLED=true`, điền
`RELAY_UPSTREAM_INGRESS_URL=http://<tailscale-host>:31000/v1/ingress/events` và đăng ký một upstream browser
credential riêng trong cả Relay và Input Gateway. Relay giữ nguyên `IngressEvent v1`, `source_id` và
`event_id` khi forward.

`/healthz` và `/readyz` có thể public qua health check. `/status` và `/metrics` chỉ bật khi
`RELAY_ADMIN_TOKEN` được cấu hình, với header `x-funnelmetry-admin-token`.
