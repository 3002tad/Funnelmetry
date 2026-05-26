# Hướng dẫn tích hợp Tracking SDK — Laptop 2

> Web React trên **Laptop 2** gửi event về backend **Laptop 1** (k3s) qua tailnet / WSL IP.  
> Runtime: [`RUNTIME.md`](RUNTIME.md) · Ports: [`infra/PORTS.md`](../infra/PORTS.md)

## Thông tin kết nối

| | Giá trị (k3s) |
|--|--|
| Tracking API | `http://lap1:31000` hoặc `http://<WSL_IP>:31000` |
| Dashboard UI | `http://<WSL_IP>:30809` |
| Mạng | Tailscale + WSL IP |

Deploy Laptop 1: `k3s kubectl apply -k infra/k8s/sprint3`

---

## Bước 1 — Cài Tailscale trên Windows (nếu chưa)

1. Tải: https://tailscale.com/download/windows → cài đặt
2. PowerShell (Admin):

```powershell
tailscale up --login-server=https://vpn.simplething.id.vn --auth-key=<AUTH_KEY> --hostname=Lap2
```

3. Verify:

```powershell
tailscale status
ping lap1
```

---

## Bước 2 — Test Tracking API từ Laptop 2

```powershell
curl -Method POST http://lap1:31000/track `
  -ContentType "application/json" `
  -Body '{"event_type":"page_view","anonymous_id":"test_anon","session_id":"test_sess","page_url":"/"}'
```

Kết quả mong đợi: `{"accepted": true, "event_id": "evt_..."}`

---

## Bước 3 — SDK trong project React

Khuyến nghị dùng package repo: `sdk/browser-behavior-sdk/` (demo-shop đã tích hợp).

### `.env` (Laptop 2)

```env
VITE_TRACKING_API_URL=http://lap1:31000
```

Hoặc WSL IP: `http://172.29.x.x:31000` (xem `hostname -I` trong WSL).

### Ví dụ `src/lib/tracking.js`

```javascript
import { createBehaviorSdk } from "@pipeline/browser-behavior-sdk";

export const tracking = createBehaviorSdk({
  endpoint: import.meta.env.VITE_TRACKING_API_URL || "http://lap1:31000",
  debug: import.meta.env.DEV,
});

tracking.initAutoPageView();
```

Commerce (`checkout_start`, `purchase_succeeded`, …) gửi cùng SDK — `event_source: browser_sdk`.

---

## Bước 4 — Gắn tracking vào trang

```javascript
import { tracking } from "../lib/tracking";

tracking.trackProductView(productId, location.pathname).catch(() => {});
tracking.trackCustom("add_to_cart", { product_id: id, metadata: { price } }).catch(() => {});
tracking.trackCustom("purchase_succeeded", {
  metadata: { order_id: orderId, amount: total },
}).catch(() => {});
```

Chi tiết event types: [`Refactor_tracking_pipeline.md`](Refactor_tracking_pipeline.md).

---

## Bước 5 — Verify trên dashboard

Mở: **http://&lt;WSL_IP&gt;:30809** (hoặc `http://lap1:30809` nếu tailnet tới UI).

- **Events** — event mới (refresh ~5s)
- **Overview** / **Funnel** — KPI sau flush (~30s)

---

## Troubleshoot

| Lỗi | Cách sửa |
|-----|----------|
| CORS | Thêm origin Laptop 2 vào `CORS_ORIGIN` trong `infra/.env`, restart `tracking-api` |
| `ERR_CONNECTION_REFUSED` | `tailscale status`, `ping lap1`, `k3s kubectl -n realtime get pods` |
| `400 validation_failed` | SDK tự sinh `anonymous_id` / `session_id` |
| Event không lên dashboard | Chờ flush streaming; kiểm tra `k3s kubectl -n realtime logs deploy/streaming-processor` |

Chụp DevTools → Network → `/track` (Headers + Response) khi cần debug.
