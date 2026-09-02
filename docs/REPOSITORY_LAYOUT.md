# Repository layout V2

## Nguyên tắc

- `apps/` chứa process có HTTP/UI entrypoint.
- `workers/` chứa background processing theo capability.
- `packages/` chứa contract và library dùng chung, không sở hữu business lifecycle.
- `integrations/` chỉ chứa host binding/config theo source platform.
- `infra/` không mang semantics nghiệp vụ và không giữ runtime V1 đã bỏ.
- Code V1 được giữ tạm để tham chiếu; không đổi tên cơ học thành component V2.

## Mapping migration

| Cũ | Mới | Trạng thái |
| --- | --- | --- |
| `clients/dashboard-ui-preview` | `apps/dashboard-web` | Đã chuyển |
| `services/dashboard-api` | `apps/dashboard-api` | Đã chuyển |
| `services/tracking-api` | `legacy/services/tracking-api` | Đã gom V1; `apps/input-gateway` đã có HTTP/security boundary, Kafka transaction và receipt replay runtime |
| `services/streaming-processor` | `legacy/services/streaming-processor` | Đã gom V1; canonical normalizer V2 đã tách riêng, các capability khác triển khai sau |
| `clients/api-docs` | `tools/api-docs` | Đã chuyển |
| `clients/dashboard` | `legacy/clients/dashboard` | Đã gom UI V1 để đối chiếu |
| `sdk/browser-behavior-sdk` | `legacy/sdk/browser-behavior-sdk` | Đã gom V1; package V2 nằm tại `packages/browser-sdk` |
| `services/commerce-backend` | `legacy/services/commerce-backend` | Đã gom làm fixture lịch sử |

## Target tree

```text
apps/
  dashboard-api/
  dashboard-web/
  input-gateway/             # runnable HTTP + Kafka durable-ingress boundary
workers/
  canonical-normalizer/      # runnable raw → canonical/quarantine worker
  ingress-telemetry-writer/  # accepted/outcome Kafka → durable Data Health evidence
  canonical-ledger-writer/   # canonical Kafka → PostgreSQL source of truth
  journey-processor/         # persisted canonical → progressive journey projection
  funnel-processor/          # journey-resolved -> versioned Funnel Instance projection
  funnel-maturity-scheduler/ # maturity evidence store; polling runtime is still gated
  kpi-projector/             # funnel-updated -> idempotent KPI base facts/observed views
  reconciliation-worker/     # future
packages/
  input-contract/
  canonical-contract/        # CanonicalEvent v1 + terminal outcome
  time-semantics-contract/   # pure horizon/grace/maturity and late-arrival rules
  analytics-contract/        # future
  shared-config/             # future
  browser-sdk/
  backend-integration-kit/
integrations/
  medusa/
tools/
infra/
tests/
legacy/                      # reference-only V1 code
```

## Migration gates

Mỗi capability chỉ thay V1 khi có test tương ứng và consumer mới chạy được. Không
xóa code V1 dùng làm đối chiếu trước khi vertical slice V2 đã đạt acceptance gate.
