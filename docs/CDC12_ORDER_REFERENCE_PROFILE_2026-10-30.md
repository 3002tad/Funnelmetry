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

The order stream is **profile active, source adapter not retired**. Before
removing the adapter via the source-owned installer, finish the official
read-path retirement of the old order.placed profile for new reference
comparisons, record a bounded observation/rollback window, verify a new
post-activation checkout and OFF correction through the active API, and pin
the release in the deploy manifest. Keep historical order.placed data and
Browser SDK/Source Feed for behavioral traffic. Catalog CDC and stage-2
current-offer canaries remain separately quality-gated; this record does not
promote unsupported price or stock contexts.
