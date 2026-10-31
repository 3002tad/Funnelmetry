# CDC catalog/master-data shadow: initial snapshot and stream (2026-10-28)

## Boundary and profile

This is a **new, shadow-only** profile, `reference.medusa.catalog_master_data.v1`.
It does not extend or reinterpret `reference.medusa.order_recorded_state.v1`.
The Medusa integration manifest generates `funnelmetry/cdc-catalog-shadow.json`;
the operator installer uses a distinct PostgreSQL role, column-filtered
publication, replication slot, Debezium connector, topic prefix and projector
database. No service has a published port. Live Medusa stayed at
`wal_level=replica` with zero replication slots; its native order subscriber,
live Dashboard and `catalog-sync` were not changed.

The exact initial scope is:

| Table | Captured columns | Projection key |
|---|---|---|
| `product` | `id,title,handle,status,collection_id,updated_at,deleted_at` | `source_id × product_id` |
| `product_variant` | `id,product_id,title,sku,manage_inventory,allow_backorder,updated_at,deleted_at` | `source_id × variant_id` |
| `product_category` | `id,name,parent_category_id,is_active,is_internal,updated_at,deleted_at` | `source_id × category_id` |
| `product_category_product` | `product_id,product_category_id` | `source_id × product_id × category_id` |

The connector uses `snapshot.mode=initial`, not `no_data`, and an explicit
`column.include.list` matching its publication and SELECT grants. Debezium
performs an initial consistent snapshot before continuing from the WAL. Adding
other tables later requires a **new versioned allowlist and a deliberate
snapshot/backfill decision**; it must not mutate this profile silently.
See the [Debezium PostgreSQL connector snapshot documentation](https://debezium.io/documentation/reference/stable/connectors/postgresql.html).

## Runtime evidence

Test environment: isolated clone at `/srv/KLTN/cdc-shadow-catalog1`, Compose
project `funnelmetry_cdc_catalog_shadow_catalog1`, on the VPS. `clone-db.py`
copied the existing Medusa database into a private PostgreSQL 15 instance.
The first clone attempt raced PostgreSQL initialization and was retried after
the instance reached its final healthy state. No source dump or row payload was
copied into this repository.

| Gate | Observation |
|---|---|
| Snapshot coverage | 104 products, 120 variants, 4 categories, 4 product-category links; 232 snapshot audit records |
| Source comparison | Descriptive fields, `updated_at`, soft-delete state and relationships matched the clone by canonical digest; no orphan variant or category link |
| Stream after snapshot | Product title update/restore, product soft delete/restore, category link add/remove, variant product relation move/restore all reconciled |
| Replay | Projector consumer offsets reset to earliest and restarted; audit stayed at 240 records, all four projected tables and source digest still matched |
| Installer rollback→apply | Connector was removed then resumed with its retained slot/topics; 240 audit records and four source/projection digests remained aligned, with no duplicated snapshot |
| Offset/health | Four topic end offsets equaled durable projector input offsets; connector/task RUNNING and slot usable at final check |
| Source-to-projection observation | Eight post-snapshot row changes: median 470 ms, p95 682 ms, maximum 688 ms using Debezium `source.ts_ms` and projection `ingested_at` on the same VPS |

The probe's full reconciliation loop took 8–19 seconds per case because it
repeated Docker/SQL/source comparison calls. Those timings are **not CDC lag**.
The timestamp distribution above is a small shadow sample, not an SLO or a
flash-sale benchmark. It does not cover initial snapshot duration at scale,
long outages, table evolution or a production source.

The projector stores one current row per source/entity key, an immutable
input audit and topic/partition offsets in the same PostgreSQL transaction.
The `catalog_product_reference_names_cdc` view excludes soft-deleted products.
It is only a shadow view; no Dashboard read path currently points to it.

## Inventory and pricing boundary

This v1 profile intentionally captures no stock or price rows. A qualified
inventory model needs variant-to-inventory-item, stock location, sales
channel, inventory level and reservation state, together with the variant's
`manage_inventory` and `allow_backorder` settings. One `inventory_level` row
cannot prove that a variant is sellable. A qualified price model needs the
variant-to-price-set link, currency/region, price list activation and rules;
current catalog prices must never rewrite historical order amounts.

The versioned stage-2 design and its candidate column allowlist are in
[CATALOG_CDC_STAGE2_SCOPE.md](CATALOG_CDC_STAGE2_SCOPE.md). Until that scope is
implemented and reconciled, the shadow has **product names/relations only**.

## Dashboard cutover gate

The live API-created `current_product_reference_names` and `catalog-sync`
remain authoritative. A Dashboard change requires a separately approved live
CDC topology, initial snapshot of the live source, complete current-state
coverage, an agreed freshness budget with alerting, stable keyed relations,
source/version provenance, comparison against existing API names, rollback
rehearsal and a Decision Record update under DEC-135. Only then should the
Dashboard binding change; `catalog-sync` can stop **after** the new read path
passes and rollback remains available. This shadow PASS does not satisfy that
live gate.
