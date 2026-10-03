# Admin registry inspection — 2026-10-03

Implemented `/admin/metadata` and `/admin/tools`, backed by read-only
`GET /api/v2/admin/registry`. Scope is the three supported staging analytical
tools (summary, order ranking, product unit-value ranking), not a universal registry.

Live session and `integration.read` permission are checked before and after loading.
Analysts denied. No mutations, secrets, raw events, model calls or publication actions.
Documents are returned only after existing immutable catalog/binding checks succeed.
Missing ranking releases show NOT_INSTALLED; validation or database errors show
UNVERIFIED without exposing internal errors. Chat configuration and provider enablement
are separate from definition verification and do not prove provider health.

UI supports search, refresh, raw escaped definitions, versions/releases and policy
inspection. Metadata skill guidance preserves draft status and distinguishes binding
verification from data quality. Full editing/publishing lifecycle remains unimplemented.

Verification: catalog HTTP tests (including live role/session revocation, invalid
queries, read-only route, sanitized failure) passed; frontend TypeScript/Vite build passed.
No schema migration. Existing unrelated local changes preserved.

Follow-up: `/admin/metric-catalog` now presents measures, metrics, dimensions,
formula/aggregation, explicit grains, time basis and policies from the same verified
endpoint. Reference-only entries remain labeled as references; absent relationships
are not inferred. Search also matches definition IDs. Read-only scope and live Admin
permission remain unchanged; no definition editing or publication API added.

Follow-up: `/admin/schemas` and `/api/v2/admin/mappings` inspect the fixed Medusa
source-native artifact, showing source/payload version, canonical mapping/class,
payload contract and SHA-256. No user-supplied path; output fields allowlisted.
Runtime activation remains UNVERIFIED. Generated passthrough/behavior mappings and
full JSON schemas are not included; this is not a full mapping management lifecycle.

Follow-up: `/admin/run-diagnostics` uses read-only
`GET /api/v2/admin/run-diagnostics` with live `pipeline.monitor` checks before/after
DB access. Returns at most 50 persisted executions in 30 days, optionally filtered
by allowlisted status. Only run/call IDs, timestamp, status and allowlisted tool/error
codes are exposed; no actor, questions, business results or raw error text.
Source: `analytical_execution_evidence`, not general chat telemetry. Missing model
failures, in-flight runs, retry/re-plan, latency/cost are explicitly disclosed.
No database migration or retry action. Unit HTTP security test and frontend build
are required; live acceptance is pending while Docker is stopped.
