# Admin Processing observation — 2026-10-08

Implements a **partial read-only surface**, not Kafka consumer-lag monitoring.
Authority: Master Admin navigation (§23), operational observability (§24),
Decision Record deployment boundary; Cookbook pipeline-recovery-observability.

## Contract

`GET /api/v2/admin/processing?source_id=...` requires a current session and
`pipeline.monitor`, checked again after the query. Reject unknown/repeated query
parameters; parameterize source ID; no-store responses and generic DB errors.
No source payload, secret, Docker controls, replay, or cursor mutation exposed.

One PostgreSQL statement aggregates existing tables:

| Stage | Grain | Processing / recording timestamps |
|---|---|---|
| normalized / unsupported / quarantined | Latest outcome per source event | max processed_at / max recorded_at |
| canonical | Source event + mapping version | max normalized_at / max persisted_at |
| kpi | Projection application keyed by trigger event | max applied_at / max applied_at |

Counts are decimal strings to preserve bigint precision. Empty source has five
zero-count rows with null timestamps. Missing schema/DB failure is 503, not zero.
Timestamp maxima can belong to different events: no latency calculation.
Scope is retained records, not a date-filtered window or completeness guarantee.
No subtraction between grains. Kafka lag is null / UNVERIFIED. Journey/funnel
runtime liveness, consumer-group offsets, backlog and end-to-end delivery remain
unverified; this does not close the full Master processing observability scope.

## UI / compatibility

`/admin/processing`: Processing · dữ liệu đã lưu. Explicit unknown-lag notice,
five stage cards, manual refresh, identity-scoped query cache, loading/error
states and Quarantine link. Failed refresh hides previous data. No migration or
changes to event semantics, ingestion, source ownership, or existing routes.

## Verification

- API suite: 145 PASS, 4 SKIP (optional integration DB not configured locally).
- Navigation: 5 PASS; TypeScript/Vite production build PASS.
- HTTP smoke against updated offline Docker demo: login 200, processing 200 with
  five PostgreSQL stages, anonymous 401, SPA route 200. Not browser automation.
- Real PostgreSQL transaction with temporary shadow tables: mixed statuses,
  source isolation, different canonical/outcome grains, empty source/null times
  verified; rolled back. No fixtures written to persistent demo event tables.
- Local API/UI images `20261008-processing`, recreated only API/UI; existing
  DB/Kafka/workers preserved. No live source/Qwen calls, registry push or commit.

Next missing capability is actual bounded consumer-group offset telemetry, not
an estimate computed from these database counts.
