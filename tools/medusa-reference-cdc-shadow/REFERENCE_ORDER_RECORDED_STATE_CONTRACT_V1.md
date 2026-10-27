# Medusa CDC reference order-state contract v1 — approved reference semantic

**Status:** **APPROVED REFERENCE SEMANTIC CONTRACT** by DEC-119/135 on
2026-10-27, with conformance evidence from the isolated shadow experiment.
The [normative contract](../../../System_Backbone/docs/governance/REFERENCE_MEDUSA_ORDER_RECORDED_STATE_V1.md)
governs the reference meaning. The runtime remains `SHADOW_ONLY`: this is not
a live canonical event, active Funnel Profile, or adapter cutover. It differs
from `medusa.order_placed → order.placed` and requires separate activation.

## Purpose and coverage

`reference.medusa.order_recorded_state.v1` answers: **which post-activation
Medusa orders currently satisfy the recorded-state predicate?** It supports a
count-only reference demonstration of the Pipeline's CDC acquisition,
transaction assembly, correction, and deterministic replay. It does not claim
the exact native placement moment, an ever-placed historical count, payment,
capture, or revenue. A source-specific profile must not be presented as a
universal e-commerce mapping.

The tested connector uses `snapshot.mode=no_data`. V1 therefore covers only
orders whose relevant `order`, `order_cart`, and `cart` changes are all available
after its CDC start boundary. Historical orders and partially observed
pre-existing carts are **outside coverage**; a snapshot cannot be relabeled as
a new conversion. No amount/currency measure is part of this count-only v1.

## State and change contract

| Field / rule | Reference v1 definition |
|---|---|
| Identity / grain | One state per configured `source_instance_id` + `order_id`; `cart_id` comes from the `order_cart` link. The shadow source lineage is `cdc_shadow_medusa` / `medusa`; a live source instance ID must be configured explicitly. |
| `active` | `true` iff a non-deleted `order` row exists with `deleted_at IS NULL`, a matching `order_cart` link exists, and that linked cart has non-null `completed_at`. Otherwise `false`. `order.status=pending` is not a success marker. |
| Input | Allowlisted CDC columns from `public."order"` (`id`, `deleted_at`), `public.order_cart` (`id`, `order_id`, `cart_id`), and `public.cart` (`id`, `completed_at`). Publication may carry other columns for separate use, but they do not change this predicate. |
| Revision | Process the three row topics in Debezium transaction `END` topic order. Buffer each transaction until `END.data_collections` counts for all subscribed tables are present; within that transaction use `transaction.total_order`. Apply state and checkpoint only across a complete ordered prefix. |
| Raw dedup | Scope the record identity to the source/slot lineage, table, `source.txId`, `source.lsn`, and `transaction.total_order`. The shadow verifier rejects conflicting row content for the same identity. Do not use arrival order or `order_id` alone to deduplicate raw changes. |
| Fact changes | Emit an `ON` upsert only on `false→true`; emit an `OFF` correction only on `true→false`. Repeated source records, repeated completed-cart calls, and replay must not add another transition. Preserve source revision and correction provenance. |
| Time | The `ON` revision's CDC source/transaction timestamp is only an **observed state-entry time**, not the time Medusa emitted `order.placed`. No fixed grace/finality horizon is asserted. Later `OFF` can revise counts for earlier windows. |
| Quality / presentation | Label as reference, approximate, post-activation coverage and correctable current state. Missing table rows, transaction `END`, or incomplete counts leave the projection incomplete; do not publish an authoritative zero or fabricate a missing order. |

The working short name `order_recorded` is potentially ambiguous. UI and
metadata should say **“đơn hiện được ghi nhận (tham chiếu)”** or an equivalent
current-state label. Do not map this fact to canonical `order.placed`, reuse the
current Commerce Conversion Funnel Profile, or aggregate it as paid revenue.
Cancellation that leaves these three DB inputs unchanged also leaves this
predicate `active=true`; cancellation requires its own source contract.

