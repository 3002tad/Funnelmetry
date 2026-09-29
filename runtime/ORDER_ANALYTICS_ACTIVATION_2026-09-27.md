# Local demo order analytics activation — 2026-09-27

Activated on the existing `funnelmetry-private` installation with user approval.
This is a local demo activation of the staged capability, not a production release.

## Changes applied

- Started PostgreSQL first and created a custom-format `pg_dump` backup at
  `runtime/backups/order-activation-20260927.dump` (305119 bytes at creation).
  `pg_restore --list` succeeded; a restore drill was not performed. Backups and
  runtime env files are ignored by Git and contain sensitive local data.
- Applied `analytics/sql/fact-order-v1.sql`, `catalog-v1.sql`, `evidence-v1.sql`
  in one transaction after confirming these objects did not exist.
- Installed and verified catalog `order-analytics-staging-1.0.0`.
  Catalog remains `VALIDATED_STAGING`; results remain provisional.
- Enabled `DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING` and
  `DASHBOARD_ENABLE_ORDER_CHAT_STAGING` in ignored `runtime/dashboard-private.env`.
- Kept the existing Polars API image and read-only workspace mount. No legacy
  Python/Polars capability was removed. API health returned HTTP 200/PostgreSQL ok.
- Retained the previous normalizer image as
  `funnelmetry/canonical-normalizer:before-order-activation-20260927`, then built
  and recreated only the normalizer using the existing Compose configuration.
  New mapping is `medusa-order-placed-v2` → `order.placed`.
- Started the existing demo using `runtime/start-private-demo.ps1 -NoBrowser`.
  UI is available at http://localhost:5180. Connector readiness passed; worker
  processes were running. These checks alone do not prove all projections complete.

## Data observed

Before startup: five `order.created` events under `medusa-v2-order-placed-v1`, no
new order facts. After pipeline resumed: those same five events plus one
`order.placed` event under `medusa-order-placed-v2`. A read-only semantic tool call
over 2026-08-29 (inclusive) to 2026-09-28 (exclusive), UTC, returned `PROVISIONAL`
with EUR gross order value `20`.

This is placed-order value, not captured/paid/net revenue and not the total of all
historical orders. No claim is made that the received event represents a new real
customer purchase rather than a queued/demo source event. No synthetic event or
order was submitted during activation; no Qwen call was made by the activation.
The five legacy facts were not renamed, deleted or replayed, and offsets/cursor
were not reset. Existing funnel profiles were not republished or migrated.

## Use and rollback

Sign in as an existing analyst, open `/chat`, choose a date range covering the
order, and ask about **giá trị đơn hàng đã đặt**. Inspect evidence and quality
warnings; historical legacy orders are deliberately excluded.

To disable this capability, set both staging flags to `false` in the local env
file and restart only `funnelmetry-private-dashboard-qwen`. Keep schema/evidence
for audit; do not drop them or restore the database as a routine rollback.
Rolling back the normalizer requires reviewing events processed after activation
before selecting the retained image. Do not reset offsets or automatically restore
the snapshot: doing so can discard newer data or mix mapping versions.

Still separate: historical replay/migration, reference funnel cutover and live
Qwen/browser acceptance on this installation. No automatic claim that all legacy
analytics now use the new monetary or conversion semantics.

## Presentation update

The monetary answer renderer now removes redundant fractional zeros beyond two
decimal places using string operations only (no rounding or numeric conversion).
Known quality warning codes are translated into Vietnamese in the answer; unknown
codes remain visible. Structured evidence retains its original decimals and codes.
Seven renderer/chat tests passed before restarting only the dashboard API. Existing
saved chat text is not rewritten: send a new question to see the updated presentation.
