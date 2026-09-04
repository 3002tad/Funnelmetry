# Funnelmetry dashboard web

Frontend V2 của Funnelmetry. Các màn hình `Overview`, `Funnels`, `Journeys`, `Events` và `Data Health`
đọc dữ liệu thật từ Dashboard API V2; các màn hình còn lại vẫn là UI demo trong giai đoạn chuyển đổi.

## Cấu hình

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Các biến môi trường:

- `VITE_DASHBOARD_API_URL`: địa chỉ Dashboard API, mặc định `http://localhost:32000`.
- `VITE_ANALYTICS_SOURCE_ID`: source bắt buộc dùng để scope mọi analytics query.
- `VITE_ANALYTICS_WORKSPACE_NAME`: tên workspace hiển thị trên giao diện.

Mở `http://localhost:5180`, đăng nhập bằng tài khoản của Dashboard API. Access token chỉ được lưu
trong `localStorage` để phục vụ bản local demo; UI không chứa token hard-code.

## Trạng thái dữ liệu

- `Overview`: Funnel Profile instance totals và observed conversion.
- `Funnels`: từng profile/version, reached steps và quality state.
- `Journeys`: canonical event metadata, identity evidence summary và Funnel Instances.
- `Events`: canonical ledger metadata; không trả raw payload, identity hoặc aggregate ID.
- `Data Health`: time-basis, processing latency, Funnel projection quality, reconciliation/repair evidence
  và authoritative business quality gate. Gate chỉ eligible khi mọi window trong scope đã `RECONCILED`.
- `Settings`: tài khoản thật, analytics scope đang dùng và đổi mật khẩu qua Dashboard API.
- `Products`, `Insights` và session detail: còn dùng mock/demo data.

Các conversion rate trên UI là `OBSERVED` theo cohort `entry_at`, chưa phải matured/final KPI.

## Kiểm tra production build

```powershell
npm run build
```

Output được tạo tại `dist/` và không được commit.

Các page route được lazy-load. Data Health dùng SVG React nhẹ thay cho chart runtime; cả `echarts` và
`echarts-for-react` đã được loại bỏ để giảm bundle và dependency attack surface.

Frontend hiện build bằng Vite 8 và React Router 7 trên Node `^20.19.0 || >=22.12.0`.
