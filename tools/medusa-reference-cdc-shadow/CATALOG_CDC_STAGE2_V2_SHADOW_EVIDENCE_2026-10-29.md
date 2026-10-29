# Inventory/price CDC stage-2 v2 shadow evidence — 2026-10-29

**Result:** `PASS_CONTEXT_ONLY` on a fresh isolated clone. This does not approve a sellable-stock/display-price asset or live cutover.

## Why v2 was necessary

The Medusa 2.19.0 source-schema audit found `deleted_at` on all 16 stage-2 tables. The v1 profile omitted it on 12 tables, so its earlier PASS covered only a narrower column set. The installer manifest, operator installer, projector and verifier now use `reference.medusa.inventory_price_context.v2`, all 16 `deleted_at` columns, a new replication role/publication/slot, connector, topic prefix and coverage epoch. The v1 slot/topics were not reused.

## Isolated run

On `ssh kltn`, project `funnelmetry_cdc_inventory_price_shadow_stage2b` in `/srv/KLTN/cdc-shadow-inventory-price2` cloned live Medusa PostgreSQL through read-only `pg_dump` into a private PostgreSQL volume with logical WAL. `CDC_COVERAGE_EPOCH=inventory-price-shadow-20261029-b`. Medusa live PostgreSQL and the Pipeline Swarm stack were not changed. Installer `plan`, `apply` and `verify` passed with generated profile SHA-256 `dcd8c8633b1497bb1122fc4d2da69c87cd3465d69c93663b81505339eeb89b9f`.

Initial snapshot returned `PASS_CAPTURE_ONLY`: 16/16 table counts matched Kafka topic ends; connector was running, snapshot complete and slot usable. The keyed projector returned `PASS_CONTEXT_ONLY`: source/projection keys, selected attributes, soft-delete state and applied topic offsets matched on all 16 tables. Nonempty row counts were product-sales-channel 104, sales-channel 2, channel-location 2, stock-location 1, variant-inventory-item 20, inventory-item 20, inventory-level 20, variant-price-set 120, price-set 122, price 146, price-rule 2, region 1 and currency 126. `reservation_item`, `price_list` and `price_list_rule` were empty.

The clone probe changed `inventory_level.stocked_quantity`, soft-deleted an `inventory_item` and a `product_sales_channel` relation in one transaction, then restored all three. Both changed and restored states returned `PASS_CONTEXT_ONLY`. The replay probe reset only this clone's projector consumer group to earliest; audit count remained **692 → 692** and offsets did not move backward or duplicate effects (`PASS_REPLAY`). After temporarily starting the clone Medusa backend, a read-only Store API sample for a managed variant in one channel/location and EUR region showed DB stocked quantity 1,000,000, reserved 0, required quantity 1 and Store API inventory quantity 1,000,000; DB default EUR price amount 10 matched Store API calculated amount 10. This is a simple sample, not coverage for reservations, multiple locations, backorders, price lists or rules.

The final projection reconciliation passed after the Store API probe. All stage2b containers were stopped with Compose `stop`; volumes, slot/topics and private credentials remain for audit/replay. The earlier stage2a containers were also stopped; its volumes remain.

## Remaining acceptance

- Exercise nonempty reservation, price-list and price-list-rule fixtures and every active/soft-deleted relation on the Medusa version being deployed.
- Build a governed Pipeline sink and a context-aware inventory/price resolver; compare controlled channel/location/reservation and price-rule cases with Medusa Store API. Unsupported contexts must remain `UNVERIFIED` or `BLOCKED_BY_QUALITY`.
- Define continuous quality/freshness and WAL budgets, prove target-topology shadow, then obtain a separate CDC-12 live cutover decision. The clone's `PASS_CONTEXT_ONLY` is not a production acceptance result.
