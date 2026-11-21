# Journey checkout recovery — 2026-11-19

Plan: apply Backbone §19.2 business-key precedence, DEC-143/144 cart context
boundary, Cookbook journey-identity and event-time-idempotency rules.

The live consumer retries persisted-topic partition 0 offset 708 indefinitely.
The checkout.started event carries data.cart_id but the resolver only considers
its correlation and session keys, which belong to distinct existing journeys.

Implement `checkout-cart-anchor-v1` evidence policy: use the explicit checkout
cart key and retain other explicit business keys for conflict detection. Do not
register session/user/correlation as aliases of that cart journey. Keep canonical
history and existing resolved events unchanged. General ambiguous/contradictory
business-key conflicts remain fail-closed. No offset skip or automatic merge.

Test extraction, conflicting business keys, repository ownership, redelivery and
Kafka transaction handling. Deploy only the journey worker image after checks,
resume its existing consumer offsets, verify backlog drainage and dashboard.
This fixes a known checkout conflict, not a general journey-merge policy. The
ACTIVE funnel definition is immutable; no profile or metric semantics change.

## Result

Deployed only journey-processor to
`funnelmetry-journey@sha256:6ccc500a3d66bd3718b97da4346cf97abe3b62d4c2e939fbf4054f83a9a9359b`.
Swarm update completed and container is healthy. Full service Spec comparison
confirms only Image changed; the running evidence.js checksum matches the patch.
No DB migration, canonical rewrite, Kafka offset reset or journey merge occurred.
Existing unresolved events resumed through normal transactional handoff.

Tests: 16 unit/runtime tests and 2 real PostgreSQL integration tests passed in
the candidate image. The temporary test database was isolated from live networks
and removed after testing. Local full tests initially failed to load dependencies
(kafkajs/pg/canonical-contract); candidate-image tests provide the complete result.
Integration covers both browser/cart arrival orders, duplicate checkout delivery,
unchanged session ownership and continued rejection of contradictory cart keys.

Live acceptance for November 18 UTC: all 287 canonical events now have journey
projections (94 page views, 28 product views, 125 scroll events, 8 searches,
18 cart additions, 3 checkout starts and 11 cart-context events). Previously only
66 were projected. Authenticated dashboard verification shows cohort entrants
increased from 6 to 23; raw overview totals stayed unchanged and no browser
exceptions occurred. Consumer offset advanced from 708 to 1149 (log-end 1150,
reported lag 1 at inspection); do not claim measured Kafka lag zero. A transient
Kafka concurrent-transaction retry during startup recovered; no new journey
identity conflict appeared in the new container's inspected logs.

## Remaining analytical limitation

Current-state funnel still reports 23 → 0 → 0 → 0. Browser product-view journeys
and CDC cart journeys remain distinct, as required by the existing no-blind-merge
policy. The existing ACTIVE query requires every stage to share journey_id.
Recovering processing therefore does not establish a full browser-to-cart funnel.
Using context.cart_linked as a cross-journey analytical bridge needs an explicit
versioned cohort/linkage contract with ambiguity and arrival-order tests, not a
silent change to the immutable ACTIVE profile or forced session-based merge.
This repair resolves the stalled consumer; it does not certify end-to-end funnel
linkage completeness or order conversion.

Rollback provenance: `/srv/KLTN/journey-recovery-20261119/before.json`,
`after.json`, `verification.json`, `target-image.txt`, payload and build log.
Old image is `ghcr.io/3002tad/funnelmetry-cdc-workers@sha256:e8cb858342c339b97ab6bbf67973e13c63f343d8ff751cd7116dbd1cb69f2201`.
Rollback with a targeted service image update only; resolved projections persist
and are idempotent. The image is local to the current VPS node; no registry push
or launcher env update was performed. Source changes remain uncommitted.
