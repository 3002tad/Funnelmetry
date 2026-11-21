# Explicit product-page/cart bridge — current-state profile 3.0.0

User authorized the remaining browser/cart linkage repair on 2026-11-19 after
the stalled consumer was recovered. This release implements that request under
Backbone §19.2/19.3 and DEC-139/140/143/144: explicit linkage, immutable profile
versions, CDC ON/OFF terminal, no session-based journey merge or search attribution.

## Plan and contract

Publish reference-commerce-current-state@3.0.0 with linkage contract
reference.product_page_cart_bridge.v1. Preserve v2 release and current-state
terminal contract reference.medusa.order_recorded_state.v2. Grain is source ×
coverage epoch × browser entry journey, distinct once per stage.

Use context.cart_linked only when its explicit cart keys agree and its nonempty
session/page_instance_id match an earlier product-view event. Resolve that cart
through the source-scoped STRONG CART entity. A cart linked to multiple browser
journeys anywhere in post-activation evidence is ambiguous and excluded, even if
the competing journey is outside the selected cohort. One journey can use more
than one cart, but addition → checkout → current order must remain on the same
cart. Duplicate views/contexts/orders cannot multiply journey counts.

Select cohorts by first post-activation product view, retaining existing epoch
activation. No invented timeout or conversion horizon. Read-only recomputation
uses event time, so late evidence can add links or retract ambiguous links.
Missing context and ambiguous carts are reported explicitly, not inferred by
time proximity. No canonical rewrite, journey merge, source edit or replay.

Keep the existing before/after quality lease and ACTIVE-binding checks. Deploy
API capable of v2/v3 before atomically publishing/switching the active binding;
audit the switch with the user authorization reference, not a fabricated new DEC.
Preserve v2 as SHADOW for rollback. Validate SQL on isolated PostgreSQL fixtures,
then check real read-only counts and authenticated dashboard rendering.

Read-only preflight for November 18: 23 entry journeys → 11 with authoritative cart
addition → 3 checkout starts → 0 current terminals. Eleven explicit page/cart
bridges match; twelve entries lack cart context; zero ambiguous carts.

## Live result — 2026-11-20

Completed deployment and activation. The authenticated dashboard displays
**23 → 11 → 3 → 0** for the November 18 UTC cohort, with 11 linked entry journeys,
12 entries lacking cart context and zero ambiguous carts. The refresh button
successfully refetches the live result. This is current-state reach, not order
conversion, paid-order count or a claim of complete source coverage.

Validation:

- TypeScript/Vite production build passed.
- Ten API/profile unit tests passed inside the candidate image.
- Two PostgreSQL integration tests passed, covering duplicates, fanout,
  conflicting/out-of-window owners, cross-source IDs, missing page/session keys,
  contradictory cart keys, late arrival, event ordering, multiple carts per
  entry, no cross-cart step mixing, terminal removal, atomic activation,
  immutable v2 metadata, audit history, rollback and expired-quality rejection.
- Before activation, the new API continued to return v2 totals 23 → 0 → 0 → 0.
- After activation, browser/API returned ACTIVE v3, the expected linkage
  diagnostics, and 23 → 11 → 3 → 0 without browser exceptions.
- Both services are healthy and their Swarm updates completed. Full service
  Specs compare equal apart from Image. The running v3 source checksum matches.

Images:

- API: `funnelmetry-dashboard-api@sha256:07d1ae9ae1d9cc20f5f5b4d0d9ee0fa95baa5f283e31dc6b5b43741f0f2158ad`
- Web: `funnelmetry-dashboard-web@sha256:ae8f09889915c490978726467d0ae8e6a7ba747745d2c34176b76a7e51798459`

Profile release definitions and the switch are persisted in the existing
reference profile release/binding/audit tables. v2 is SHADOW, v3 is ACTIVE;
the epoch and original activation boundary are preserved. The authorization
reference records the user's cart-linkage repair request; it does not invent
a Backbone decision number. Canonical events and journey identities are unchanged.

## Rollback and evidence

`tools/reference-cdc-profile/bridge-release.mjs` generates reviewable SQL:
`node tools/reference-cdc-profile/bridge-release.mjs <output.sql>`; add
`--rollback` to generate v3 → v2. Switching checks exact definitions, current
ACTIVE version, compatible epoch/time boundary and a fresh quality lease.
The transaction logs state changes through the existing append-only audit.

VPS release directory: `/srv/KLTN/bridge-v3-20261120/`, containing `activate.sql`,
`rollback-profile.sql`, before/after service Specs, `runtime-verification.json`,
target digests and build logs. To roll back, execute the reviewed profile
rollback SQL first while the v2/v3-capable API is running, then restore the old
service image digests from the verification file. No event or journey rollback.
The profile-switch roundtrip was tested in isolated PostgreSQL, not on live data.

Local browser screenshots and results:
`D:/KLTN/bridge-v3-20261120/acceptance/`. Images are local to the current VPS node;
registry publication and pre-existing launcher drift remain outside this repair.
No Git commit/push, new bot orders or source-side modifications were performed.
The dashboard still uses explicit refresh; continuous SSE updates are not part
of this linkage repair. Derived AI guides that hardcode v2 are not authority for
v3: consult the ACTIVE database release and returned metric/profile version.

## Primary funnel UI follow-up — 2026-11-20

At the user's request, the current CDC profile now owns the main KPI cards,
four-step chart, per-step reach rates and selected-step explanation. Cards show
entry journeys, currently recorded terminal journeys, terminal/entry ratio and
explicitly linked journeys. No legacy pending/completed status is inferred.
Zero denominators render an em dash. Quality errors hide all current totals.
Historical profiles are collapsed behind “Xem dữ liệu lịch sử” and are fetched
only when expanded, retaining their historical warning and original semantics.

Web-only image: `funnelmetry-dashboard-web@sha256:0b78a2e807e90a0fcaa56e6012650671463b393b03da28ca7ceee4c75606eba3`.
No API, profile, database or journey change. Build passed; authenticated live
browser checks verified 23/11/3/0, rates 47.8% and 27.3%, selected-step behavior,
historical expansion/collapse, and browser-only empty/503 fixtures. No page
errors. Screenshot reviewed; Swarm completed and web container healthy.
Evidence: `D:/KLTN/funnel-ui-20261120/acceptance/`; rollback service Spec and old
web image in `/srv/KLTN/funnel-ui-20261120/before.json`.

### Historical section removed at user request

The user subsequently requested removing “Xem dữ liệu lịch sử” entirely.
FunnelsPage now renders only the current CDC panel; the historical component,
queries and toggle were removed from this page. No historical records deleted.
Web build passed and live browser verification passed (current chart/rates,
step selection, absent historical region, empty and quality-error states).
The first browser attempt timed out locating the date filter during rollout;
the subsequent live run passed without page exceptions. Service completed and
healthy. Web image:
`funnelmetry-dashboard-web@sha256:cd8f46e1b0f25ca4ff915b858cabc4d5e563b970a4506cda7ffb24cfb1b66ece`.
Release/rollback: `/srv/KLTN/funnel-current-only-20261120/`.
