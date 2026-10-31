# Inventory/price CDC stage-2 shadow evidence — 2026-10-29

> **Historical v1 capture only.** A later full schema audit on the same Medusa
> 2.19.0 clone found `deleted_at` on all 16 stage-2 tables; this v1 profile
> omitted it from 12 tables. The PASS_CONTEXT_ONLY result below proves only
> the narrower captured columns and cannot establish active relation or
> inventory/price semantics. Use a new v2 slot/topic/epoch and initial snapshot.

## Scope and topology

Project `funnelmetry_cdc_inventory_price_shadow_stage2a` ran only on the VPS
under `/srv/KLTN/cdc-shadow-inventory-price1`. `clone-db.py` read the Medusa
PostgreSQL source and restored a separate logical-WAL PostgreSQL volume. No
live Medusa replication setting, publication, slot or Pipeline binding was
changed. Only `postgres`, `kafka`, `connect`, `inventory-price-projection-db`
and `inventory-price-projector` ran in the internal Docker network. The
generated Medusa profile is `funnelmetry/cdc-inventory-price-shadow.json`.

The installer created separate `cdc_inventory_price` role,
`funnelmetry_cdc_inventory_price_shadow` publication/slot,
`medusa-cdc-inventory-price-shadow` connector and
`cdc_shadow_medusa_inventory_price.*` topics. `plan`, `apply` and `verify`
returned success; the revised `verify` checked actual primary keys of all 16
source tables. Initial snapshot mode was `initial`, not `no_data`.

## Capture and projection results

`verify-inventory-price-snapshot.py` returned `PASS_CAPTURE_ONLY`: connector
running, snapshot checkpoint complete, usable slot and source row counts equal
to topic end offsets. `verify-inventory-price-projection.py` returned
`PASS_CONTEXT_ONLY`: source keys, selected attributes and soft-delete states
equal to the keyed projection; all topic offsets applied. The source clone was
frozen during the initial comparison.

| Table | Initial source rows | Projection rows |
|---|---:|---:|
| `product_sales_channel` | 104 | 104 |
| `sales_channel` | 2 | 2 |
| `sales_channel_stock_location` | 2 | 2 |
| `stock_location` | 1 | 1 |
| `product_variant_inventory_item` | 20 | 20 |
| `inventory_item` | 20 | 20 |
| `inventory_level` | 20 | 20 |
| `reservation_item` | 0 | 0 |
| `product_variant_price_set` | 120 | 120 |
| `price_set` | 122 | 122 |
| `price` | 146 | 146 |
| `price_list` | 0 | 0 |
| `price_rule` | 2 | 2 |
| `price_list_rule` | 0 | 0 |
| `region` | 1 | 1 |
| `currency` | 126 | 126 |

The transition probe committed three changes in one clone transaction:
`inventory_level.stocked_quantity` update, `inventory_item.deleted_at` soft
delete and deletion of a `product_sales_channel` relation. It returned
`PASS_CONTEXT_ONLY` for the changed source/projection, restored the original
values and relation, then returned `PASS_CONTEXT_ONLY` again. A separate replay
probe stopped only the stage-2 projector, reset its isolated Kafka consumer
group to earliest and read every nonempty topic again. Audit row count stayed
**692 → 692**, projection offsets stayed unchanged and the result was
`PASS_REPLAY`. Initial 686 snapshot rows plus six committed transition rows
explain the 692 audit rows. A later projector rebuild started with one `READY`
line and no topic-metadata error after topic creation was made conditional.
The final post-rebuild projection verifier again returned `PASS_CONTEXT_ONLY`.
All five shadow containers were then stopped with Compose `stop`; the isolated
volumes, slot, topics and private credentials were retained for audit/replay.

These checks are capture/context evidence only. They do **not** establish
Medusa's sellable inventory formula across channel/location/reservations,
price-list/rule evaluation, historical order amount, Dashboard readiness,
production WAL/lag budget, long outage recovery or live cutover. The three
tables empty in this clone (`reservation_item`, `price_list`, `price_list_rule`)
still need nonempty controlled fixtures before their transitions can be
considered covered. Stage-1 catalog, order v2 and live analytical metadata
remain separate work.
