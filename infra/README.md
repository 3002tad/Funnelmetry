# Local infrastructure

Private Tailscale ingress (opt-in, separate from E2E): see [PRIVATE_INGRESS.md](PRIVATE_INGRESS.md).
Configuration regression check: `powershell -File infra/test-private-ingress.ps1`
from the repository root; no real auth keys or container startup required.

## V2 end-to-end stack

### Medusa reference key registry (SYNC-001)

`compose.v2.yml` keeps `e2e-browser` / `e2e-backend` for the isolated smoke runner.
For real Medusa input, add `-f infra/compose.medusa.yml` after the base file. This
override replaces both registries; it does not reuse the E2E credentials.

Supply these environment variables to Compose through your local secret mechanism:

- `MEDUSA_GATEWAY_BROWSER_KEYS_JSON`: JSON object with key `medusa-reference-dev`,
  value `{ "source_id": "medusa-reference", "secret": "<browser-write-key>" }`.
- `MEDUSA_GATEWAY_BACKEND_KEYS_JSON`: JSON object with the same key ID and source,
  but `secret` set to a separate backend HMAC signing key.

The placeholders above are not usable credentials. Use a JSON serializer when
constructing registries so special characters in credential values are escaped.
The browser value must match storefront `NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY`;
the backend value must match backend runtime `FUNNELMETRY_BACKEND_SIGNING_KEY`.
Browser write keys are public/write-only; backend signing keys are privileged.
Do not commit either registry containing actual credentials or print rendered Compose
configuration/logs containing them. Runtime environment values are visible to Docker
administrators; this local override is not a production secret-store integration.

Validate without printing interpolated values, from the repository root:

```powershell
docker compose -f infra/compose.v2.yml -f infra/compose.medusa.yml config --quiet
```

Missing/empty registry variables fail configuration; malformed JSON fails Gateway
startup. After credentials and the remaining Medusa activation steps are ready,
use the same two `-f` arguments for `up -d --build`. Do not run the default
`e2e-smoke` against these replaced registries: it deliberately uses E2E-only IDs.
Run the original smoke stack separately with its original base configuration.

This override and the Gateway regression tests do not prove a live Medusa handoff.
SYNC-001 remains OPEN until valid browser/backend requests are checked on the
configured runtime, with invalid key/source requests rejected before handoff.

### Isolated pipeline smoke stack

The supported local vertical slice uses Docker Compose and is isolated from `infra/.env`:

```powershell
docker compose -f infra/compose.v2.yml up -d --build
docker compose -f infra/compose.v2.yml run --rm e2e-smoke
```

Service one-shot `postgres-migrations` áp dụng tuần tự mọi migration V2 trước khi các PostgreSQL
worker khởi động, nên volume cũ cũng nhận migration mới mà không cần xóa dữ liệu.
`funnel-maturity-scheduler` cũng chạy trong stack nhưng sẽ không có candidate với reference profile
`null/null`. Khi profile version cấu hình time policy, atomic outcome/KPI finalization có thể bật qua
`MATURITY_SCHEDULER_FINALIZATION_ENABLED`; event muộn đủ strong-business-key evidence được lưu riêng.

The smoke runner first sends the strict four-step Commerce Conversion sequence as a pipeline self-test
through Input Gateway, Kafka, Canonical Normalizer, Canonical Ledger Writer, Ingress Telemetry Writer,
Journey Processor, Funnel Processor and KPI Projector. It separately verifies the bounded Medusa input
demo without claiming that unsupported authoritative facts exist. A successful run ends with:

```text
[v2-e2e] pipeline-self-test-ordered canonical=4 journeys=1 outcome=CONVERTED steps=4/4
[v2-e2e] pipeline-self-test-out-of-order canonical=4 journeys=1 outcome=CONVERTED steps=4/4
[v2-e2e] medusa-input canonical=4 order=order.created commerce_conversion=IN_PROGRESS
[v2-e2e] unsupported outcome=unsupported quarantine=mapping_not_found canonical=0
[v2-e2e] fallback-time basis=ingress_fallback authoritative=false
[v2-e2e] telemetry accepted=14 terminal=14 normalized=13 unsupported=1
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
