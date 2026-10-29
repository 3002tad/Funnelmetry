# Inventory/price CDC governed context candidate — 2026-10-29

**Result:** `PASS_CONTEXT_ONLY` and `PASS_REPLAY` on the isolated stage2b clone. No live Pipeline binding or inventory/price business metric was activated.

## Candidate

Migration `infra/postgres/v2/022_inventory_price_cdc_context_candidate.sql` creates versioned context, per-topic offsets, ingest audit, capture status and a quality-lease table. The new `workers/inventory-price-cdc-writer` consumes the exact 16-table `reference.medusa.inventory_price_context.v2` allowlist with source PKs. Each CDC row and its next offset commit in one PostgreSQL transaction; a forward offset gap fails closed, a replay is idempotent, and a new input invalidates any existing `PASS` lease. No active analytical view or binding is created: these are raw source relationships and values, not resolved sellable quantity or calculated storefront price.

The migration was applied only to the clone's private projection PostgreSQL, which stands in for a governed Pipeline DB. Compose starts the new worker on the clone's private Kafka network. No live Medusa/Pipeline database, slot, topic, service or credentials were changed.

## Runtime check

Clone: `/srv/KLTN/cdc-shadow-inventory-price2`, Compose project `funnelmetry_cdc_inventory_price_shadow_stage2b`, coverage epoch `inventory-price-shadow-20261029-b`. Initial candidate bootstrap read the existing stage-2 Kafka snapshot and subsequent Store API checkout changes. `verify-inventory-price-governed-candidate.py` returned `PASS_CONTEXT_ONLY`: 16/16 table keys, selected attributes, soft-delete state and topic offsets matched source; connector running, snapshot complete and slot usable. Nonempty `reservation_item` count was 2 from the prior workflow checkouts; `price_list` and `price_list_rule` were empty at final state.

The guarded probe updated one `inventory_level.incoming_quantity`, soft-deleted one `price_set`, then restored both source rows. Candidate/source reconciliation passed after each phase. Resetting only the candidate consumer group to earliest and replaying all topics kept ingest audit **750 → 750** and offsets unchanged (`PASS_REPLAY`). The final verifier returned `PASS_CONTEXT_ONLY`. Clone services were stopped with Compose `stop`; their volumes, slot and audit remain for review.

## Remaining gate

- Add a continuously refreshed context quality lease with source/projection digest and freshness/slot/WAL checks; current table is a schema candidate only.
- Prove the same writer on the target Pipeline PostgreSQL/Swarm topology with a distinct source role, snapshot epoch and network path. Do not point it at the clone slot or reuse clone offsets.
- Build and validate a context-aware resolver against Medusa workflow/Store API cases for multi-location, reservations, kits/backorder, currency, price-list periods, quantity tiers and rules. Any unsupported context must stay `UNVERIFIED` or `BLOCKED_BY_QUALITY`.
- Complete CDC-11/12 gates before switching either backend adapter or API `catalog-sync`. Browser SDK and HTTP feed are unaffected.
