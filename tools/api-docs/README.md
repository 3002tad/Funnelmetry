# API docs

Swagger UI mặc định mở Funnelmetry Analytics API V2 và cho phép chuyển sang contract V1 trong
dropdown phía trên. V1 chỉ được giữ làm tài liệu tham khảo lịch sử.

```powershell
npm install
npm test
npm run dev
```

Mở `http://localhost:5190`. `npm test` so sánh toàn bộ path trong `openapi-v2.yaml` với manifest route
Express, kiểm tra JWT security, `source_id`, response `200`, observed metric marker và privacy fields.

Tài liệu V1: [`legacy/docs-v1/API.md`](../../legacy/docs-v1/API.md).
