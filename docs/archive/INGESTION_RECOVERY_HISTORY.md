# Ingestion và recovery — hồ sơ theo mốc

> Bằng chứng của các deployment cũ. Không dùng lệnh replay/reset trong đây cho deployment hiện tại; xem docs/SWARM_MIGRATION.md và Backbone DEC-125.

Đường dẫn `Nguồn gốc` bên dưới là vị trí trước khi gộp; các file riêng đã được loại bỏ. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

## Mục lục theo tài liệu nguồn

- [Source Connector 20/09](#source-connector-0920) — `docs/SOURCE_CONNECTOR_ACTIVATION_2026-09-20.md`
- [Behavior V2 cutover](#behavior-v2) — `docs/BEHAVIOR_V2_ONLY_2026-09-20.md`
- [Order placement migration](#order-placement) — `docs/ORDER_PLACEMENT_MIGRATION_2026-09-23.md`
- [Kafka recovery](#kafka-recovery) — `docs/KAFKA_RECOVERY_2026-09-20.md`
- [Unsupported browser replay](#unsupported-replay) — `docs/UNSUPPORTED_REPLAY_PLAN_2026-09-29.md`

---

<a id="source-connector-0920"></a>

> Nguồn gốc: `docs/SOURCE_CONNECTOR_ACTIVATION_2026-09-20.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Source Connector activation — 2026-09-20

Runtime evidence, not a new architecture decision. Governing contract: Master
v0.3.11 and `CORE_IMPLEMENTATION_CONTRACTS_V1.md` in System_Backbone.

Activated on existing `funnelmetry-private` project, retaining Kafka/PostgreSQL
volumes. Built Source Connector, canonical normalizer/ledger and ingress telemetry
images from local code. Compose migrations completed, including 019 cursor storage.
No host ports published for Connector or PostgreSQL. No credential is recorded here.

```powershell
docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.source-connector.yml --profile source-connector up -d --build source-connector canonical-normalizer canonical-ledger-writer ingress-telemetry-writer
```

The ignored `runtime/source-connector.env` supplies an independent Event Feed token.
Initial cursor 0 replay was activated; existing Kafka cluster was retained. This
is NOT a recreated-Kafka/RESTORE_REPLAY procedure.

Observed evidence:

- Source Feed HTTPS authenticated successfully; expected feed identity matched.
- Connector `/readyz`: HTTP 200, READY, cursor 13, no reported error.
- Exact `(source_id,event_id)` join for all 13 returned Source records:
  13 accepted receipts, 9 normalized outcomes/canonical rows, 4 quarantined outcomes.
- Canonical breakdown: 4 `cart.add_clicked`, 4 `checkout.started`, 1 `order.created`.
- All 4 quarantined records are API-bot `behavior.product_viewed` with
  `mapping_failed`; all lack required `source_payload.page_instance_id` and all
  contain `product_id`. No field was fabricated and the mapping was not weakened.
- Connector and PostgreSQL port bindings checked empty.

Limits / follow-up:

- Counts are a point-in-time observation of the 13 existing Source test records,
  not a new browser purchase acceptance test or reliability/SLO benchmark.
- `order.created` does NOT mean payment captured or revenue materialized.
- Handoff cursor 13 does NOT mean processing-safe checkpoint 13; quarantine remains
  visible and downstream Journey/Funnel/KPI readiness was not verified here.
- Source API bot owner should add the catalog-required page instance identifier
  to future product-view events. Do not reuse old immutable event IDs with changed
  payloads or silently repair historical observation facts.
- Historical follow-up on 2026-09-20: the now-removed CMD wrapper started the pull Connector,
  downstream workers and dashboard, without a Gateway/Tailscale startup dependency.
  Two launcher runs succeeded with Connector READY and API/UI HTTP 200; the second
  run reused the same UI process. This does not prove downstream KPI correctness.
- No Git push was performed. Connector is left running to long-poll new events.

---

<a id="behavior-v2"></a>

> Nguồn gốc: `docs/BEHAVIOR_V2_ONLY_2026-09-20.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Demo V2-only behavior cutover

User-directed breaking demo cutover: do not provide behavior v1 replay compatibility.
This does not change the generic `IngressEvent` envelope version or native commerce
source schemas.

- Behavior envelope `source_schema_version`: `2.0` (shared catalog constant).
- Behavior mapping: `canonical-behavior-v2`, distinct from old `canonical-passthrough-v2`.
- Explicit schema selection; behavior schema 1.0/unknown versions are unsupported.
- `cart.add_clicked` is unsupported, never translated to `cart.item_added`.
- Browser produces only browser catalog events. Search requires `source_bridge`,
  schema 2.0 and sanitized v2 payload. Wrong producer/invalid payload quarantines.
- Browser queue key is v2; restored custom queues cannot forward old-schema events.
- Backend forwarder defaults search schema to 2.0. Native Medusa order schemas and
  source-scoped mapping artifact remain unchanged; Catalog v2 is not Medusa v2.

## Source deployment coordination

Revised by user request: deployed `medusa-reference` browser may keep schema `1.0`
for the seven unchanged browser event payloads. Pipeline binds those explicitly to
`medusa-browser-schema1-catalog-v2`, validates with Catalog v2 and requires
`browser_sdk`. No other source receives this alias; browser search/add-click remain
unsupported. This binding does not rename or mutate incoming envelopes.

New sources should deploy the new Browser SDK and update server-only intentional
search hook: stable interaction/event identity, sanitized query, outcome/result
count, asynchronous managed delivery. These local changes do not deploy the public
Medusa website or implement its server action hook. Until coordinated, old browser
events may be unsupported; never fall back to interpreting v1 payload as v2.

## Demo reset already performed

33 local history tables and nine Kafka topics cleared at operator request. Users,
account settings/audit and two funnel profiles retained. Source cursor set to 49;
records up to that cutover boundary deliberately excluded from the new demo.
PostgreSQL backup exists outside Git under local Funnelmetry backups. Remote Source
Event Log was not deleted. Old recovery-check volumes/backups are not the active demo.

---

<a id="order-placement"></a>

> Nguồn gốc: `docs/ORDER_PLACEMENT_MIGRATION_2026-09-23.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Master 0.3.17: downstream order placement — staged change

## Scope and status

Implements the first code slice of Master §14.4.2 (Migration A), plus major-unit
event detail display. Does NOT complete Migration B analytical assets/metadata or
Migration C registry/Agent. No source code or payload contract changed.

- Active native mapping: `medusa.order_placed`, source schema `2.0` → `order.placed`,
  mapping version `medusa-order-placed-v2`. Reject malformed money/producer/cart evidence.
- Source schema `1.0` is unsupported for native Medusa order; no speculative conversion
  of the prior ambiguous `total_minor` data. Browser compatibility binding unchanged.
- Commerce Conversion reference `2.0.0` terminates at `order.placed`.
  `order.created`, `order.accepted`, payment/refund keep separate meanings.
- UI preserves decimal major strings and currency, never derives payment success.
- Generic merchant-acceptance fixtures remain explicit legacy tests, not current
  Medusa acceptance. Old Gateway E2E harness is opt-in legacy only; its fixtures
  cannot certify the current pull-based pipeline or new native mapping.

## History/deployment gate (not executed)

Database historical rows and existing profile activations are unchanged. Do not run
profile publication blindly: it also publishes the optional payment profile.
First snapshot database and record active profiles, cursor/feed lineage and offsets;
inventory old/new order schemas and mappings. Approve an explicit cutover/rebuild
plan with source-event and order-level dedup before processing historical records.
Mapping version participates in canonical ID, so replay under a new version can
create a second canonical row; normal same-version dedup alone is NOT sufficient.
Never count legacy `order.created` and new `order.placed` as two orders.

Activate only Commerce Conversion 2.0.0 for Medusa after staging conformance. Keep
old profile/mapping artifacts available from Git for rollback; do not mutate profile
1.0.0 in place. A rollback must also restore the matching processing state/checkpoint,
not just swap the worker image. No volume deletion, SQL rewrite or replay done here.

## Remaining work / UNVERIFIED

- Real Source Feed 263..282 through Kafka/ledger/Journey/KPI: not run by this change.
- Live cutover and coexistence with already activated historical profiles remain
  unverified. The isolated test below does not establish cross-profile dedup.
- Migration B now has a staged order-grain SQL view and DRAFT metadata binding in
  `analytics/`; publication, quality-gated query access, AOV execution and metadata
  resolver remain unimplemented. Detail display is NOT the monetary analytical tool.
- Semantic tool registry/quality gate/structured persisted evidence remain Migration C.
- Source metadata/UTM preservation and catalog Admin API sync require separate review.

No source-side change requested; source ownership stays with the Medusa developer.

## Isolated downstream conformance (2026-09-23)

Passed one integration test with real PostgreSQL 15, zero skipped tests, using
synthetic events shaped from the documented Medusa schema 2.0 contract:

- Normalizer -> canonical ledger -> Journey -> Commerce Conversion 2.0.0 -> KPI.
- Product view, cart addition, checkout and order placement resolve to one Journey.
- Order has no browser identity; validated `cart_id` and `order_id` are projected
  as business relations. Journey resolution uses strong CART evidence.
- Checkout arriving after order placement still produces one converted funnel.
- Reprocessing the four events leaves canonical/Journey/KPI counts unchanged.
- A synthetic historical `order.created` for the same source event does not add
  an `order.placed` occurrence or another conversion in profile 2.0.0.

The same isolated test now also verifies the staged order view: order-level dedup,
separate EUR/USD totals, decimal preservation, conflicting/invalid money blocking,
and metadata column/type bindings. No metadata publication or live activation occurs.

This test calls worker repositories directly: it does NOT verify the real source
feed, connector cursor, Kafka transport, live worker configuration or historical
profile migration. Monetary aggregation here is controlled test SQL, not an exposed
analytical tool or complete Migration B quality gate.

Run from `Streaming_Pipeline` with Docker and installed Node dependencies for
the participating workers and `tools/v2-e2e`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/v2-e2e/run-medusa-contract.ps1
```

The runner creates a uniquely named Compose project, binds PostgreSQL to a random
localhost port and stores its test database in tmpfs. It restores the caller's
`TEST_DATABASE_URL` and removes only its own project on exit. No demo database,
profile activation, persistent volume or source deployment is modified.

---

<a id="kafka-recovery"></a>

> Nguồn gốc: `docs/KAFKA_RECOVERY_2026-09-20.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Kafka recovery — preparation only

Status: demo recovered using a bounded retained/completed-prefix procedure, verified
first against a restored copy. General RESTORE_REPLAY remains unimplemented.

Observed on Laptop 2:
- No original containers existed before image cleanup. Cleanup removed images only, not volumes.
- Named Kafka volume is empty; read-only metadata scan of remaining volumes found no Kafka recovery metadata.
- Apache Kafka 3.9.1 Docker default uses `/tmp/kraft-combined-logs`; compose mounted `/var/lib/kafka/data` without setting `KAFKA_LOG_DIRS`.
- Compose now explicitly sets `KAFKA_LOG_DIRS=/var/lib/kafka/data`. This prevents future mismatch; it does not recover deleted logs. Do not recreate a running older broker with this change without migrating its log data first.
- PostgreSQL is available with 63 canonical events, 57 journeys, connector handoff cursor 20 and 16 feed canonical events.
- Read-only authenticated Source Feed check from sequence 0 returned 20 records, matching configured feed lineage, retention floor 0, latest/next sequence 20. This is a point-in-time check, not a retention guarantee or processing-safe checkpoint.
- A custom-format PostgreSQL backup was copied outside Git into `%LOCALAPPDATA%/Funnelmetry/backups/<timestamp>/postgres.dump`; `pg_restore --list` succeeded. Full restore has not been tested.

## Recovery executed

- Isolated project `funnelmetry-recovery-check`: restored PostgreSQL backup and new
  Kafka with explicit durable log directory. Same six worker images as demo.
- Operator tool `workers/source-connector/src/recover-retained-prefix.mjs` replays
  from 0 to the saved handoff cursor WITHOUT changing that cursor. It requires
  explicit confirmation/expected cursor, exclusive connector advisory lock,
  matching lineage, retained full prefix, persisted matching receipts and terminal
  outcomes, and completed Journey/KPI applications for every normalized record.
  It preserves original receipt time and refuses incomplete projections. All source
  records are validated before the first Kafka publication. This is NOT arbitrary
  snapshot restore, missing-stage recovery, or a durable processing-checkpoint system.
- Fixed telemetry equality to ignore only outcome `processed_at` on replay;
  original stored document is retained, changed semantics still conflict. PostgreSQL
  regression test passed; 12 telemetry unit tests passed (DB test run separately).
- Both isolated and live replay verified 20 raw/receipt/outcome records and 16
  canonical/persisted/journey/funnel/KPI records via read-committed consumers.
  Four existing quarantined source records remain quarantined.
- Counts and full row hashes unchanged across ten tables: canonical_events,
  journeys, journey_events, funnel_instances, funnel_instance_steps,
  funnel_event_applications, funnel_kpi_instance_facts, funnel_kpi_step_facts,
  kpi_projection_applications, source_connector_cursors.
- Live PostgreSQL remains 63 canonical events, 57 journeys, four funnel instances
  and four KPI instance facts. Cursor stayed 20 throughout replay.
- Restarted NORMAL connector only after live verification. PostgreSQL, Kafka,
  six workers and dashboard API are running. Isolated project is stopped; its
  snapshot volumes remain available for diagnosis. No customer orders/events created.
- `meta.properties` now exists under `/var/lib/kafka/data` in live Kafka.

## Limitations / future recovery

Do not use NORMAL mode with an unverified old cursor against a new Kafka cluster. SourceConnector
currently rejects RESTORE_REPLAY (`RESTORE_MODE_NOT_IMPLEMENTED`). Before enabling
ingestion, implement/test an explicit recovery procedure against an isolated restored
database/new broker, verifying feed lineage/retention, stable identities, canonical
deduplication and Journey/Funnel/KPI effects before changing live state. Include
non-feed legacy data limitations. Do not treat the backup's handoff cursor as a
processing-safe checkpoint or silently reset it to zero. Historical pre-feed Kafka
messages are not recreated; their PostgreSQL projections remain intact. Do not
claim Kafka archive restoration for those legacy messages.

---

<a id="unsupported-replay"></a>

> Nguồn gốc: `docs/UNSUPPORTED_REPLAY_PLAN_2026-09-29.md`. Nội dung dưới đây giữ trạng thái theo mốc của tài liệu gốc.

# Unsupported browser events: dry-run and replay plan

## Execution completed (2026-09-29 local)

Bounded operator replay committed exactly 41 original raw messages in one Kafka
transaction with a separate transactional producer. Confirmed input fingerprint:
`38c7862a65dc4988e753c3b3eb66555d987b1043aff018b16cbc4a3d8f9cf3b5`.
Preflight found cursor 358 and no maturity finalizations. PostgreSQL backup
`runtime/backups/before-browser-replay-20260929.dump` has a readable custom archive
index (restore not tested). Private identity audit stored at
`runtime/backups/browser-replay-manifest-20260929.json` (Git-ignored; no raw payload).

Exact manifest-ID SQL verification after commit:
- expected 41, canonical 41, journey applications 41, KPI applications 41;
- latest normalized outcomes matching expected canonical IDs: 41;
- medusa-reference latest outcome totals: 309 normalized, no unsupported group;
- connector cursor remains 358; old outcome rows were not deleted.

This closes the 41-event recovery, not all system functionality or proof of every
historical KPI semantic. UI interaction was not tested in this recovery operation.
The script defaults to dry-run, requires the exact fingerprint for writes and uses
an exclusive audit-file creation guard. After ambiguous errors inspect broker/DB
and audit before retry; do not remove the guard file to blindly resend.

The remaining sections retain the pre-execution plan and validation history.

## Verified evidence

Read-only inspection matched all 41 latest `unsupported / mapping_not_found /
unmapped-v1` outcomes to retained Medusa Feed records with schema 1.0 and producer
browser_sdk. Each original ingress receipt was found; reconstructed ingestion ID
matched the persisted receipt and original received_at was retained.

The deployed canonical normalizer dry-run accepted all 41 using
`medusa-browser-schema1-catalog-v2`:

| Canonical event | Count |
|---|---:|
| behavior.page_viewed | 11 |
| behavior.scroll_depth_reached | 19 |
| promotion.banner_impression | 2 |
| behavior.product_viewed | 5 |
| checkout.started | 4 |

Two normalizations produced identical canonical IDs. No Kafka/DB writes, cursor
change or historical repair has been performed. This is not proof of downstream
idempotency or maturity/finalization behavior for these late events.

## Tools and safe usage

`workers/source-connector/src/inspect-unsupported.mjs` defaults to metadata-only.
`--normalizer-input` emits sensitive raw records **only for direct piping** to
`workers/canonical-normalizer/src/dry-normalize-stdin.mjs`; never redirect to logs,
chat or committed files. The consumer emits aggregates only and uses deployed
mapping configuration. Producer requires complete bounded Feed scan and original
receipts; consumer rejects wrong schema, more than 10000 messages or input >32 MiB.
Both paths preserve Feed lineage; retention gaps fail closed.

## Required before actual replay

Downstream verification update: the isolated PostgreSQL suite now includes a
separate schema1 browser journey (product/cart/order/delayed checkout). It reaches
four steps and CONVERTED. Re-normalizing and applying all events in reverse order
returns duplicate ledger/journey statuses, unchanged canonical/journey/funnel/KPI
application counts and byte-equivalent KPI rows. This is synthetic DB integration,
not a Kafka transactional replay test or proof for every real journey topology.
Twelve funnel evaluator/late-conversion unit tests also passed. Read-only demo
inspection found zero maturity-finalization and zero late-conversion records at
inspection time; recheck immediately before replay. The 41 real events remain
unreplayed. No changes to source configuration, AI or business history.

1. Snapshot exact candidate identities/old outcomes and approved mapping version;
   abort if candidates or feed lineage changed. Keep manifest in ignored private
   runtime storage; no raw payload in repository.
2. Back up PostgreSQL and record current cursor/checkpoint and projection counts.
3. Verify canonical ledger, Journey, Funnel and KPI duplicate/late-arrival behavior
   using the same mapping; inspect maturity/finalization consequences explicitly.
4. Use a dedicated bounded operator replay path and producer identity, not cursor
   reset or normal connector transactional producer. Preserve original receipts,
   source event IDs, event times and raw ingestion IDs. Do not delete old outcomes.
5. Publish only pinned candidates and track each broker acknowledgement. On
   interruption, inspect acknowledged IDs before retry; never mark complete based
   only on producer success.
6. Verify all candidates have new normalized outcomes, one intended canonical
   identity per event/mapping and downstream projection applications. Re-run the
   same bounded replay to prove no double-counted effects in an isolated test first.

Rollback is not deletion of canonical rows: pause replay and preserve audit, then
use the reviewed snapshot/rebuild procedure if semantic/projection errors appear.
No automatic replay button is authorized by this diagnostic report.
