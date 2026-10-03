# Staged order analytical asset

## Read this first — documentation map (2026-10-03)

This document retains chronological implementation stages. Statements such as “not registered” or “remaining” below describe their original stage, not the entire current implementation. Staging metadata still does not mean a production-published catalog.

| Topic | Read | Boundary |
|---|---|---|
| Order summary activation | [27/09 evidence](../runtime/ORDER_ANALYTICS_ACTIVATION_2026-09-27.md) | Local snapshot, not current health |
| Order ranking | [ORDER_RANKING_STAGING](ORDER_RANKING_STAGING.md) | Read the 02/10 activation follow-up |
| Product ranking | [PRODUCT_RANKING_STAGING](PRODUCT_RANKING_STAGING.md) | Historical unit price × quantity, not paid revenue; 03/10 activation |
| Admin registry/diagnostics | [Admin inspection](ADMIN_REGISTRY_READONLY_2026-10-03.md) | Read-only; acceptance limits per page |
| Product names | [Catalog sync](../workers/catalog-sync/README.md) | Current descriptive reference; not historical price authority |
| Tests / earlier readiness | [Staging readiness](STAGING_READINESS_2026-09-25.md), [Qwen evaluation](QWEN_EVAL_2026-09-25.md) | Dated evidence, not general accuracy claims |
| Runtime / deployment | [Runtime index](../runtime/README.md) | Activation is separate from code installation |

`metadata/` contains versioned definitions, `sql/` staged assets/catalog/evidence schema, `src/` deterministic execution and registry code, `test/` analytical tests. No code or SQL was moved during documentation cleanup.

## Historical first slice

Master 14.4.3 / Migration B, first slice only. Not a published catalog or Agent tool.

`sql/fact-order-v1.sql` defines a read-only view over the canonical ledger. It is
deliberately outside automatic migrations: existing demo/history remains untouched.
`metadata/order-value-v1.json` is a DRAFT binding description, not PostgreSQL
metadata authority or an active semantic registry entry.

Grain: one placed order per `(source_id, order_id)` for Medusa reference. Matching
duplicate facts collapse; conflicting amount, currency or placement time blocks the
order. Unknown mappings/invalid money/unauthoritative time block rather than guess.
Legacy `order.created` is not a placement fact. Canonical IDs retain provenance.

Money remains PostgreSQL numeric (returned as decimal strings), without cent conversion.
Preserve Medusa's order total including its source tax/shipping/discount treatment;
do not recalculate from items or current catalog prices. No implicit cancellation or
refund subtraction. No item/category allocation. Aggregate separately by currency.

Consumers MUST check quality before aggregation and block an affected scope rather
than discard invalid rows. A blocked row may have no currency/time; include such
rows in scope-quality checks, not just the final currency/time-filtered query.
This view alone does not establish feed completeness, freshness or reconciliation.

Run `tools/v2-e2e/run-medusa-contract.ps1` for the isolated PostgreSQL conformance
test. No live migration is performed. Rollback before deployment is simply not
activating this artifact; a future runtime publication needs versioned migration,
metadata authority, quality-gated access, permissions and a cutover plan.

Remaining: publish governed metadata in PostgreSQL and semantic tools, integrate planner/UI/report wording. Existing
legacy chat revenue paths are not certified or silently rebound by this slice.

## Staged read-only access (2026-09-24)

`src/order-summary.mjs` adds an internal, fixed binding over this staged view.
It is NOT registered/exposed to the Agent, not a published metadata resolver and
not a replacement for runtime permission checks. No live database migration occurs.

Requests accept only `source_id`, canonical UTC `from`/`to` strings (millisecond
precision, half-open interval), and optional uppercase `currency_code`. Unknown
filters/measures are rejected before DB access. Caller must supply a positive
statement timeout in milliseconds. SQL parameters carry all request values.

A read-only repeatable-read transaction checks quality and aggregates from one
snapshot. Any invalid order in the source blocks execution, including outside the
requested time/currency filter: blocked facts have lost trustworthy scope fields.
This conservative source-wide gate must not be narrowed without stronger evidence.

Valid groups return gross order value, distinct order-grain count and AOV separately
per currency as decimal/count strings. AOV uses PostgreSQL numeric division precision,
not a currency display-rounding policy. Empty scopes return `INSUFFICIENT_DATA`;
nonempty results remain `PROVISIONAL` because feed coverage/freshness/reconciliation
are unverified. Provenance includes draft metadata hash/version, binding, filters,
snapshot timestamp and warnings; it is not yet persisted Analysis Run evidence.

Unit tests: `node --test analytics/test/*.test.mjs`.
Verification on 2026-09-24: after starting Docker, the isolated PostgreSQL 15
test passed (1 integration test, zero skipped); all 3 access-layer unit tests passed.
The integration test exercises the real summary SQL: separate EUR/USD groups,
gross value, distinct order-grain count, AOV, currency filtering, empty time range,
and source-wide blocking even when a currency filter could hide a conflicting fact.
The temporary Compose project and tmpfs database were removed after completion.
This verifies synthetic isolated data, not live feed completeness, published metadata,
Agent routing or production authorization. Those remain unverified/unimplemented.

