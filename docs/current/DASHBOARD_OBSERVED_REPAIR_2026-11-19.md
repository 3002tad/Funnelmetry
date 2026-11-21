# Dashboard observed data repair

Base: origin/main 9e1ec36, pulled before edits. Preserve the prior F01 empty-state fix and existing local documentation changes.

Plan and scope:

1. Keep a one-day activity point visible and keyboard-accessible; preserve empty vs zero semantics (F01).
2. Enrich aggregated product rows with existing `attachProductReferences` (DEC-137/142), source/product grain, only under the existing catalog CDC quality gate. Names are current descriptions, not historical attributes. No fanout of event counts.
3. Count distinct nonempty observed SDK session IDs in the selected occurred_at window, source-scoped, across CLIENT_OBSERVATION/BEHAVIOR_INTENT events. Label as sessions with observed events, not new sessions, customers or journeys. Preserve missing identity and incomplete coverage warnings. No monetary or order-count inference.
4. Restore the existing governed ACTIVE reference current-state panel (DEC-139/140/144), independently of historical funnel profiles. Do not re-enable retired profiles or alias CDC ON/OFF to order.placed. Preserve 503 quality blocking and error handling.
5. Validate auth, parameter binding, aggregate stability, catalog quality failures, empty data, single-day chart, and current-state rendering. Read live SQL using read-only transactions, then deploy only Dashboard API/Web with rollback provenance if checks pass.

No schema migration, source modification, profile activation or data replay is required.

## Completed implementation and deployment

The above repairs are live at https://analyst.entidi.io.vn. The observed overview now
shows normalized events, sessions with events, search events and checkout-start
events. Checkout-start is explicitly not an order/conversion metric. Historical
demo counts are unchanged. Product titles are attached after aggregation and
fall back to IDs when catalog quality blocks access.

API image: `funnelmetry-dashboard-api@sha256:1772f8a080f05334ba39c6ba678fcf78b620e05ef0558eb0e45775003fa3da4a`.

Web image: `funnelmetry-dashboard-web@sha256:a9527dcdcf36bcb8af2185e498fd7f7ec11cc7bc512647c35862f30701aa2ab3`.

API inherits the running image and replaces the explorer route and its test.
Web inherits the running nginx image and replaces the compiled static bundle
built from this working tree, including upstream main and prior F01 changes.
Public build options retain same-origin API and `https://ai.entidi.io.vn`.
Both services converged (`completed`, healthy). Full service Specs compared
equal after excluding Image. The API file checksum matches the local patch.
No other service, runtime configuration, secret or database was changed.

Release evidence and rollback Specs are stored privately on the VPS under
`/srv/KLTN/dashboard-observed-repair-20261119/` (`before.json`, `after.json`,
`runtime-verification.json`, `target-images.txt`, build logs, payload manifest).
Local acceptance screenshots/results are in
`D:/KLTN/dashboard-observed-repair-20261119/acceptance/`.

Rollback each dashboard service independently using `docker service update
--no-resolve-image --image <oldImage> <service>` and the corresponding oldImage
in `runtime-verification.json`, then verify health/convergence. No database
rollback is needed. Registry publication and existing launcher image drift are
not resolved by this repair; these images remain local to the current VPS node.
Source changes are uncommitted; no GitHub push was performed.

## Validation

- Local API suite: 12/12 targeted tests passed, including observed session scope,
  bound parameters, stable aggregates, catalog quality failures and auth.
- Built API container: 3 explorer endpoint tests passed without network access.
- Web TypeScript and Vite production build passed.
- Live SQL for 2026-11-18 UTC: 25 distinct SDK sessions, zero behavior events
  missing session ID, 3 checkout-start events, 13 named product rows.
- Authenticated browser + independent read-only DB query agreed exactly:
  287 normalized events, 28 product views, 8 search events, 18 add-to-cart events.
  89 events from the latest bot run were visible in the events API.
- Live single-day point has opacity 1 and is centered. Product names render in
  the overview; product/events/traffic/funnel pages loaded without page errors.
- Empty future window renders dashes and no fabricated donut/point. Selecting
  another range clears the old selected day.
- A browser-only simulated CDC quality 503 hides prior CDC totals correctly;
  no server or source state was changed for this check.

The ACTIVE CDC endpoint returned 6 entrants, 0 ordered cart-stage journeys,
0 checkout-stage journeys and 0 currently-recorded-order journeys for November
18. These numbers use the existing governed cohort/identity/order semantics;
they must not be replaced with the raw 18 cart events. This repair verifies UI
and API agreement, not completeness of cross-source journey linkage or order
conversion. Historical coverage remains INCOMPLETE and observed totals remain
UNVERIFIED. The retired historical profiles still have no rows for that day.
