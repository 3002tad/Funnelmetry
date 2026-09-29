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
