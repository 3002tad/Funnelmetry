# CDC `order.placed` marker probe — Medusa 2.19.0

**Time:** 2026-10-27 08:43–08:51 UTC. **Environment:** isolated Compose
`funnelmetry_cdc_shadow` on VPS `kltn`. **Decision:** no existing captured
PostgreSQL transition is approved as a standalone, immutable equivalent of
native `order.placed`. `workflow_execution.state=done` is the closest observed
post-authorization candidate, but **rejected as a standalone conversion marker**.
The native subscriber remains the authority for `medusa.order_placed`.

## Probe setup

`configure-workflow-marker-probe.py` created a second publication and Debezium
connector **only in the cloned PostgreSQL**:

- Publication/slot: `funnelmetry_workflow_shadow`; topic:
  `cdc_shadow_workflow.public.workflow_execution`; connector:
  `medusa-workflow-shadow`; `snapshot.mode=no_data`.
- Published columns: `id`, `workflow_id`, `transaction_id`, `run_id`, `state`,
  `created_at`, `updated_at`. The `context` and `execution` JSON, which may
  contain customer data, are **not published**. Correlation for this probe was
  performed by querying the clone locally with known synthetic IDs; no raw
  context was printed or sent to Kafka.
- Both CDC connectors and tasks reported `RUNNING`. The shadow PostgreSQL has
  two active logical replication slots; the live PostgreSQL remains
  `wal_level=replica` with zero slots and zero shadow publications.

## Observed transitions

| Synthetic case | Order CDC | Workflow CDC by execution row | Native `medusa.order_placed` |
|---|---|---|---|
| Success, cart `cart_01M5Y8FK6QQC46MVZNKZEJT9VX` | Order `order_01M5Y8FMP704PQ0XVH1DKBN0KP` create LSN **34249576**; link LSN **34276736**; cart completion LSN **34283768** | `not_started` LSN 34227952 → `done` LSN **34319544** | **1** event, same order/cart, 15.51 EUR |
| Payment authorization fails after order creation, cart `cart_01M5Y8GFX9WB1MQYXWGAN3VN05` | Temporary order `order_01M5Y8GQFZZQ5A8RD23QSWQS93` create LSN **34334464**, delete LSN **34369768**; old `order_cart` row remains but order is absent | `not_started` LSN 34331336 → `waiting_to_compensate` LSN **34365776** → `reverted` LSN **34388760**; no `done` | **0** events for temporary order |
| Retry same cart after restoring synthetic payment session | New order `order_01M5Y8HVNR35925P33F2ZVJTQ8` create LSN **34397864**; link LSN **34402208**; cart completion LSN **34403608** | New execution `not_started` LSN 34394760 → `done` LSN **34437248** | **1** event for new order, 15.51 EUR |
| Repeat complete call on already completed cart | Store API returned the *same* successful order ID; no new order create | **Another** execution `not_started` LSN 34442856 → `done` LSN **34455968** | Still **1** event for that order |

LSNs are from the same isolated PostgreSQL WAL. The two connectors have
independent offsets but share that WAL. This short run validates the observed
order of these commits, not all possible failure schedules.

## Why `done` is insufficient

The installed Medusa 2.19.0 code makes the ordering explicit:

1. `@medusajs/orchestration/dist/transaction/transaction-orchestrator.js`
   `finalizeTransaction` saves a workflow checkpoint **before** emitting the
   `FINISH` signal (installed file around lines 681–691).
2. `@medusajs/workflows-sdk/dist/helper/workflow-export.js` handles `FINISH`
   by calling `releaseGroupedEvents`. If release fails, it calls
   `flow.cancel(transaction)` (installed file around lines 251–289).
3. `emitEventStep` documents that the grouped event is emitted only after the
   workflow finishes successfully; failure clears it. This reference uses the
   Redis event bus, not a PostgreSQL event table.

Therefore a committed `done` CDC record can precede the event release, and
the code has a cancellation path after that checkpoint. This is a **source-code
counterexample to a guarantee**, even though the controlled payment-failure
case reached `reverted` without passing through `done`. No bounded delay after
`done` turns it into a durable business-event contract.

There are additional binding problems: a repeated successful call creates a
second `done` execution for the same order; `workflow_execution` has a
259,200-second retention setting in this runtime; and the workflow row's
`context` contains order/cart IDs but is too broad to publish as raw CDC.
Joining by cart alone is unsafe because a failed attempt leaves an
`order_cart` row for an order that no longer exists.

## Result and next source contract

- **Approved from this probe:** use CDC workflow state for diagnostics/current
  state research, with versioned Medusa-specific mapping and privacy controls.
- **Rejected:** emit canonical `order.placed` directly on `order INSERT`,
  `order_cart`, `cart.completed_at`, or `workflow_execution.done`.
- **Required for CDC-only conversion:** a source-owned durable post-success
  marker with stable `event_id`, `order_id`, `cart_id`, amount/currency/time and
  idempotency. Its write and failure/compensation semantics must be established
  at an actual Medusa extension point and packaged by the installer. A marker
  written by a native-event subscriber can avoid network forwarding from Medusa
  but remains an application hook; it is **not** a transactional outbox with the
  original order insert. A true transactional outbox would need an atomic final
  business transition, which this multi-transaction workflow has not exposed.
- Until that contract is designed and tested, keep the existing native
  `order.placed` subscriber authoritative and use CDC for entity-state data.

No live Medusa source, database setting, publication, slot, subscriber or
Pipeline canonical writer was changed by this probe.
