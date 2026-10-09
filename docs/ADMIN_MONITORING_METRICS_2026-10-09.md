# Authenticated monitoring metrics — 2026-10-09

Master §24.3.4 / Cookbook pipeline-recovery-observability: expose existing
observations as Prometheus text 0.0.4 gauges, not a new monitoring stack.
Format reference: https://prometheus.io/docs/instrumenting/exposition_formats/

## Endpoint and security

`GET /api/v2/admin/metrics`, current dashboard Bearer session and pipeline.monitor
required. Session/grants rechecked after probes. No query parameters accepted;
no client-selected targets, SQL, labels, credentials or Docker control. Responses
are no-store; invalid input 400, anonymous/expired 401, insufficient privilege
403, internal collection exception 503 with generic error.

Uses cached bounded Kafka/worker probes already used by the UI. Does not expose
raw payloads, model data, member IDs/hosts, exception strings, or secrets. Label
cardinality follows configured group/topic allowlist and six fixed worker IDs.
Membership emitted once per group even when it consumes several topics.

## Gauge families

- funnelmetry_monitoring_snapshot_available{collector}: at least one target
  observation available, NOT all targets healthy.
- funnelmetry_monitoring_observed_timestamp_seconds{collector[,worker]}: probe
  time, not scrape time; inspect freshness separately (probe cache up to 5s).
- funnelmetry_kafka_lag_available{group_id,topic}: known lag safe to export.
- funnelmetry_kafka_lag_offsets{group_id,topic}: offset positions, all sources,
  not business event count or seconds; omitted when unknown or above 2^53-1.
  Exact large values remain available in the JSON API; floating-point metrics
  must not silently lose integer precision.
- funnelmetry_kafka_membership_available{group_id}: membership known.
- funnelmetry_kafka_group_members{group_id}: broker group count, not containers.
- funnelmetry_kafka_group_state{group_id,state}: observed state sample = 1.
- funnelmetry_worker_observation_available{worker}: runtime flag known.
- funnelmetry_worker_runtime_ready{worker}: 1 for reported READY, 0 for known
  non-ready; omitted for UNVERIFIED. Not continuous DB/dependency validation.

Unknown is not zero. Check availability gauges before interpreting missing
series or applying alerts. An HTTP 200 scrape does not mean Kafka/workers are
healthy: disabled/unreachable probes can legitimately return availability=0.
No recovery/autoscaling decisions are enabled by this endpoint.

## Scrape setup boundary

This is an authenticated exporter only. No Prometheus/Grafana deployment,
dashboard, durable metrics storage or Alertmanager configured in this change.
For a controlled short-lived test, an operator may supply a current dashboard
session token via a secret-backed credentials file (never in Git or a URL).
It expires and is revoked through existing account/session rules. Do not weaken
authentication, create perpetual JWTs or embed an administrator password just
to make unattended scraping work. A least-privilege machine credential lifecycle
must be agreed before production unattended monitoring.

## Verification

- API suite: 162 PASS, 4 optional PostgreSQL integration tests SKIP.
- Formatter cases: unknown versus known zero, huge exact JSON counts excluded
  from floating-point metrics, timestamp preservation, family grouping, label
  escaping, duplicate membership suppression and omission of private fields.
- Route cases: content type, no-store, invalid targets, anonymous/analyst denial,
  session/grant revocation after probe, sanitized failure.
- No schema/event/offset changes or new dependency. Runtime checks appended below.

### Runtime acceptance

- Local API image `20261009-metrics` deployed; API only recreated, worker/UI
  images remain `20261009-health` and DB/Kafka remain untouched.
- Actual authenticated HTTP metrics: 200, correct text content type, six worker
  flags and six distinct group member samples; anonymous 401, query override 400.
- `promtool check metrics` from temporary isolated `prom/prometheus:v3.5.0`
  container PASS on actual output. First PowerShell pipeline transformed LF to
  CRLF and failed lint; verified HTTP itself contains no CR, repeated with native
  stdin preserving LF and passed. No formatter workaround needed.
- No Prometheus server started. Validator container removed automatically;
  validation image remains in local Docker cache. No credentials written to disk
  or printed. No migration/reset/event injection/source/model activation.
- No browser E2E, unattended scrape lifecycle or alert delivery acceptance yet.

### Visualization follow-up

Importable Grafana JSON and an internal Prometheus scrape template now live in
`infra/observability/`, with usage and verification in its README. These are
validated artifacts, not a running monitoring stack or unattended credential.
Artifact checks (3), configuration syntax and PromQL regression checks (3) pass.
No Grafana browser/import acceptance or live scrape lifecycle claim is made.
