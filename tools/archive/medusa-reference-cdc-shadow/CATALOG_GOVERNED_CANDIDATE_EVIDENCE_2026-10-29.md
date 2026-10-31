# Catalog CDC governed read candidate — 2026-10-29

**Scope:** Medusa PostgreSQL clone, Compose project `funnelmetry_cdc_catalog_shadow_catalog1` on VPS. This is a shadow candidate for replacing the Admin API catalog sync. Medusa live, Pipeline live, Dashboard provider, and `catalog-sync` were not changed. Clone containers were stopped after the test; their volumes were retained.

## Candidate implementation

- Migration `021_catalog_cdc_candidate.sql` creates source/coverage-epoch keyed current-state projections for product, variant, category, and product-category relation; atomic Kafka input offsets and an ingest audit. `catalog_cdc_ingest_audit` uses a distinct name from the earlier shadow table `catalog_cdc_audit` to avoid a schema collision.
- `catalog-cdc-writer` consumes the four allowlisted Debezium topics, rejects unexpected source/table/columns, applies changes and offsets in one PostgreSQL transaction, deduplicates replay, and invalidates a PASS quality lease when it sees new input.
- `current_product_reference_names_cdc` exposes current descriptive product names only with an explicit ACTIVE binding and a fresh PASS lease. The Dashboard API has an opt-in `catalog_cdc` provider; its default remains `admin_api`. Neither path rewrites historical order money or quantities.
- `publish-catalog-governed-quality.py` is restricted to an isolated clone project. It samples source/projection/topic/connector state twice and publishes a short lease only if row-level reconciliation, snapshot completion, orphan checks, slot state, and offsets pass. SQL rechecks the stored offsets while locking them. This is a candidate gate, not a production freshness monitor or a cutover command.

## Observed tests

| Check | Observation |
|---|---|
| Source versus candidate projection | PASS: 104 products, 120 variants, 4 categories, 4 product-category links; no orphan variants or links. |
| Snapshot and offsets | Snapshot marker observed; topic end offsets and writer next offsets both `product=110`, `product_category=4`, `product_category_product=7`, `product_variant=122`. Connector and slot usable. |
| Row-level checksum | Source and candidate projection both `e2647192aa0f3f998a83af210efa24f747604648d42bd2219cab059bff583806`. |
| Update/replay probe | Product title changed then restored on the clone. Audit advanced 240→241→242. Replaying the consumer group from earliest left audit at 242 and offsets unchanged. |
| Quality lease | After correcting an SQL column-order bug in the new publisher, a 45-second PASS lease was issued for epoch `catalog-shadow-20261029-a`; counts matched. A regression after changing the SQL to require a newly written row also PASS. The first regression attempt ran before Connect was ready and failed; retry after Connect became ready PASS. |
| Read guard | SQL fixture in a transaction showed SHADOW binding returns 0 rows, ACTIVE with PASS returns 1 fixture row, expired lease returns 0; transaction rolled back. Dashboard API tests 4/4 PASS. |
| Worker tests | `npm test --prefix workers/catalog-cdc-writer`: 3/3 PASS, including offset gap, replay dedup, and quality invalidation. |

## Remaining gates

This does **not** prove CDC coverage/freshness on live Medusa. The quality publisher is clone-only, the lease is short-lived and not continuously renewed by a production monitor, and no ACTIVE binding was persisted. Before Dashboard cutover and stopping `catalog-sync`, prove source privilege/privacy and schema pin on the target topology, establish continuous quality monitoring with source WAL/connector lag and production budget, reconcile live snapshot and updates, test rollback with ongoing writes, and approve the catalog cutover independently of the order-state cutover. Inventory/price is still a separate stage-2 context capture; no sellable-stock or display-price analytical asset has been published.