## Shadow conformance result — 2026-10-27

The reproducible [verifier](verify-order-reference-contract.py) read three
allowlisted row topics plus Debezium's transaction topic from the private
shadow Kafka. It compared state against a read-only PostgreSQL predicate and
printed only synthetic order IDs, counts and a digest. It ran on **nine**
synthetic orders: successful checkout, two authorization failures and their
retries, repeat completion, a successful order whose experimental WAL marker
was lost, one soft-deleted order, and one new checkout after restarting the
shadow Debezium connector.

| Check | Result |
|---|---|
| Complete transaction assembly | 83 `END` transactions; 82 unique row changes; observed row counts matched the `END` per-table counts. |
| ON/OFF and final DB | 12 state transitions; final state matched the shadow DB for **9/9 orders**. Two failed orders turned ON then OFF; the soft-deleted order turned ON then OFF; six orders remained ON. |
| Duplicate delivery | Duplicating all 82 row changes produced the same gates and transitions; 82 duplicates were ignored. |
| Full replay and serialized checkpoint resume | Same state and transition sequence; replay over the completed checkpoint emitted no new transitions. |
| Cross-topic arrival order | Supplying all transaction `END` records before row data, then supplying row data in reverse order, produced the same result. Withholding one row blocked the ordered prefix; supplying it later restored the same result. |
| Connector restart | Only the shadow Connect service was restarted; connector and task returned to `RUNNING`. A subsequent private Store API checkout appeared in CDC and the final 9-order run. |
| Repeatability | Two separate verifier processes produced the same result digest: `cfbd982c973822db` (first 16 hex characters of SHA-256 over selected gates and transitions). |

The proof is **finite and shadow-scoped**. The verifier implements transaction
assembly in memory and serializes a test checkpoint; it is not a deployed
durable Pipeline mapper. It does not test Kafka retention expiry, WAL slot
exhaustion, transaction-ID wrap, a production consumer crash during output and
checkpoint commit, historical snapshot/bootstrap, sustained load, or source
owned order cancellation/deletion workflows. The soft-delete probe used a
guarded direct SQL update only on the clone, not a Medusa API operation.

## Decision boundary

The subsequent [durable shadow mapper runtime](REFERENCE_MAPPER_RUNTIME_EVIDENCE_2026-10-27.md)
implements this candidate in an isolated PostgreSQL inbox/projection/outbox
and a Kafka consumer. It passed one-time crash after inbox, compensation,
soft-delete, full input replay, and reconciliation against the clone. This
upgrades the evidence beyond the in-memory harness above, but not the contract
status: the fact remains count-only, approximate, post-activation, and
retractable. Kafka output is at least once and requires `fact_change_id`
deduplication downstream.

The [separate analytical sink](REFERENCE_ANALYTICS_RUNTIME_EVIDENCE_2026-10-27.md)
now materializes that deduplicated current state and records a shadow-only
physical binding and metric definition. It does not publish a live Semantic
Metadata catalog release or change the existing Funnel Profile.

DEC-119/135 now approve the **distinct reference state meaning**, metric
`metric.reference_currently_recorded_order_count@1.0.0`, and development ID
`reference-commerce-current-state@1.0.0`. That profile is not active; the
shadow metadata remains shadow-only. Before any reference runtime cutover,
prove journey/cart/order binding, correction propagation, physical metadata
binding, quality and time policy, no double counting, and rollback/rebuild
from CDC lineage; obtain a separate activation/cutover decision. This
evidence is still insufficient to remove the live Backend Adapter. Native
`order.placed` remains the authoritative live conversion.

Evidence: [initial ON/OFF replay](ORDER_STATE_GATE_PROBE_2026-10-27.md),
[soft-delete probe](ORDER_STATE_SOFT_DELETE_PROBE_2026-10-27.md), and
[verification-point audit](ORDER_CDC_VERIFICATION_POINT_AUDIT_2026-10-27.md).