## PostgreSQL catalog and semantic registry (staging, 2026-09-24)

`sql/catalog-v1.sql` adds immutable versioned catalog releases in PostgreSQL.
`src/semantic-registry.mjs` installs `order-analytics-staging-1.0.0` only after
checking the physical binding's columns/types. Reinstalling identical contents is
idempotent; same-version different contents fail. Updates/deletes are rejected by
a database trigger. The schema stays outside automatic runtime migrations.

The staging executor requires an exact release and `tool.metric_summary`. It
loads the release from PostgreSQL, checks compatibility against its declared outputs
and required currency dimension, then calls only the fixed order-summary executor.
Unsupported releases/documents fail closed; local code never substitutes for a
missing release. The executable is pinned to this reviewed document, not a generic
dynamic SQL interpreter. Changing semantics requires a new reviewed release/code.

Supported versioned references are gross order value, order count and AOV at 1.0.0.
`measure.revenue`, item dimensions, arbitrary tool names and omission of currency
grouping are rejected. Results preserve quality blocking and warnings and add the
semantic tool version, release, requested references and binding provenance.

The PostgreSQL conformance test passes for installation/reinstallation, execution,
unsupported semantics, immutable releases, quality blocking and broken binding.
Unit tests additionally check invalid dispatch and absent/tampered catalogs.

This is **VALIDATED_STAGING**, not production publication. The JSON source remains
DRAFT; the existing summary provenance deliberately retains that warning. No Agent
route is enabled. Remaining production work includes metadata lifecycle/activation,
DB role privileges, per-user authorization, persistent Analysis Run/Evidence,
bounded metadata queries, deployment review and planner/UI integration. Column/type
checks do not certify an arbitrarily replaced SQL view's semantics; deployments must
pin/review the accompanying SQL artifact. Existing runtime chat is unchanged.

## Persisted execution evidence (staging, 2026-09-24)

`sql/evidence-v1.sql` and `src/analysis-run.mjs` add append-only completed execution
records. Each has server-generated evidence/run/tool-call IDs, actor ownership,
structured outcome and its full provenance/warnings. Decimal/count strings survive
JSONB persistence. Both provisional and quality-blocked outcomes are retained.
Raw prompts and unchecked requests are not stored; invalid requests record only the
sanitized error. A storage failure returns an error with no evidence ID or totals.

The runner reuses the dashboard's live session/capability verifier via a required
server-side account query, before computation, before storage and before response.
Reading evidence requires live permission plus matching actor ID. The actor must be
supplied by verified server authentication, never by model/client request fields.
No HTTP route or authentication bypass is introduced. Existing legacy role bundles
are reused, not redefined; role cleanup against the two-role Master is separate work.

Verification: PostgreSQL integration covers round-trip preservation, owner-scoped
reads, blocked results and update rejection. Unit tests cover inactive accounts,
technical-admin denial, mid-execution revocation, sanitized invalid requests and
storage failure. Account rows in these isolated tests are synthetic; production
JWT/session middleware integration remains unverified.

Limitations: this is a completed-result snapshot, not a durable data snapshot for
exact replay. Crashes before insertion leave no completed record; retries create
new execution IDs (no request-idempotency contract yet). Authorization revocation
is rechecked but is not atomically locked with account updates. No running-job
lifecycle, API, retention policy, DB least-privilege grants or official report
publication is claimed. This schema is not applied to the demo automatically.

The API now has an opt-in `POST /api/v2/chat/order-summary` adapter (see the
dashboard-api README). It pins this staging registry and uses the existing live
account verifier. The endpoint is off by default and has not been deployed.
An additional default-off order-chat flag now connects verified catalog discovery
to planner selection, persisted execution and evidence-only synthesis. See the API
README for activation prerequisites and test limitations. This is not live deployment
or completion of the full semantic tool migration; only order summaries are covered.

## Combined HTTP/PostgreSQL acceptance (2026-09-25)

`tools/v2-e2e/test/order-chat-http.mjs` now runs within the isolated conformance
database. It applies the existing account/session migrations, inserts a synthetic
analyst and uses signed JWTs with actual database-backed session checks. The real
HTTP chat router calls real catalog discovery, registry, numerical query and
evidence persistence. Only the LLM provider is simulated; it asserts evidence is
already committed and aggregate values match the persisted document before reply.

Verified: anonymous request rejected, provisional result returned with stored
evidence, no actor identity exported to synthesis, and account deactivation during
planning invalidates the session without synthesis or a new completed evidence row.
The PostgreSQL session-revocation trigger is exercised, not a mocked version counter.

On 2026-09-25 all 10 analytics unit tests, 6 HTTP/config tests and the combined
PostgreSQL conformance test passed. Temporary database/container/network were removed.
This does not test the password-login endpoint, real Qwen classification/wording,
deployed container packaging, live Medusa feed or production data quality. No demo
feature flags, environment secrets, source code or persisted demo data were changed.
