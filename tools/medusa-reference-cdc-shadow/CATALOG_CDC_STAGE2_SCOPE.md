# Catalog CDC stage 2: inventory and price context (candidate)

Status: **shadow installer candidate, not an activated analytical asset**. Stage 1 already
uses `reference.medusa.catalog_master_data.v1` for product/variant/category.
Stage 2 now has a separate generated profile and operator-side installer with
exact source grants and publication for an isolated clone. Privacy review,
snapshot/stream runtime evidence, projection, reconciliation and live decision
are still required. It cannot be added to
`reference.medusa.order_recorded_state.v1` or to catalog v1 by editing an
existing connector in place. Schema inventory below was checked against the
isolated Medusa 2.19.0 clone on 2026-10-29 with
`stage2-schema-inventory.sql`. Several proposed `deleted_at` fields did not
exist; this corrected allowlist applies to the inspected clone.

## Candidate allowlist

Capture only these columns if the corresponding analytical question requires
them. All tables also require verified PK, update/delete and soft-delete
semantics before activation.

| Table | Candidate columns | Relationship / purpose |
|---|---|---|
| `product_sales_channel` | `id,product_id,sales_channel_id` | Product visibility in channel; PK `(product_id,sales_channel_id)` |
| `sales_channel` | `id,name,is_disabled` | Channel state |
| `sales_channel_stock_location` | `id,sales_channel_id,stock_location_id` | Channel-to-location eligibility; PK `(sales_channel_id,stock_location_id)` |
| `stock_location` | `id,name` | Stock location |
| `product_variant_inventory_item` | `id,variant_id,inventory_item_id,required_quantity` | Quantity required per variant; PK `(variant_id,inventory_item_id)` |
| `inventory_item` | `id,sku,requires_shipping,deleted_at` | Inventory identity |
| `inventory_level` | `id,inventory_item_id,location_id,stocked_quantity,reserved_quantity,incoming_quantity` | Per-location stock observations |
| `reservation_item` | `id,inventory_item_id,location_id,quantity,allow_backorder` | Reservation changes and reconciliation |
| `product_variant_price_set` | `id,variant_id,price_set_id` | Variant-to-price-set relation; PK `(variant_id,price_set_id)` |
| `price_set` | `id` | Price-set identity |
| `price` | `id,price_set_id,currency_code,amount,price_list_id,min_quantity,max_quantity,rules_count,deleted_at` | Current price candidates, not historical order price |
| `price_list` | `id,status,starts_at,ends_at,type,rules_count,deleted_at` | Promotion/price-list applicability |
| `price_rule` | `id,price_id,attribute,operator,value,priority` | Candidate rule condition |
| `price_list_rule` | `id,price_list_id,attribute,value` | List-level rule condition; `value` is JSONB |
| `region` | `id,currency_code` | Region currency context |
| `currency` | `code,decimal_digits,deleted_at` | Currency reference, no conversion rate |

For relationship tables, retain source `id` as an attribute where present but
use the actual composite PostgreSQL primary key for
`product_sales_channel`, `sales_channel_stock_location`,
`product_variant_inventory_item` and `product_variant_price_set`. Store the
referenced IDs separately. A delete/soft-delete removes the
relation from active views without changing historical order facts. Use a
source/table/key namespace, source LSN, snapshot epoch, Kafka topic/partition
offset and source update time for traceability. Keep raw attributes that may
contain sensitive data (`metadata`, customer/order description, addresses,
raw JSON amount buffers) outside this candidate allowlist.

Only `inventory_item`, `price`, `price_list` and `currency` in this candidate
have `deleted_at` on the inspected clone. Other tables require hard-delete CDC
handling and tombstone-safe keyed projection. Revalidate this before installing
against another source version.

## Projection rules

1. Snapshot existing rows before accepting the stream. A separate new
   connector may use `initial`; adding tables to a running connector needs
   Debezium incremental snapshot signaling and a recorded coverage epoch.
   Never use `no_data` for already populated catalog tables.
2. Store `product`, `variant`, `category` and their links from stage 1 first.
   Materialize inventory and price relations only when every required table
   has snapshot completion and stream offsets caught up; otherwise mark the
   analytical capability `INCOMPLETE`.
3. Inventory can be reported per `variant × sales_channel × location` only
   after checking product-channel eligibility, channel-location mapping,
   variant management/backorder flags, required inventory items, level
   quantities, and reservations. Do not publish `available_to_sell` until
   Medusa's reservation/stock formula and update ordering are verified with
   API/DB cases, including multiple items and locations.
4. Price rows are **candidates** keyed by variant, currency and price-set
   context. Applying price lists, time windows, region/currency and rules is
   a separate tested resolver. Do not label a raw amount as the storefront
   display price or use a current catalog row to restate historical order
   revenue. Historical money remains from the order's point-in-time facts.
5. Reconcile each source table and relationship count/hash, plus cross-table
   orphans, snapshot epoch and topic offsets. Test inserts, updates,
   soft/hard deletes, relation changes, replay, restart, lag and outage.
   Only a PASS over the full required dependency graph may activate an
   analytical inventory or price asset.

This scope is deliberately separate from the v1 product-name shadow evidence.
The generated profile and installer are shadow-only; live source grants and
analytical claims still need source-owner approval and runtime conformance.
