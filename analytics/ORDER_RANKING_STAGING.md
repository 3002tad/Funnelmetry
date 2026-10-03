# tool.order_ranking — staged, opt-in

Master analytical-tool / evidence boundary; Cookbook Analytical Tool Development
and Agent Orchestration. Adds one bounded tool, not unrestricted SQL or an agent loop.

- Top **5 orders per currency**, descending PostgreSQL numeric placed-order amount;
  ties by order ID. Never a global FX ranking, product/day/customer ranking or paid revenue.
- Same reviewed `analytical_fact_order_v1` asset, source `medusa-reference`, exact
  UTC half-open window <=90 days. Source-wide invalid order gate, including rows
  outside the selected time/currency. No filtering away bad facts.
- Separate immutable `order-ranking-staging-1.0.0` registry release; existing
  summary catalog is unchanged. Unknown/tampered releases/bindings fail closed.
- Structured result includes order ID, exact amount string, currency, rank,
  placement time and canonical event IDs; snapshot time, scope, semantic refs,
  quality warnings are preserved. Existing authenticated Analysis Runner persists
  owner-scoped evidence and checks live access before and after execution.
- Chat answer uses deterministic template, no LLM arithmetic/synthesis of money.
  UI evidence and Markdown/JSON report export support ranking rows separately from totals.
- No source/customer details or arbitrary raw payload. No source writes.

## Activation after isolated integration passes

No schema migration beyond existing fact-order/catalog/evidence artifacts.
Install the new release from a trusted server-side deployment session using the
configured PostgreSQL pool (not from chat or an HTTP admin shortcut):

```js
import { analyticalPool } from './apps/dashboard-api/src/db.js'
import { installRankingCatalog } from './analytics/src/order-ranking.mjs'
try { await installRankingCatalog(analyticalPool) }
finally { await analyticalPool.end() }
```

Enable `DASHBOARD_ENABLE_ORDER_RANKING_STAGING=true` alongside existing
`DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING=true` and
`DASHBOARD_ENABLE_ORDER_CHAT_STAGING=true` in the server environment. Recreate/restart
API using its normal deployment process. No key is needed beyond existing Qwen/DB
configuration. Missing ranking release means the tool is not advertised.
Rollback: turn off the ranking flag and restart API; retain stored evidence/releases.

Example: “Những đơn hàng nào có giá trị cao nhất trong 7 ngày qua?” (UI scope must
include those 7 days). “Doanh thu cao nhất” is ambiguous; planner is instructed to
ask which entity, not substitute an aggregate total. Live model adherence is not
proven by fake-provider routing tests; run real Qwen evaluations before claiming it.

Verification 2026-09-29: unit/routing/HTTP regressions and frontend build passed.
New assertions for actual PostgreSQL rank, separated currencies and quality blocking
are in `tools/v2-e2e/test/medusa-downstream.test.mjs`. This turn could not run that
suite because Docker Desktop was off. **Not activated on the demo**; no real model
request, external event or production DB mutation performed.

## Demo activation — 2026-10-02

Supersedes the not-activated status above for this local demo only.

- Started Docker Desktop and ran `tools/v2-e2e/run-medusa-contract.ps1` successfully
  against isolated PostgreSQL (project `funnelmetry-contract-9a45a694c33c`). Ranking
  assertions covered real numeric values, separate currencies and quality blocking;
  downstream and catalog-reference checks passed. Test project was removed.
- Resumed only existing `funnelmetry-private-postgres-1` and
  `funnelmetry-private-dashboard-qwen`. No Source Connector/Kafka/worker resume,
  replay, synthetic business event or external Qwen call was performed.
- Saved custom PostgreSQL backup to ignored
  `runtime/backups/before-ranking-20261002.dump`. Full archive listing succeeded;
  this backup has not undergone a restore rehearsal and is not a migration snapshot.
- Installed and discovered `order-ranking-staging-1.0.0` against the live base
  catalog/binding. Direct read-only ranking for the trailing 30-day UTC window
  returned PROVISIONAL, one order row, EUR. No raw order identifiers logged.
- Set `DASHBOARD_ENABLE_ORDER_RANKING_STAGING=true` in ignored
  `runtime/dashboard-private.env`; restarted only the API, whose command loads that
  file. Verified ranking/summary/chat flags are true.

Still pending: live Qwen question selection, authenticated browser-to-tool acceptance
for ranking, additional ranking fixtures (ties/top-5 boundaries), and feed freshness/
completeness/reconciliation. The direct tool check does not certify these. Existing
demo data is stored data while ingestion remains stopped. Catalog-name sync remains
inactive: `runtime/catalog-sync.env` is absent. No Medusa Admin key was inferred or reused.
