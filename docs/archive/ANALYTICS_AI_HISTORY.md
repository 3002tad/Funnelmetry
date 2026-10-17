# Analytics và AI — hồ sơ triển khai theo mốc

> Lưu trữ lịch sử, không phải trạng thái kích hoạt hiện tại. Xem docs/analytics/README.md và docs/SWARM_MIGRATION.md trước khi chạy hệ thống.

Đường dẫn `Nguồn gốc` bên dưới là vị trí trước khi gộp; các file riêng đã được loại bỏ. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

## Mục lục theo tài liệu nguồn

- [Kết nối và AI 12/09](#integration-ai-0912) — `docs/INTEGRATION_AI_ACTIVATION_2026-09-12.md`
- [Order analytics 27/09](#order-analytics-0927) — `docs/archive/ORDER_ANALYTICS_ACTIVATION_2026-09-27.md`
- [Order ranking](#order-ranking) — `docs/analytics/ORDER_RANKING_STAGING.md`
- [Product ranking](#product-ranking) — `docs/analytics/PRODUCT_RANKING_STAGING.md`
- [Admin registry 03/10](#admin-registry) — `docs/analytics/ADMIN_REGISTRY_READONLY_2026-10-03.md`
- [Polars chat prototype](#polars-chat) — `docs/apps/dashboard-api/src/lib/ai/POLARS_CHAT.md`

---

<a id="integration-ai-0912"></a>

> Nguồn gốc: `docs/INTEGRATION_AI_ACTIVATION_2026-09-12.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Integration and AI activation — 2026-09-12

> Historical stages: private ingress has been superseded by authenticated HTTPS Event Feed pull. Do not use these bootstrap steps as the current deployment baseline. See [Swarm operations](../SWARM_MIGRATION.md) and [analytics map](../analytics/README.md) for later capability records. Keep this file for provenance.

User-approved scope: proceed with Medusa connectivity and AI. Provider choice:
Alibaba Cloud Model Studio/DashScope directly, Singapore, Qwen Flash. No OpenRouter.
This supersedes the earlier local-model assumption, not the Master authorization,
evidence provenance or prohibition on free-text business-state mutations.

## Implemented in this stage

### Latest: Chat V2 HTTP orchestration

`POST /api/v2/chat` now connects the provider to bounded Overview V2 evidence;
disabled unless DASHBOARD_ENABLE_QWEN=true. Checks active versioned session and
capabilities before export and response, limits per-account requests and concurrency,
exports numeric allowlist only and returns server-side evidence. No-evidence skips
the model. Generated text explicitly remains non-official and unverified. UI, live
calls, history and comprehensive answer evaluation remain pending. See AI README
for the current contract; earlier stages below describe historical state.

### Later progress: private bootstrap and AI foundation

Private Tailscale enrollment, Gateway loopback health and local TLS/Serve validation
now work. Remote health/ACL verification from the Medusa host remains pending.
See [private ingress history](DEMO_HANDOFF_HISTORY.md#private-ingress) for runtime evidence and limitations.

Added standalone DashScope transport and permission-checked V2 Overview evidence helper.
Seven offline tests pass: config, request bounds, sanitized errors, no retry, response
validation, timeout/concurrency/cancel and live-account capability checks. No new Chat
route, UI, model call or business data export yet. `DASHBOARD_ENABLE_QWEN` is distinct
from old `DASHBOARD_ENABLE_AI`. See [Dashboard AI](../apps/dashboard-api/README.md#dashboard-ai-backend).

The original stage/gates below remain historical planning context; provider foundation
is now implemented but live activation and authenticated orchestration remain pending.

- Opt-in private-ingress overlay and Tailscale Serve configuration.
- Empty bootstrap credential registries; no inherited E2E write/signing keys.
- Loopback-only Gateway, no Gateway/Postgres host ports, persistent Tailscale state.
- Ignored local runtime env and configuration-only regression checks.
- See [private ingress history](DEMO_HANDOFF_HISTORY.md#private-ingress); no real Tailnet enrollment or event tests yet.

## Remaining activation gates

1. Local Tailscale auth key, correct ACL/HTTPS/MagicDNS, Linux TUN support.
2. Private health verified from the Medusa host, including access-denial checks.
3. Coordinated Medusa URL/HMAC binding update and signed-event acceptance test.
4. Review and integrate existing Relay/SDK/installer branch without overwriting local
   dashboard changes. Browser Relay delivery remains a separate acceptance path.
5. Add a DashScope provider with bounded requests, timeouts, redacted errors and tests.
6. Connect only authorized V2 evidence tools to AI; legacy Chat currently uses V1
   queries/Ollama and must not simply be enabled and claimed to be V2 AI.

## Alibaba configuration discovery (not activated)

Official documentation checked 2026-09-12 shows the Singapore OpenAI-compatible
base URL as `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`.
Copy the exact API endpoint from the user's Singapore workspace console rather than
guessing the WorkspaceId or switching regions. Keep DASHSCOPE_API_KEY backend-only.
The documented Flash family includes `qwen-flash`; confirm model availability in the
actual workspace before a billed smoke call. No API request or business data has
been sent to Alibaba during this stage. No UI, provider transport or AI route changed.

Sources: [Alibaba Model Studio overview](https://www.alibabacloud.com/help/en/model-studio/what-is-model-studio),
[supported model families](https://www.alibabacloud.com/help/en/model-studio/context-cache).

---

<a id="order-analytics-0927"></a>

> Nguồn gốc: `docs/archive/ORDER_ANALYTICS_ACTIVATION_2026-09-27.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Local demo order analytics activation — 2026-09-27

> Historical activation evidence, not a clean-install runbook or current health check. For navigation see [docs index](../README.md); newer ranking/product activation records are indexed in [analytics](../analytics/README.md).

Activated on the existing `funnelmetry-private` installation with user approval.
This is a local demo activation of the staged capability, not a production release.

## Changes applied

- Started PostgreSQL first and created a custom-format `pg_dump` backup at
  `runtime/backups/order-activation-20260927.dump` (305119 bytes at creation).
  `pg_restore --list` succeeded; a restore drill was not performed. Backups and
  runtime env files are ignored by Git and contain sensitive local data.
- Applied `analytics/sql/fact-order-v1.sql`, `catalog-v1.sql`, `evidence-v1.sql`
  in one transaction after confirming these objects did not exist.
- Installed and verified catalog `order-analytics-staging-1.0.0`.
  Catalog remains `VALIDATED_STAGING`; results remain provisional.
- Enabled `DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING` and
  `DASHBOARD_ENABLE_ORDER_CHAT_STAGING` in ignored `runtime/dashboard-private.env`.
- Kept the existing Polars API image and read-only workspace mount. No legacy
  Python/Polars capability was removed. API health returned HTTP 200/PostgreSQL ok.
- Retained the previous normalizer image as
  `funnelmetry/canonical-normalizer:before-order-activation-20260927`, then built
  and recreated only the normalizer using the existing Compose configuration.
  New mapping is `medusa-order-placed-v2` → `order.placed`.
- Started the existing demo using `runtime/start-private-demo.ps1 -NoBrowser`.
  UI is available at http://localhost:5180. Connector readiness passed; worker
  processes were running. These checks alone do not prove all projections complete.

## Data observed

Before startup: five `order.created` events under `medusa-v2-order-placed-v1`, no
new order facts. After pipeline resumed: those same five events plus one
`order.placed` event under `medusa-order-placed-v2`. A read-only semantic tool call
over 2026-08-29 (inclusive) to 2026-09-28 (exclusive), UTC, returned `PROVISIONAL`
with EUR gross order value `20`.

This is placed-order value, not captured/paid/net revenue and not the total of all
historical orders. No claim is made that the received event represents a new real
customer purchase rather than a queued/demo source event. No synthetic event or
order was submitted during activation; no Qwen call was made by the activation.
The five legacy facts were not renamed, deleted or replayed, and offsets/cursor
were not reset. Existing funnel profiles were not republished or migrated.

## Use and rollback

Sign in as an existing analyst, open `/chat`, choose a date range covering the
order, and ask about **giá trị đơn hàng đã đặt**. Inspect evidence and quality
warnings; historical legacy orders are deliberately excluded.

To disable this capability, set both staging flags to `false` in the local env
file and restart only `funnelmetry-private-dashboard-qwen`. Keep schema/evidence
for audit; do not drop them or restore the database as a routine rollback.
Rolling back the normalizer requires reviewing events processed after activation
before selecting the retained image. Do not reset offsets or automatically restore
the snapshot: doing so can discard newer data or mix mapping versions.

Still separate: historical replay/migration, reference funnel cutover and live
Qwen/browser acceptance on this installation. No automatic claim that all legacy
analytics now use the new monetary or conversion semantics.

## Presentation update

The monetary answer renderer now removes redundant fractional zeros beyond two
decimal places using string operations only (no rounding or numeric conversion).
Known quality warning codes are translated into Vietnamese in the answer; unknown
codes remain visible. Structured evidence retains its original decimals and codes.
Seven renderer/chat tests passed before restarting only the dashboard API. Existing
saved chat text is not rewritten: send a new question to see the updated presentation.

---

<a id="order-ranking"></a>

> Nguồn gốc: `docs/analytics/ORDER_RANKING_STAGING.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# tool.order_ranking — staged, opt-in

Master analytical-tool / evidence boundary; Cookbook Analytical Tool Development
and Agent Orchestration. Adds one bounded tool, not unrestricted SQL or an agent loop.

- Top **5 orders per currency**, descending PostgreSQL numeric placed-order amount;
  ties by order ID. Never a global FX ranking, product/day/customer ranking or paid revenue.
- Same reviewed `analytical_fact_order_v1` asset, source `medusa-reference`, exact
  UTC half-open window <=90 days. Source-wide invalid order gate, including rows
  outside the selected time/currency. No filtering away bad facts.
- Separate immutable `order-ranking-staging-1.0.0` registry release; existing
  summary catalog is unchanged. Unknown/tampered releases/bindings fail closed.
- Structured result includes order ID, exact amount string, currency, rank,
  placement time and canonical event IDs; snapshot time, scope, semantic refs,
  quality warnings are preserved. Existing authenticated Analysis Runner persists
  owner-scoped evidence and checks live access before and after execution.
- Chat answer uses deterministic template, no LLM arithmetic/synthesis of money.
  UI evidence and Markdown/JSON report export support ranking rows separately from totals.
- No source/customer details or arbitrary raw payload. No source writes.

## Activation after isolated integration passes

No schema migration beyond existing fact-order/catalog/evidence artifacts.
Install the new release from a trusted server-side deployment session using the
configured PostgreSQL pool (not from chat or an HTTP admin shortcut):

```js
import { analyticalPool } from './apps/dashboard-api/src/db.js'
import { installRankingCatalog } from './analytics/src/order-ranking.mjs'
try { await installRankingCatalog(analyticalPool) }
finally { await analyticalPool.end() }
```

Enable `DASHBOARD_ENABLE_ORDER_RANKING_STAGING=true` alongside existing
`DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING=true` and
`DASHBOARD_ENABLE_ORDER_CHAT_STAGING=true` in the server environment. Recreate/restart
API using its normal deployment process. No key is needed beyond existing Qwen/DB
configuration. Missing ranking release means the tool is not advertised.
Rollback: turn off the ranking flag and restart API; retain stored evidence/releases.

Example: “Những đơn hàng nào có giá trị cao nhất trong 7 ngày qua?” (UI scope must
include those 7 days). “Doanh thu cao nhất” is ambiguous; planner is instructed to
ask which entity, not substitute an aggregate total. Live model adherence is not
proven by fake-provider routing tests; run real Qwen evaluations before claiming it.

Verification 2026-09-29: unit/routing/HTTP regressions and frontend build passed.
New assertions for actual PostgreSQL rank, separated currencies and quality blocking
are in `tools/v2-e2e/test/medusa-downstream.test.mjs`. This turn could not run that
suite because Docker Desktop was off. **Not activated on the demo**; no real model
request, external event or production DB mutation performed.

## Demo activation — 2026-10-02

Supersedes the not-activated status above for this local demo only.

- Started Docker Desktop and ran `tools/v2-e2e/run-medusa-contract.ps1` successfully
  against isolated PostgreSQL (project `funnelmetry-contract-9a45a694c33c`). Ranking
  assertions covered real numeric values, separate currencies and quality blocking;
  downstream and catalog-reference checks passed. Test project was removed.
- Resumed only existing `funnelmetry-private-postgres-1` and
  `funnelmetry-private-dashboard-qwen`. No Source Connector/Kafka/worker resume,
  replay, synthetic business event or external Qwen call was performed.
- Saved custom PostgreSQL backup to ignored
  `runtime/backups/before-ranking-20261002.dump`. Full archive listing succeeded;
  this backup has not undergone a restore rehearsal and is not a migration snapshot.
- Installed and discovered `order-ranking-staging-1.0.0` against the live base
  catalog/binding. Direct read-only ranking for the trailing 30-day UTC window
  returned PROVISIONAL, one order row, EUR. No raw order identifiers logged.
- Set `DASHBOARD_ENABLE_ORDER_RANKING_STAGING=true` in ignored
  `runtime/dashboard-private.env`; restarted only the API, whose command loads that
  file. Verified ranking/summary/chat flags are true.

Still pending: live Qwen question selection, authenticated browser-to-tool acceptance
for ranking, additional ranking fixtures (ties/top-5 boundaries), and feed freshness/
completeness/reconciliation. The direct tool check does not certify these. Existing
demo data is stored data while ingestion remains stopped. Catalog-name sync remains
inactive: `runtime/catalog-sync.env` is absent. No Medusa Admin key was inferred or reused.

---

<a id="product-ranking"></a>

> Nguồn gốc: `docs/analytics/PRODUCT_RANKING_STAGING.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Product unit-value ranking — 2026-10-03

User-approved proxy: SUM(historical unit price × quantity), grouped by source,
product and currency. Not allocated order total, paid/net revenue or catalog price.
Source unit-price tax/discount inclusion is unverified; no additional tax, shipping,
discount, refund or cancellation allocation is inferred.

## Implementation

- Draft metadata (historical filename `metadata/product-value-v1.json`, now embedded in `metadata/analytical-coverage-v1.json` under `asset.ordered_product_item.definition`); separate immutable catalog release.
- Staged read-only asset: `sql/product-value-v1.sql`, based on validated order facts
  and canonical item arrays. Repeated identical order deliveries count once.
  Conflicting item arrays, missing/empty items or invalid amounts block the scope.
- `src/product-ranking.mjs`: PostgreSQL numeric aggregation, top 5 per currency,
  ties by product ID, strict <=90-day scope, source-wide quality gate, exact strings.
- Current catalog names are optional descriptive references with snapshot provenance;
  missing catalog does not change amounts. Never read current prices.
- Existing authenticated Analysis Runner persists evidence. Chat is opt-in through
  `DASHBOARD_ENABLE_PRODUCT_RANKING_STAGING=true`; default disabled.
- Chat renderer, evidence table, JSON and Markdown export preserve separate semantics.

## Activation gate / remaining

Not activated on demo. Docker was unavailable on 2026-10-03; isolated PostgreSQL
acceptance (`tools/v2-e2e/run-medusa-contract.ps1`) could not run. Added assertions
cover duplicate delivery, separate currencies, item value distinct from order total,
and conflicting item arrays. Still require SQL execution, top-5/tie/decimal fixtures,
authenticated product HTTP/evidence checks and live Qwen/browser acceptance.

After isolated acceptance: back up demo, apply the staged SQL view, call
`installProductRankingCatalog(pool)` from a trusted deployment session, then enable
the flag and restart Dashboard API. Do not change source or replay history.
Rollback: disable flag and restart API; preserve releases and saved evidence.

No new real model calls, source changes or demo database writes in this implementation.

## Local demo activation — 2026-10-03

Supersedes the inactive status above for this demo. Isolated PostgreSQL contract
suite passed (project `funnelmetry-contract-39e642bc8fa7`, removed after test).
Backup saved to ignored `runtime/backups/before-product-ranking-20261003.dump`;
archive listing passed (311 entries), no restore rehearsal claimed.
Installed the staged view/catalog transactionally without editing canonical history.
Direct 30-day tool read returned PROVISIONAL, one EUR product with catalog reference.
Enabled product-ranking flag in ignored `runtime/qwen.env`.
Source Connector readiness was not confirmed at launcher completion; these are
stored-data results, not proof of live ingestion or complete source coverage.
No live Qwen call was made during this activation. Remaining acceptance items above
(top-5/ties/decimal fixtures and product-specific HTTP/browser/model tests) remain open.

---

<a id="admin-registry"></a>

> Nguồn gốc: `docs/analytics/ADMIN_REGISTRY_READONLY_2026-10-03.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Admin registry inspection — 2026-10-03

Implemented `/admin/metadata` and `/admin/tools`, backed by read-only
`GET /api/v2/admin/registry`. Scope is the three supported staging analytical
tools (summary, order ranking, product unit-value ranking), not a universal registry.

Live session and `integration.read` permission are checked before and after loading.
Analysts denied. No mutations, secrets, raw events, model calls or publication actions.
Documents are returned only after existing immutable catalog/binding checks succeed.
Missing ranking releases show NOT_INSTALLED; validation or database errors show
UNVERIFIED without exposing internal errors. Chat configuration and provider enablement
are separate from definition verification and do not prove provider health.

UI supports search, refresh, raw escaped definitions, versions/releases and policy
inspection. Metadata skill guidance preserves draft status and distinguishes binding
verification from data quality. Full editing/publishing lifecycle remains unimplemented.

Verification: catalog HTTP tests (including live role/session revocation, invalid
queries, read-only route, sanitized failure) passed; frontend TypeScript/Vite build passed.
No schema migration. Existing unrelated local changes preserved.

Follow-up: `/admin/metric-catalog` now presents measures, metrics, dimensions,
formula/aggregation, explicit grains, time basis and policies from the same verified
endpoint. Reference-only entries remain labeled as references; absent relationships
are not inferred. Search also matches definition IDs. Read-only scope and live Admin
permission remain unchanged; no definition editing or publication API added.

Follow-up: `/admin/schemas` and `/api/v2/admin/mappings` inspect the fixed Medusa
source-native artifact, showing source/payload version, canonical mapping/class,
payload contract and SHA-256. No user-supplied path; output fields allowlisted.
Runtime activation remains UNVERIFIED. Generated passthrough/behavior mappings and
full JSON schemas are not included; this is not a full mapping management lifecycle.

Follow-up: `/admin/run-diagnostics` uses read-only
`GET /api/v2/admin/run-diagnostics` with live `pipeline.monitor` checks before/after
DB access. Returns at most 50 persisted executions in 30 days, optionally filtered
by allowlisted status. Only run/call IDs, timestamp, status and allowlisted tool/error
codes are exposed; no actor, questions, business results or raw error text.
Source: `analytical_execution_evidence`, not general chat telemetry. Missing model
failures, in-flight runs, retry/re-plan, latency/cost are explicitly disclosed.
No database migration or retry action. Unit HTTP security test and frontend build
are required; live acceptance is pending while Docker is stopped.

---

<a id="polars-chat"></a>

> Nguồn gốc: `docs/apps/dashboard-api/src/lib/ai/POLARS_CHAT.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Bounded event-count tool (prototype)

Enable explicitly with `DASHBOARD_ENABLE_POLARS=true` in the Dashboard API process.
Default false preserves overview-only chat. Qwen must also be enabled separately.
Runtime requires `python3` + `polars==1.34.0`; private demo image:
`infra/docker/dashboard-api-polars.Dockerfile` (workspace and existing node_modules mounted
read-only at `/workspace`, same env files as the existing private API).
No Docker socket or model-generated SQL/code is used by the API.

Metadata: `event-count-tool.js`, `eventCountMetadata` (id/version/grain/measure/time
basis/limits/permissions). This is a code-owned registry seed, not a database-backed
semantic catalog or Admin metadata editor.

Execution: authenticated request → current capability check → Qwen JSON selection
(`event_counts`, `overview`, `unsupported`) → strict validation → one read-only
operation → capability recheck → Qwen explanation → capability recheck → evidence UI.
This uses the existing text-provider interface with strictly validated JSON planning,
not DashScope native function calling. At most two provider calls per request, no loop.
Planner can narrow the UI window with last_hours (1..2160), never expand it or change
source. An explicit window outside the UI scope fails with 400. No free-form filters.

Event-count query is parameterized and READ ONLY, timeout 10s/lock 2s, max 10,000 rows.
Overflow fails with 422, never silently samples. Child Python gets only event-type
strings, no DB or Qwen credentials, fixed script, 10s timeout and 64KiB output cap.
The fixed Polars script is trusted local code, not a sandbox for arbitrary Python.
Node independently verifies each returned group count. No raw payload or identity
is sent to the provider. Event types, aggregate counts, source, time window and the
user question are sent to Alibaba for explanation; existing UI notice applies.

Grain is stored canonical rows, not deduplicated source events or customers. Includes
fallback event times, does not establish source completeness, revenue or payment
success. Evidence is deterministic; model prose is NOT_VERIFIED and not official.
No persisted analysis-run ledger, native tool-call API, RAG or general agent loop yet.
Old overview-only descriptions in README apply when this feature flag is false.

Offline verification:
`node --test test/event-count-tool.test.js test/chat-v2.test.js test/dashscope.test.js test/ai-evidence.test.js`

Demo question: “24 giờ qua có bao nhiêu event, chia theo loại?”
Expand the evidence panel to see actual source/window and the Polars count table.
