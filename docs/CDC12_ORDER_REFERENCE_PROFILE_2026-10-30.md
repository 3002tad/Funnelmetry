# CDC-12 reference order current-state profile — 2026-10-30

**Scope:** Medusa reference, `cdc11_order_epoch1`. The approved profile is
`reference-commerce-current-state@2.0.0`; metric
`metric.reference_currently_recorded_journey_count@2.0.0`. The terminal is
retractable CDC current state, not canonical `order.placed` conversion.

## Release and migration evidence

- Pipeline commit `f66a613` passed [CDC reference installer CI run
  41081874708](https://github.com/3002tad/Funnelmetry/actions/runs/41081874708),
  including a real PostgreSQL migration rehearsal, Node tests and Web build.
- API candidate [publish run
  41082308174](https://github.com/3002tad/Funnelmetry/actions/runs/41082308174)
  passed image smoke tests. Deployed image digest:
  `ghcr.io/3002tad/funnelmetry-cdc-api-candidate@sha256:1764b2875b1f1f3f413baf8f04ce3b7337f7608b54167a409031071c3ec57af6`.
- On the VPS, migration planner reported `READY_TO_EXTEND`, appliedCount 7,
  pending only `029_reference_cdc_v2_profile_audit.sql`; reviewed digest
  `e9a192f699b9269f651a6c862d762072c0740574f31dd0e1497eedbd78c510e4`.
  The guarded apply returned `APPLIED_CANDIDATE_ONLY`; the journal ends at 029.
  Migration 028 and its checksum were left unchanged.

## Publication and read-path evidence

- The release was published SHADOW, then explicitly activated with
  `DEC-119/135-2026-10-30`. Source `medusa-reference`, epoch
  `cdc11_order_epoch1`, activation boundary `2026-10-30T04:29:31.042Z`
  follows the ingested BASELINE_COMPLETE at
  `2026-10-30T04:29:31.041806Z`. The binding audit contains `NULL→SHADOW`
  (audit 1) and `SHADOW→ACTIVE` (audit 2).
- With SHADOW binding, analyst authentication succeeded and the new API
  returned HTTP 503 `BLOCKED_BY_QUALITY/REFERENCE_PROFILE_INACTIVE`.
  After activation, the same authenticated read returned HTTP 200
  `CURRENT_STATE_READY`, profile/metric version 2.0.0, counts 1 entrant,
  1 item added, 1 checkout started, 1 currently recorded journey.
  `historical_gap_status=INCOMPLETE` remains explicit.
- The old `commerce-conversion@2.0.0` profile and native Backend Adapter were
  not modified by this profile activation. No CDC ON/OFF is written as
  canonical `order.placed`; the two metrics must never be summed.

## Runtime boundary and remaining cutover work

The API and Web changes are currently backed-up Docker service overrides.
Previous specifications: `/srv/KLTN/.cdc12-order-v2/dashboard-api-before-profile.json`
and `dashboard-web-before-profile.json` on the VPS (mode 600). Web candidate
[publish run 41084102742](https://github.com/3002tad/Funnelmetry/actions/runs/41084102742)
passed and deployed digest
`ghcr.io/3002tad/funnelmetry-cdc-web-candidate@sha256:6996de259f8fdbd67ea49400d10f2b5390f84b6bd2eaeb62fe3165b847aa7887`.
The Web task replaced its predecessor and `https://analyst.entidi.io.vn/`
returned HTTP 200. The source checkout is still on its older `main` revision;
an official merged, pinned deployment manifest is required before this is
considered durable.

The profile was initially activated with the native source adapter still
running. The subsequent source cutover and current boundary are recorded
below. Browser SDK/Source Feed continues to carry behavioral traffic;
catalog and stage-2 offer reads remain separately quality-gated.

## Source cutover and current runtime, 2026-10-30

- Medusa CI plan `41086240367` and propose `41086240678` passed. The installer
  generated commit `097d830` from `funnelmetry.integration.yaml` with
  `medusa_backend: []` and an explicit `cdc_backend_cutover` declaration. The
  patch removed only the native order subscriber, delivery dispatcher and
  backend kit dependency; Browser SDK and storefront hooks remain.
- On the VPS, backend image was built from `097d830` and only the backend
  Compose container was recreated. The new backend returned `/health` 200;
  its image has neither native order subscriber nor dispatcher. PostgreSQL,
  its three CDC slots, Redis and storefront were not recreated.
- The historical `commerce-conversion@2.0.0` and `online-payment@1.0.0`
  activations were ended at `2026-10-30 16:24:13 UTC`. The funnel processor
  now checks `disabled_at` against event time; the publisher does not reactivate
  a retired profile. Historical records remain readable. Pipeline PostgreSQL
  CI run `41088288058` passed. The Workers candidate publication run
  `41088822337` passed, digest
  `sha256:bac8e49600aefa92accec823ccf5e39db34da76e733d987f770b45057c9278a0`.
- One post-cutover checkout created
  `order_01M66T4RKN0MDNX8Q2CX5W9NBA` linked to
  `cart_01M66T4P2DFBE36RHC8ZMKK3EP`. CDC order state became ON at fact
  Kafka offset 375; inbox contains STATE 374 and TRANSITION 375. The canonical
  ledger has zero `order.placed` for that order. This verifies the new order
  used CDC without the retired adapter; it does not assert conversion or
  paid revenue.
- API candidate publish run `41090226457` passed, digest
  `sha256:40d642e8ec2af59896e00e963edfed7d10133423956cacd5fcb13e1a3dbbdb76`.
  After rollout, authenticated analyst reads returned HTTP 200 for the active
  CDC current state and for the historical commerce funnel (2 entrants,
  2 observed conversions). The CDC response still reports
  `historical_gap_status=INCOMPLETE`. The storefront and Medusa public health
  endpoints returned HTTP 200.
- The feature checkout `/srv/KLTN/Funnelmetry-cdc-profile` has an ignored
  `runtime/deploy.env` with pinned API/Web/Publisher/Processor digests,
  `catalog_cdc`, `catalog-sync=0`, active order-v2 scope and stage-2 offer flag.
  `node runtime/swarm.mjs check-app` passed. The old VPS main checkout is not
  an approved redeploy source for this cutover. A full stack redeploy from the
  feature checkout has not been performed; current services are scoped
  overrides. Catalog and stage-2 leases were `PASS` and unexpired after the
  checkout, with the three CDC stream services running.

This closes the native backend order adapter on the Medusa reference runtime.
The separate Source Ingress/HTTPS Feed remains for browser behavioral events.
The stage-2 current-offer read path remains reference-shape gated; an ACTIVE
semantic analytical asset/tool for broader inventory or price analysis is
still pending. No new OFF mutation was made after cutover because the same
CDC OFF/ON source transition had already been exercised before activation.
