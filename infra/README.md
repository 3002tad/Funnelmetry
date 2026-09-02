# Local infrastructure

## V2 end-to-end stack

The supported local vertical slice uses Docker Compose and is isolated from `infra/.env`:

```powershell
docker compose -f infra/compose.v2.yml up -d --build
docker compose -f infra/compose.v2.yml run --rm e2e-smoke
```

Service one-shot `postgres-migrations` áp dụng tuần tự mọi migration V2 trước khi các PostgreSQL
worker khởi động, nên volume cũ cũng nhận migration mới mà không cần xóa dữ liệu.
`funnel-maturity-scheduler` cũng chạy trong stack nhưng sẽ không có candidate với reference profile
`null/null`; worker không đóng outcome hay phát KPI ở phase hiện tại.

The smoke runner sends the approved four-step Commerce Conversion sequence through Input Gateway,
Kafka, Canonical Normalizer, Canonical Ledger Writer, Ingress Telemetry Writer, Journey Processor,
Funnel Processor and KPI Projector. A successful run ends with:

```text
[v2-e2e] ordered canonical=4 journeys=1 outcome=CONVERTED steps=4/4
[v2-e2e] out-of-order canonical=4 journeys=1 outcome=CONVERTED steps=4/4
[v2-e2e] unsupported outcome=unsupported quarantine=mapping_not_found canonical=0
[v2-e2e] fallback-time basis=ingress_fallback authoritative=false
[v2-e2e] telemetry accepted=10 terminal=10 normalized=9 unsupported=1
```

Inspect service state and logs with:

```powershell
docker compose -f infra/compose.v2.yml ps
docker compose -f infra/compose.v2.yml logs --tail 100
```

Stop the stack while retaining local Kafka/PostgreSQL data:

```powershell
docker compose -f infra/compose.v2.yml stop
```

Only use `docker compose -f infra/compose.v2.yml down --volumes` when the local V2 data may be
deleted. The stack deliberately excludes Dashboard, Medusa adapter, k3s and CI/CD.

Thư mục này giữ cấu hình môi trường dùng chung và schema PostgreSQL cho quá trình
phát triển local.

- Sao chép `.env.example` thành `.env` và điền giá trị phù hợp trên máy cá nhân.
- Các ứng dụng Node nạp trực tiếp file này bằng tùy chọn `--env-file`.
- `postgres/` chứa schema và dữ liệu khởi tạo còn được dùng để tham khảo khi xây V2.
- Input Gateway và Canonical Normalizer cần Kafka. Raw/canonical/quarantine topic dùng
  delete retention; receipt/canonicalization-outcome topic dùng compaction. Các topic
  canonical-persisted, journey-resolved, funnel-updated và kpi-updated là durable stage handoff
  dùng delete retention.
  Repository hiện chưa tự provision Kafka.

Manifest k3s và workflow CI/CD V1 đã được loại bỏ. Không có lệnh deploy cluster
được hỗ trợ trong cấu trúc hiện tại.

Xem [cấu trúc repository](../docs/REPOSITORY_LAYOUT.md) và
[hướng dẫn gốc](../README.md).
