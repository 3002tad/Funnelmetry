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
- Follow-up on 2026-09-20: `start-private-demo.cmd` now starts the pull Connector,
  downstream workers and dashboard; no Gateway/Tailscale startup dependency.
  Two launcher runs succeeded with Connector READY and API/UI HTTP 200; the second
  run reused the same UI process. This does not prove downstream KPI correctness.
- No Git push was performed. Connector is left running to long-poll new events.
