# Order v2 journey read path candidate — 2026-10-29

**Scope:** `SHADOW_ONLY` development under DEC-119/135. This is a new read path over the governed order-v2 sink and the existing Pipeline journey store. It does not publish a Funnel Profile, emit canonical events, activate a terminal, replace `order.placed`, or cut over the Medusa backend adapter.

`workers/reference-order-cdc-v2-sink/src/shadow-read-path.js` requires an explicit mapping from the CDC `source_instance_id` to the Pipeline `source_id`, an exact `coverage_epoch_id` and `order_id`. It reads only `reference_cdc_v2_order_current_state_readable` while the current-state quality lease is valid. A snapshot `BASELINE` can contribute to the current-state count but cannot become a new funnel terminal. A candidate requires a post-baseline ON `TRANSITION` in the same fact topic and partition, matching current cart, a strong `CART` journey entity for the declared Pipeline source and a `checkout.started` event for that cart. A missing observed-state time, a changed cart, missing checkout evidence or weak journey link remains unverified. An OFF after ON is exposed as `RETRACTED_SHADOW` rather than counted as an immutable conversion.

The order and journey stores may be separate PostgreSQL databases. The reader uses a repeatable-read snapshot for the order side and one statement for the journey/cart evidence, then rechecks the quality lease and exact order revision on a fresh order query. Its `BOUND_SHADOW` result remains an observation, **not** a cross-database transactional snapshot or official funnel metric. A later quality failure must block downstream use; readers cannot retain a result past `quality_valid_until`. Historical WAL gaps remain `INCOMPLETE`.

**Target correlation correction, 2026-10-30:** Existing canonical
`checkout.started` evidence in the VPS stores `relations.correlation_id =
cart:<cart_id>` and has no `relations.cart_id`, as specified by the Medusa
identity contract. The candidate SQL previously required only `cart_id` and
could not match that event. It now accepts either exact cart key or exact
`cart:<cart_id>` correlation while rejecting records where both keys exist
and disagree. `PREPARE`/`EXECUTE` of the revised SQL against the live Pipeline
DB returned the one strong CART journey and its checkout event for baseline
cart `cart_01M5XVYEXZ1VF38ZP485CQAQRC`. That order remains a snapshot
baseline and cannot create an ON terminal. The two post-baseline Store API
test orders lack behavioral checkout evidence; neither may be labeled a
bound funnel conversion. A real browser-to-order target rehearsal and a
versioned funnel/profile activation remain open.

**Verification:** package test suite 9/9 PASS. The exact order-state SQL was prepared successfully against the preserved CDC-10 order-v2 chain PostgreSQL clone; only that clone DB was started for the check and it was stopped afterwards, retaining its volume. The exact cart–journey SQL was prepared successfully against the current Pipeline PostgreSQL schema using `PREPARE`/`DEALLOCATE`, without reading business rows or changing data. This proves SQL/schema compatibility, not real cart–journey conformance or a live read-path result.

**Remaining:** execute a fresh target-topology order-v2 epoch with usable slot and valid quality lease; test post-activation checkout ON, OFF and cart correction against Browser SDK journey evidence; define a versioned reference profile/time policy and correction propagation; measure quality/lag/WAL; obtain a separate CDC-12 authority decision and rehearse rollback. The old native `order.placed` analytical path remains authoritative until then.
