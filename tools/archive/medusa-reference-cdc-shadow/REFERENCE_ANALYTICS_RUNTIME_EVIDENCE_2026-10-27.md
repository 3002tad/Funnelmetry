# CDC reference analytical sink and metadata — shadow evidence (2026-10-27)

**Status:** isolated analytical prototype under DEC-135/136. It is not a live
Pipeline catalog release, Funnel Profile, canonical conversion, or authority
for placed/paid/revenue metrics. The Medusa clone and both new PostgreSQL
volumes are in the private `funnelmetry_cdc_shadow` Docker network, with no
published ports.

## Asset and physical binding

The independent `reference-analytics-sink` consumes only
`cdc_shadow_reference.order_recorded_state.v1` and persists each distinct
`fact_change_id` into `reference_fact_changes`. In the same PostgreSQL
transaction it upserts `reference_order_current_state` at the grain
`source_instance_id × order_id` and persists its Kafka offset. A Kafka input
offset is committed only after the DB commit. A duplicate physical delivery
with identical `fact_change_id` and payload is acknowledged without changing
state; a conflicting payload or invalid ON/OFF sequence fails closed.

The [versioned shadow metadata](reference-analytics/metadata.json) names the
physical table, key columns, types, source authority, quality limits and the
single supported metric:

`metric.reference_currently_recorded_order_count = COUNT(*) WHERE active=true`,
grouped by `source_instance_id`. The sink checks required physical columns
before registering this metadata in `reference_semantic_catalog` PostgreSQL.
Changing a registered definition requires a version bump. The status is
`SHADOW_ONLY`, and `pipeline_catalog_published=false`.

This metric means **“đơn hiện được ghi nhận (tham chiếu)”**. It is a correctable
current-state count with post-activation coverage, not a time-windowed count
of orders ever placed. The observed CDC timestamp is not the native placement
time. The asset has no amount/currency, payment, revenue, historical funnel,
or customer claim. A current-state claim also requires mapper/sink lag checks;
this prototype exposes no API or UI and is not wired to live analytical tools.

## Runtime conformance

The sink first consumed the existing 26 reference fact changes and produced
20 current-state rows, 14 active. A new synthetic Store API checkout created
`order_01M5YQJZH1D09D1FY0185YCD2D` and one ON; a guarded SQL soft delete
of that order **only in the cloned Medusa DB** produced one OFF. The order's
analytical transition history was `[true,false]`, and current count returned
to 14. The SQL deletion is a transport probe, not evidence of a source-owned
Medusa cancellation/deletion workflow.

A temporary Kafka consumer group replayed all 28 logical fact changes against
the existing analytical DB. The table remained at 28 unique facts, 21 order
states and 14 active rows. The original consumer group was restored. An
opt-in [duplicate probe](probe-reference-fact-duplicate.py) then published one
exact copy of a shadow fact: Kafka topic end offset moved from 28 to 29,
while the sink still held 28 unique facts and 14 active orders.

The [read-only analytical verifier](verify-reference-analytics.py) returned
`PASS`: mapper and sink agree on all 21 order states and all 28 distinct
payloads; metadata v1.0.0 remains shadow-only; sink next offset equals Kafka
end offset 29. The [mapper verifier](verify-reference-mapper.py) also returned
`PASS`: zero state mismatches with the Medusa clone, zero pending END/outbox,
29 Kafka records containing 28 unique fact IDs and one duplicate delivery.

Remaining gates: bootstrap/history, output-to-sink latency and lag policy,
Kafka retention expiry, Kafka/DB outage recovery, multi-partition ordering,
schema evolution, source-owned cancellation, load/WAL budget, and separate
runtime/profile activation before any live analytical asset or funnel uses
this state fact. The native Backend Adapter remains live authority for
`order.placed`.

Governance update 2026-10-27: DEC-119/135 approved the distinct reference
semantic contract, metric and profile development ID in
[Backbone](../../../System_Backbone/docs/governance/REFERENCE_MEDUSA_ORDER_RECORDED_STATE_V1.md).
This did not publish the shadow metadata or activate a live Funnel Profile.
