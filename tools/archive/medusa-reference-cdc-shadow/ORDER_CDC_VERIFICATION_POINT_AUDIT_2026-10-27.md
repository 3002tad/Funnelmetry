# Medusa 2.19.0 order CDC verification-point audit — 2026-10-27

Status: **no additional immutable PostgreSQL marker verified for native
`order.placed`**. Read-only source/schema inspection and queries were performed
against the isolated shadow clone. No live database or source code was changed.

The installed `complete-cart.js` creates the order, Order↔Cart link and cart
completion before payment authorization. It then calls the `orderCreated` hook
(installed file line 583), releases the cart lock (line 589), and only after
the workflow finishes does the workflow runtime release grouped events to the
Redis event bus. The stored workflow `done` checkpoint precedes that event
release; the release error path can cancel the flow. See
[the original marker probe](MARKER_PROBE_2026-10-27.md).

| Candidate | Shadow/source evidence | Can verify immutable native `order.placed`? |
|---|---|---|
| `order` row, `status=pending`, `version=1` | The successful order has these values, but a failed checkout already committed an order insert before compensation deleted it. | **No.** Insert/status/version are pre-success state. |
| `order_cart` and `order_payment_collection` links | Both still had a row for a compensated synthetic order whose `order` row was absent. | **No.** The links can outlive the failed attempt. |
| `cart.completed_at` | It is set before payment authorization and can be reset on compensation. After retrying the same cart successfully, it is set again even though the failed order's link remains. | **No.** It is shared cart state, not a particular order's success marker. |
| Payment authorization or `order_transaction` | Payment authorization precedes `orderCreated`, lock release and event release; `order_transaction` is created only when captures exist. | **No.** Neither is a universal final order-placement boundary. |
| `order_change` / `order_change_action` | Both tables had zero rows for the successful and compensated checkout cases queried. | **No.** This flow does not provide a creation marker there. |
| `workflow_execution.state=done` | Checkpoint is saved before grouped event release; repeated completion of one cart created another `done` execution but no new native event. | **No.** A single `done` can race with release/compensation, and retries duplicate it. |
| `completeCartWorkflow` `orderCreated` hook | The hook exists after authorization but before lock release and event release. | **Possible write location, not yet a verified final commit point.** A WAL/outbox write here could be followed by failure; no shared business transaction was identified. |
| Native `order.placed` subscriber | It runs after the grouped event is released, but a controlled pre-WAL failure produced a successful order and no marker. Medusa logged that retry was not configured. | **No with current delivery contract.** See [native WAL probe](NATIVE_WAL_MARKER_CONFORMANCE_2026-10-27.md). |

## Composite logic-gate check

The strongest PostgreSQL-only **state gate** found in this shadow sample is
keyed by **order ID**: an `order` row that still exists and is not soft-deleted,
its `order_cart` link, and that linked cart's non-null `completed_at`. Consume
CDC in transaction/LSN order and wait until the related changes have been
applied before evaluating the join. A later order deletion or cart reset must
retract the projection. An old link for a compensated order can survive and the
same cart can later become completed on a successful retry, so neither the link
nor `cart.completed_at` is sufficient without checking the particular order.
This predicate matched the sampled final states, including the successful
order whose experimental WAL marker was lost. It is a **provisional,
correctable order-state observation**, not an `order.placed` event contract.
The [state-gate replay probe](ORDER_STATE_GATE_PROBE_2026-10-27.md) found two
failed checkouts where this gate turned `ON` before compensation turned it
`OFF`, while the native `order.placed` count stayed zero.

Adding payment authorization, `workflow_execution.state=done`, or the
`orderCreated` hook does not turn the state gate into a final placement gate:
authorization and the hook occur before event release; `done` is checkpointed
before release, can appear again on a repeated completed-cart call, and its
published columns do not contain a safe cart/order join key. Joining through
the workflow's opaque `context` would need separate privacy approval and still
would not fix the timing gap. `order_change`/`order_change_action` had no
creation rows in the sampled checkout, and the sampled `notification` table was
empty. A fixed grace delay or an absence of compensation is not a source
acknowledgement; a later correction remains possible.

The installed 2.19.0 runtime makes the boundary explicit:
`TransactionOrchestrator.finalizeTransaction` awaits `saveCheckpoint()` and
then calls synchronous `emit(FINISH)`. `LocalWorkflow.registerEventCallbacks`
invokes the finish handler without awaiting its promise; `LocalWorkflow.run`
returns after `resume` and cleans up listeners. The workflow SDK's asynchronous
finish handler calls `releaseGroupedEvents` and may cancel the flow if release
fails. The Store complete-cart route does not write a PostgreSQL success
acknowledgement after that release. Therefore a CDC consumer can observe all
candidate DB changes and the `done` checkpoint before event release resolves;
no observed PostgreSQL gate proves the native `order.placed` occurrence.

If the product explicitly adopts a corrected current-state conversion metric,
the state gate can be prototyped under a new versioned name/contract with
retractions and quality state. Under the current immutable `order.placed`
contract, the CDC-only mapping remains `UNVERIFIED` / `CONTRACT_CHANGE_REQUIRED`:
a source-owned durable success/replay contract is needed. This check is scoped
to the Medusa 2.19.0 Store complete-cart path; it does not establish semantics
for other order-creation paths or commerce sources.

## What CDC can verify without a new business marker

For the sampled final states, the predicate **non-deleted order row +
Order↔Cart link + completed cart** distinguished the existing orders from a
compensated order. It also found the successful order whose WAL marker was
intentionally lost. This is a useful **retractable current-state projection**
(`order_recorded` or similar), not an immutable occurrence of Medusa's native
`order.placed`: those rows can be committed before a later checkout failure,
and compensation may retract them. The same cart can carry links for both a
failed order and a later successful one, so joining by cart alone is unsafe.
No fixed waiting interval upgrades this predicate to an exact event contract.

If the project chooses a corrected/current-state funnel metric, that requires
an explicit versioned semantic decision, retraction rules and analytical
support; it cannot silently reuse the existing immutable `order.placed` fact.
For exact CDC-only conversion, a source-owned marker must be committed at a
verified success boundary, or a durable native-event retry/replay contract must
be demonstrated. A marker table in an integration-owned schema could avoid
changing Medusa business columns, but writing it in `orderCreated` or a
post-event subscriber does not by itself close the transaction gap. No such
atomic extension point was verified in this audit.

These findings apply to the installed Medusa 2.19.0 `complete-cart` flow. A
different commerce system may expose an explicit `placed_at`/status transition
or transactional outbox. Its CDC source profile must prove that contract with
success, failure, retry and compensation tests before mapping to canonical
`order.placed`.
