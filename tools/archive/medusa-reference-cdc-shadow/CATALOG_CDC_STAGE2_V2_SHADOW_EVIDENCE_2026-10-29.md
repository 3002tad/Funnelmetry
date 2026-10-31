# Inventory/price CDC stage-2 v2 shadow evidence — 2026-10-29

**Result:** `PASS_CONTEXT_ONLY` on a fresh isolated clone. This does not approve a sellable-stock/display-price asset or live cutover.

## Why v2 was necessary

The Medusa 2.19.0 source-schema audit found `deleted_at` on all 16 stage-2 tables. The v1 profile omitted it on 12 tables, so its earlier PASS covered only a narrower column set. The installer manifest, operator installer, projector and verifier now use `reference.medusa.inventory_price_context.v2`, all 16 `deleted_at` columns, a new replication role/publication/slot, connector, topic prefix and coverage epoch. The v1 slot/topics were not reused.

## Isolated run

On `ssh kltn`, project `funnelmetry_cdc_inventory_price_shadow_stage2b` in `/srv/KLTN/cdc-shadow-inventory-price2` cloned live Medusa PostgreSQL through read-only `pg_dump` into a private PostgreSQL volume with logical WAL. `CDC_COVERAGE_EPOCH=inventory-price-shadow-20261029-b`. Medusa live PostgreSQL and the Pipeline Swarm stack were not changed. Installer `plan`, `apply` and `verify` passed with generated profile SHA-256 `dcd8c8633b1497bb1122fc4d2da69c87cd3465d69c93663b81505339eeb89b9f`.

Initial snapshot returned `PASS_CAPTURE_ONLY`: 16/16 table counts matched Kafka topic ends; connector was running, snapshot complete and slot usable. The keyed projector returned `PASS_CONTEXT_ONLY`: source/projection keys, selected attributes, soft-delete state and applied topic offsets matched on all 16 tables. Nonempty row counts were product-sales-channel 104, sales-channel 2, channel-location 2, stock-location 1, variant-inventory-item 20, inventory-item 20, inventory-level 20, variant-price-set 120, price-set 122, price 146, price-rule 2, region 1 and currency 126. `reservation_item`, `price_list` and `price_list_rule` were empty.

The clone probe changed `inventory_level.stocked_quantity`, soft-deleted an `inventory_item` and a `product_sales_channel` relation in one transaction, then restored all three. Both changed and restored states returned `PASS_CONTEXT_ONLY`. The replay probe reset only this clone's projector consumer group to earliest; audit count remained **692 → 692** and offsets did not move backward or duplicate effects (`PASS_REPLAY`). After temporarily starting the clone Medusa backend, a read-only Store API sample for a managed variant in one channel/location and EUR region showed DB stocked quantity 1,000,000, reserved 0, required quantity 1 and Store API inventory quantity 1,000,000; DB default EUR price amount 10 matched Store API calculated amount 10. This is a simple sample, not coverage for reservations, multiple locations, backorders, price lists or rules.

The final projection reconciliation passed after the Store API probe. All stage2b containers were stopped with Compose `stop`; volumes, slot/topics and private credentials remain for audit/replay. The earlier stage2a containers were also stopped; its volumes remain.

## Nonempty relation follow-up

The same isolated stage2b clone was restarted with only PostgreSQL, Kafka,
Connect, projection PostgreSQL and the projector. A fixture transaction created
one `reservation_item`, increased the matching `inventory_level.reserved_quantity`
by two, created an active dated `price_list`, one JSONB `price_list_rule` and one
EUR price linked to the list. Source and projection reconciled with all four
fixture tables nonempty (`PASS_CONTEXT_ONLY`), including timestamp and JSONB
attributes. A second transaction removed the fixture rows and restored the
level value; final source/projection checks again passed. Replay kept audit
count **732 → 732** and offsets unchanged (`PASS_REPLAY`). The clone containers
were stopped; volumes and audit history remain.

The reservation fixture deliberately changed both the reservation row and
level aggregate in the clone. It proves capture and projection of those
changes, not that direct SQL is Medusa's production workflow or that a
sellable-stock/display-price formula is correct. The price-list rows were
not compared with Store API calculated price. No historical order value was
rewritten.

## Store API and checkout workflow follow-up

With clone backend/Redis/Source Ingress running, a controlled Store API probe
selected one published, managed variant with a single inventory item and
eligible channel/location in EUR. Initial `inventory_quantity=1,000,000` and
calculated amount `10` matched the source context. The direct-SQL fixture
added a reservation quantity of two and a dated EUR sale price of `8` scoped
by `price_list_rule.region_id`. CDC projection matched the source. Store API
then returned price `8` with `price_list_type=sale`, but inventory quantity
remained `1,000,000` instead of `999,998`. The probe reported
`BLOCKED_BY_QUALITY`; the fixture was removed and Store API/source returned
to baseline. This shows direct SQL is not a valid conformance method for
inventory availability in this Medusa runtime; whether query-cache
invalidation caused the difference is **an inference**, not yet proven.

The same clone then completed two synthetic checkouts of the managed variant
through Medusa Store API. The first order `order_01M63Q297RJJA58V3SE3Q4RDZC`
created a real reservation, changed `reserved_quantity` from 0 to 1 while
`stocked_quantity` stayed 1,000,000 and Store API quantity changed to
999,999. The repeatable checkout probe created second order
`order_01M63Q7A6ZNFD417P90FM2G0G7`: source reservation sum and level reserved
each increased by one; Store API quantity changed 999,999 → 999,998;
calculated price stayed 10. Projector reconciliation passed with two active
`reservation_item` rows and all 16 source/projection tables/offsets matched.
Replay kept audit **746 → 746** and offsets unchanged. The clone services were
stopped after verification; source DB, Kafka and projection volumes remain
for audit. No checkout or write was sent to live Medusa/Pipeline.

The workflow probe supports the single-item, single-location, managed variant
case and the observed `stocked - reserved` formula. It does not establish
multi-location allocation, inventory kits, backorder semantics or all
pricing-rule contexts. It does not authorize a governed sellable-stock or
display-price asset on live Pipeline.

## Remaining acceptance

- Compare nonempty reservation, price-list/rule and other applicable contexts
  with Medusa Store API, including Medusa workflow-generated transitions; test
  active/soft-deleted relations on the deployed Medusa version.
- Build a governed Pipeline sink and a context-aware inventory/price resolver; compare controlled channel/location/reservation and price-rule cases with Medusa Store API. Unsupported contexts must remain `UNVERIFIED` or `BLOCKED_BY_QUALITY`.
- A versioned governed **context candidate** has since passed 16-table reconciliation and replay on the isolated clone; see [candidate evidence](INVENTORY_PRICE_GOVERNED_CANDIDATE_EVIDENCE_2026-10-29.md). The context-aware resolver and continuous quality lease are still open.
- Define continuous quality/freshness and WAL budgets, prove target-topology shadow, then obtain a separate CDC-12 live cutover decision. The clone's `PASS_CONTEXT_ONLY` is not a production acceptance result.
