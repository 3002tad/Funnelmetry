# Order-state CDC soft-delete probe — Medusa 2.19.0

Status: **isolated shadow transport/semantic probe**, not a live CDC cutover or
an approved funnel contract. The Medusa and Pipeline live databases, source
subscriber, and production topics were not changed.

## Setup and controlled operation

`configure-order-state-gate-publication.py` added only `deleted_at` to the
`public."order"` column allowlist of the **shadow**
`funnelmetry_cdc_shadow` PostgreSQL publication. The other five published
tables and their columns were unchanged. PostgreSQL reported the final order
allowlist as `id,status,currency_code,created_at,updated_at,deleted_at`;
Debezium connector and task remained `RUNNING`.

A fresh synthetic checkout through the private shadow Store API created:

- cart `cart_01M5YKJ2KGJ2ETAZD4P53W8M3T`;
- order `order_01M5YKJ4G4XXA8FVK6V2RX2R0F`;
- exactly one native `medusa.order_placed` in the private shadow feed.

Before deletion, `evaluate-order-state-gate.py` reported gate `ON` at LSN
**35574352**, final CDC gate `true`, and shadow DB predicate `true`. A guarded
SQL statement then set `deleted_at` and `updated_at` on **that one synthetic
order in the cloned DB**. This direct mutation was chosen to isolate CDC
transport and the gate's reaction to a soft-delete update. It is **not** a
Medusa-supported order-deletion workflow and does not prove how a production
source would initiate deletion.

After deletion, CDC emitted `order:u`. The evaluator reported gate `OFF` at
LSN **35639776**; its final state and the shadow DB predicate both became
`false`. The native `medusa.order_placed` count remained **one**, as expected
for an order that had previously been placed. Replaying a prior compensated
order and its successful retry after the publication change still produced
`ON→OFF` and `ON` respectively, with final CDC/DB agreement.

## Meaning of a new state fact

The candidate can be materialized as an **order-keyed, retractable current
state**: `eligible=true` while a non-deleted order row, its Order↔Cart link,
and the completed cart coexist; `eligible=false` when compensation, deletion,
or another observed transition breaks the predicate. `order_recorded` is only
a working label. A more explicit label such as `order_currently_recorded` or
`order_state.currently_recorded` would avoid implying an immutable placement
event. `ON`/`OFF` transitions, source LSN, and correction provenance must be
retained for traceability; one order ID is one state identity.

This fact answers **which orders satisfy the current recorded-state predicate**.
It does not answer **which orders were ever placed**: the soft-deleted order
still has a genuine native `order.placed` occurrence. Using the current-state
fact as a historical funnel terminal would remove that earlier conversion.
The prior payment-failure probe also showed two temporary `ON` states that
were later retracted without any placement event. Thus this soft-delete test
strengthens the case for a separate corrected-state asset, while rejecting a
silent replacement of canonical `order.placed`.

## Remaining acceptance gates

- Test source-owned soft-delete/cancel workflows, if any, rather than inferring
  their business meaning from this direct SQL update.
- Define the state fact's grain, temporal validity, retraction reason, amount
  and currency rules, snapshot/bootstrap behavior, duplicate/replay handling,
  and cross-topic transaction ordering.
- Decide whether analytics need a *current eligible order count* or an *ever
  placed order count*. The latter still needs a durable placement contract;
  this predicate cannot supply it.
- Do not change the approved funnel profile, canonical mapping, adapter, or
  live CDC settings based on this shadow-only result.

See [the initial seven-order gate replay](ORDER_STATE_GATE_PROBE_2026-10-27.md)
and [the verification-point audit](ORDER_CDC_VERIFICATION_POINT_AUDIT_2026-10-27.md).
