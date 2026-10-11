# Product unit-value ranking — 2026-10-03

User-approved proxy: SUM(historical unit price × quantity), grouped by source,
product and currency. Not allocated order total, paid/net revenue or catalog price.
Source unit-price tax/discount inclusion is unverified; no additional tax, shipping,
discount, refund or cancellation allocation is inferred.

## Implementation

- Draft metadata: `metadata/product-value-v1.json`; separate immutable catalog release.
- Staged read-only asset: `sql/product-value-v1.sql`, based on validated order facts
  and canonical item arrays. Repeated identical order deliveries count once.
  Conflicting item arrays, missing/empty items or invalid amounts block the scope.
- `src/product-ranking.mjs`: PostgreSQL numeric aggregation, top 5 per currency,
  ties by product ID, strict <=90-day scope, source-wide quality gate, exact strings.
- Current catalog names are optional descriptive references with snapshot provenance;
  missing catalog does not change amounts. Never read current prices.
- Existing authenticated Analysis Runner persists evidence. Chat is opt-in through
  `DASHBOARD_ENABLE_PRODUCT_RANKING_STAGING=true`; default disabled.
- Chat renderer, evidence table, JSON and Markdown export preserve separate semantics.

## Activation gate / remaining

Not activated on demo. Docker was unavailable on 2026-10-03; isolated PostgreSQL
acceptance (`tools/v2-e2e/run-medusa-contract.ps1`) could not run. Added assertions
cover duplicate delivery, separate currencies, item value distinct from order total,
and conflicting item arrays. Still require SQL execution, top-5/tie/decimal fixtures,
authenticated product HTTP/evidence checks and live Qwen/browser acceptance.

After isolated acceptance: back up demo, apply the staged SQL view, call
`installProductRankingCatalog(pool)` from a trusted deployment session, then enable
the flag and restart Dashboard API. Do not change source or replay history.
Rollback: disable flag and restart API; preserve releases and saved evidence.

No new real model calls, source changes or demo database writes in this implementation.

## Local demo activation — 2026-10-03

Supersedes the inactive status above for this demo. Isolated PostgreSQL contract
suite passed (project `funnelmetry-contract-39e642bc8fa7`, removed after test).
Backup saved to ignored `runtime/backups/before-product-ranking-20261003.dump`;
archive listing passed (311 entries), no restore rehearsal claimed.
Installed the staged view/catalog transactionally without editing canonical history.
Direct 30-day tool read returned PROVISIONAL, one EUR product with catalog reference.
Enabled product-ranking flag in ignored `runtime/qwen.env`.
Source Connector readiness was not confirmed at launcher completion; these are
stored-data results, not proof of live ingestion or complete source coverage.
No live Qwen call was made during this activation. Remaining acceptance items above
(top-5/ties/decimal fixtures and product-specific HTTP/browser/model tests) remain open.
