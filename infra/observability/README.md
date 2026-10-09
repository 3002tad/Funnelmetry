# Pipeline monitoring artifacts

Implements the visualization preparation for Master §24.3.4 / DEC-103.
The optional `../compose.observability.yml` now runs Prometheus and Grafana with a
metrics-only machine credential. See [deployment and key lifecycle](../../docs/MONITORING_MACHINE_CREDENTIALS_2026-10-09.md).
No recovery/autoscaling is enabled.

## Files

- `pipeline-dashboard.json`: classic Grafana dashboard for manual import.
- `prometheus.yml.example`: authenticated internal scrape template.
- `dashboard-promql.test.yml`: synthetic PromQL tests (JSON-compatible YAML).
- `artifacts.test.mjs`: dependency-free artifact consistency tests.

## Controlled demo setup

1. Provision Prometheus on the same private Compose network as `dashboard-api`.
   Use the template as its configuration, not a public API target. For remote
   scraping, use authenticated HTTPS and validate certificates; do not send the
   Bearer token over public HTTP.
2. Mount a **metrics-only machine token** as the read-only file
   `/run/secrets/funnelmetry_metrics_token`. Issue it through the Admin credential API.
   Supply the token only, not the `Bearer ` prefix. Keep the secret outside Git,
   logs, CLI arguments and dashboard JSON. No credentials are included here.
3. Verify the scrape target is UP. Expiration/revocation must fail authentication;
   use an operator-authorized replacement. Do not extend
   JWT lifetime or embed an Admin password to keep scraping unattended.
4. In Grafana, configure a Prometheus datasource pointing to that internal server,
   import `pipeline-dashboard.json`, and select it for the Prometheus input.
   This dashboard uses the fixed job name `funnelmetry-monitoring` from the template.

Machine credentials now support explicit expiry, rotation by replacement and
revocation. They are not Admin sessions. Production retention, sizing, alert
thresholds, host/container exporters and recovery policies are separate work.

## Interpretation

- Scrape UP means HTTP collection succeeded, not that processing succeeded.
- Availability means at least one observation exists, not all targets healthy.
- Lag is offset positions for all configured sources, not event count or seconds.
- Known zero is displayed; unknown lag/member/readiness is omitted, never zero-filled.
- Processing queries require both observation availability and a successful scrape.
  Failed scrapes suppress old operational samples; historical points remain visible
  at their original timestamps. A removed target may remain visible until Prometheus
  marks its series stale. Always inspect scrape status and the chart time range.
- Worker READY is a local runtime flag, not continuous database/dependency validation.
- Probe age measures time since a probe (including failed probes), not last successful
  canonical event or business data freshness. No source/date filtering is implied.

## Verification — 2026-10-09

Run from `Streaming_Pipeline`:

```powershell
node --test infra/observability/artifacts.test.mjs
$checks = (Resolve-Path infra/observability).Path
docker run --rm --network none --mount "type=bind,source=$checks,target=/checks,readonly" --entrypoint /bin/promtool prom/prometheus:v3.5.0 check config --syntax-only /checks/prometheus.yml.example
docker run --rm --network none --mount "type=bind,source=$checks,target=/checks,readonly" --entrypoint /bin/promtool prom/prometheus:v3.5.0 test rules /checks/dashboard-promql.test.yml
```

Promtool configuration syntax and three query regressions PASS: known-zero values
remain visible; unavailable observations and failed scrapes are excluded even if
an old operational value exists. Syntax-only does not validate the mounted token,
network access or authorization. Live Grafana provisioning and datasource queries
now pass (see linked evidence); browser visual acceptance remains outstanding.
Validator containers are temporary/read-only/network-disabled; no demo events,
schema, volumes, Kafka offsets or Source Connector state are changed.
