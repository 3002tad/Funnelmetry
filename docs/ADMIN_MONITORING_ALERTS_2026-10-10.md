# Admin monitoring warnings — 2026-10-10

Master §23.14 / §24.3.4, Cookbook pipeline-recovery-observability and security
rules: expose current observations without enabling recovery/scale actuators.
Checkpoint before this work: local commit `047a42e` (not pushed).

## Implemented

- `GET /api/v2/admin/monitoring-alerts` requires live session and `pipeline.monitor`
  before and after collection. Query parameters rejected; no client URL/PromQL.
- Fixed internal `prometheus:9090/api/v1/targets?state=active`, only job
  `funnelmetry-monitoring`; redirects denied, 4s timeout, 64KiB response limit.
  Labels, raw Prometheus errors and credentials are not returned to the browser.
- Scrape DOWN is a failed collection observation, not a diagnosis of why it failed.
  Missing/ambiguous/stale target, disabled integration or unreachable Prometheus
  is UNKNOWN, not zero or healthy.
- Worker known non-ready produces WARNING; absent/invalid/unreachable observation
  produces UNKNOWN. Uses existing fixed six-worker probe/cache. READY does not
  certify DB health, all replicas, or successful event processing.
- Warn about expired/expiring unrevoked keys whose issuer is an active Admin.
  Up to 200 records ordered by earliest expiry, no secret/hash/label returned.
  This is key inventory, not proof that each key is in use by a scraper.
- Admin Processing page shows messages and refreshes every 15 seconds while open;
  a query failure hides old warnings and explicitly reports unavailable evidence.
  No warnings means no current warning in this scope, not global pipeline health.

## Operator configuration

The observability Compose overlay enables `DASHBOARD_PROMETHEUS_MONITORING_ENABLED`.
Configurable demo defaults (not benchmarked production alerting policy):

- `MONITORING_EXPIRY_WARNING_SECONDS=86400`: warn within 24 hours, integer 1..31536000.
- `MONITORING_SCRAPE_STALE_SECONDS=120`: observations older than 120s are UNKNOWN,
  integer 1..3600. Set appropriately for configured scrape interval/timeouts.

There is no sustained-condition window, persisted incident history, acknowledgment,
Prometheus alert-rule evaluation, Alertmanager/email notification, scheduled expiry
reminder or automatic restart/scale in this change. Closing the Admin page stops
browser polling. Further unattended alert delivery requires its own setup.

## Acceptance

- API suite: 169 PASS, 4 optional PostgreSQL integration tests SKIP.
- Unit cases: known-ready/no warning; missing workers UNKNOWN; reported DEGRADED
  warning; scrape DOWN vs unreachable/stale; expiry window vs expired; sanitized
  errors; invalid policy; anonymous/analyst denial and grant recheck after probes.
- UI TypeScript/Vite build PASS. No browser-automation/visual acceptance claimed.
- Local API/UI images `20261010-alerts` deployed; worker image unchanged.
- Real fault test: stopped only `funnelmetry-demo-new-canonical-normalizer-1`,
  observed WORKER_UNVERIFIED through authenticated API, restarted in `finally`,
  observed that warning clear. Anonymous alerts API returned 401 throughout.
- After recovery: Grafana 8 panels, Prometheus UP=1, six worker observations.
- `runtime/check-monitoring-alerts.mjs recovered|unverified` is read-only; it does
  not stop services itself. No source/model activation, event injection, cursor
  reset, migration or volume deletion. Fault test does not prove event catch-up,
  idempotency or recovery under load.

View: http://localhost:5180/admin/processing with Admin. Rollback: restore API/UI
image references from `047a42e` and recreate only those two services; no DB rollback.
