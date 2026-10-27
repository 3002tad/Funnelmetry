# Retractable order-state gate probe — Medusa 2.19.0

Status: **shadow evidence only**. The proposed gate is suitable for further
experimentation as a corrected *current order-state projection*; it is **not
accepted as the existing immutable `order.placed` funnel terminal**. No live
Medusa database, native subscriber, Pipeline canonical writer, or production
topic was changed.

## Candidate and method

For each `order_id`, evaluate the CDC-reconstructed state:

```text
order row exists AND order_cart(order_id, cart_id) exists
AND linked cart.completed_at IS NOT NULL
```

The offline [evaluator](evaluate-order-state-gate.py) replays only the shadow
`order`, `order_cart`, and `cart` CDC topics, sorts records by PostgreSQL LSN,
and emits `ON`/`OFF` transitions when the predicate changes. It compares the
final result to a read-only shadow DB query (including `order.deleted_at`) and
to the count of native `medusa.order_placed` records in the private shadow
Source Event Feed. It prints synthetic IDs and metadata, never raw CDC payloads,
credentials, or customer fields. The tested CDC records all have
`snapshot=false`; cloned historical rows are not counted as conversions.

The seven order IDs below come from prior success, payment-authorization
failure, retry, repeat-completion and lost-WAL-marker probes. This evaluation
replayed those already captured events rather than generating another order.

| Shadow cases | CDC gate transitions | Final gate vs DB | Native event |
|---|---|---|---|
| Five successful orders, including retry of a failed cart and the order whose experimental WAL message was lost | One `ON` per order, no duplicate `ON` on repeated complete | `true` vs `true` for all five | One per order |
| Failed order `order_01M5Y2H6EY41R9ZH0BW47ATJSX` | `ON` at LSN 33936512, then `OFF` at LSN 33956536 | `false` vs `false` | Zero |
| Failed order `order_01M5Y8GQFZZQ5A8RD23QSWQS93` | `ON` at LSN 34340120, then `OFF` at LSN 34368216 | `false` vs `false` | Zero |

The two false-positive intervals were **94 ms** and **69 ms**, calculated from
the CDC `source.ts_ms` values on the `ON` and `OFF` records. These are source
record timestamp differences, **not** measured UI-visible duration or a safe
grace period. Both `ON` transitions were triggered by the cart completion
update; compensation later reset the cart and deleted the temporary order.
After retry, the old failed `order_cart` link survived while that same cart
became completed for a **new** order. Keying by order ID and checking the order
row kept the old failed order's final gate `OFF`.

## Acceptance assessment

- **Observed:** a retractable state projection converged to the shadow DB's
  final predicate for all seven sampled orders. Final counts happened to equal
  the native event counts in this sample. This is useful evidence for a
  corrected current-state analytical asset, keyed and deduplicated by order ID.
- **Rejected for current `order.placed`:** the two failed checkouts prove the
  gate can be `ON` when native placement never occurs. An immutable funnel
  conversion would be false for that interval. A fixed delay cannot establish
  a source-owned success acknowledgement; the Medusa workflow may fail or
  compensate later. The gate's `ON` time is also earlier than the native event
  release, so it cannot silently replace the existing event-time contract.
- **Open before accepting a new corrected-state funnel profile:** publish and
  test `order.deleted_at` (absent at the time of this seven-order replay; added
  and tested later in the [soft-delete follow-up](ORDER_STATE_SOFT_DELETE_PROBE_2026-10-27.md)); define
  how to apply cross-topic transactions/LSN and a replay watermark; prove
  soft-delete, late compensation, restart/replay, snapshot/backfill and repeated
  update behavior; define amount/currency and time basis and retraction of
  historical funnel aggregates; decide explicit versioned metric/profile names
  and quality state. No grace duration or finality horizon is approved here.

The subsequent [reference contract verifier](REFERENCE_ORDER_RECORDED_STATE_CONTRACT_V1.md)
tested transaction-END ordering, duplicate input and replay for nine shadow
orders. Those later checks do not make this seven-order result a live cutover.

This experiment supports a **candidate**, not a product decision or cutover.
The current canonical `order.placed` remains sourced from Medusa's native event
until a new semantic contract is approved or a durable CDC placement marker is
proved. See [the verification-point audit](ORDER_CDC_VERIFICATION_POINT_AUDIT_2026-10-27.md)
for the workflow ordering and absence of a PostgreSQL post-release marker.
