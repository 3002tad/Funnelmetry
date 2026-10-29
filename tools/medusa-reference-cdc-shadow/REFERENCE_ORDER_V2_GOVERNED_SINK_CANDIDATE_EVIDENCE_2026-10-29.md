# Reference order-state v2 governed sink candidate — 2026-10-29

**Result:** `PASS_SHADOW_SINK` and `PASS_REPLAY` on the isolated CDC-10 clone. No live Funnel Profile, canonical `order.placed` mapping, Backend Adapter or Pipeline service was changed.

## Candidate boundary

Migration `infra/postgres/v2/023_reference_order_cdc_v2_candidate.sql` creates a separate v2 inbox, current-state table, fact-topic offset, quality state and guarded read view in the Pipeline PostgreSQL schema. The configurable `workers/reference-order-cdc-v2-sink` retains the proven CDC-10 fact validation and BASELINE/STATE/TRANSITION/CORRECTION ordering. It requires explicit `SHADOW_ONLY` mode, source ID, coverage epoch, fact topic and a distinct Kafka group. Records and next offset commit in one DB transaction. New source transitions invalidate readiness; the read view stays empty unless a separate verifier supplies a fresh quality lease. The migration does not insert Semantic Metadata or bind a funnel terminal.

## Isolated run

On `ssh kltn`, project `funnelmetry_cdc_shadow_cdc10` under `/srv/KLTN/cdc-shadow`, migration 023 was applied only to private `recovery-analytics-db`. The new sink used a separate group `cdc-shadow-governed-reference-v2-epoch2` and its own tables against the existing `cdc_shadow_reference.order_recorded_state.v2` topic. Topic end, old sink and new sink all reached offset **712**. Both inboxes contained 105 `BASELINE`, 1 `BASELINE_COMPLETE`, 303 `STATE` and 303 `TRANSITION` records. Both current-state tables had **408** identical order/cart/active rows. New baseline completion was recorded; guarded view returned **0** rows with quality `BLOCKED_BY_QUALITY`. Resetting only the new group to earliest and replaying to 712 left counts, rows and persisted offset unchanged (`PASS_REPLAY`). The three started clone services were stopped; volumes and audit remain.

This proves sink equivalence for the preserved CDC-10 fact topic. It does **not** prove source-to-mapper topology on the target VPS, a new snapshot epoch, a new quality verifier, cart/journey attribution, correction propagation into the live funnel, or equivalence to native `order.placed`.

## Next gates

- Generalize the CDC-10 mapper and source reconciliation/quality verifier for a new target-topology epoch; include source/slot/WAL headroom, source↔mapper↔sink offsets, baseline digest and gap status.
- Register versioned candidate metadata only after physical binding is checked. The approved v2 contract leaves live metric/profile ID and time/correction policy open; this sink does not decide them.
- Exercise ON/OFF, source correction, replay and rollback on the target topology, then obtain CDC-12 authority before disabling the native Backend Adapter. Browser SDK/HTTP feed remain.
