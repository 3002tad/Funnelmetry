# Operational telemetry history

Collector -> optional `service_telemetry_samples` PostgreSQL table -> authenticated
Dashboard API -> existing Auto Scaling page. No controller or policy is needed
to measure or chart replica, memory and lag. Business/canonical records and
controller action audit remain separate.

## Measurement

The host-only collector reuses `KAFKA_PROBE` / `summarizeOffsets` from
`tools/autoscaler/observe.mjs`. It reads offsets and bounded `read_committed`
control tails without joining a group, resolving/resetting offsets or committing.
Only complete ordered control-only tails matching the same high/stable watermark
are discounted. Otherwise raw lag is retained conservatively. Unstable group,
missing commits and invalid offsets produce null consumable lag, not zero.
This remains an offset-based conservative backlog, not a count of business events.

## Storage and installation

`apps/dashboard-api/migrations/001_service_telemetry_samples.sql` creates one
optional operational table. It is intentionally outside the bootstrap and CDC
migration contracts: it changes no schema digest or business binding.
After deploying the API image, run the operator-only script inside its container:

```sh
node scripts/telemetry-storage.mjs migrate
# Feed the exact JSON snapshot through stdin, not a URL or shell SQL string:
node scripts/telemetry-storage.mjs ingest < /run/observability/scaling.json
```

The script resolves existing mounted secret files in memory. The collector's
host systemd wrapper invokes `ingest` after atomically publishing its snapshot.
It does not expose a browser/Agent write endpoint or give the HTTP API a Docker
socket. Ingest SQL uses parameters and deduplicates on stack/service/group/topic/
observed_at. Retention defaults to 7 days (`DASHBOARD_TELEMETRY_RETENTION_DAYS`,
bounded 1..30), deletes only this stack/service's operational samples in batches
of at most 5000, and never deletes analytical/business data.

Migration is additive and idempotent. To disable, stop ingestion and remove the
history UI configuration; existing operational samples can remain. Dropping the
table destroys history and is a separate explicit operator action, not an
automatic rollback step. No demo samples or historic backfill are generated.

## API and display

- `GET /api/v2/admin/scaling`: current snapshot, including consumable lag and its
  time/status/reason. Stale telemetry still expires; policy/audit are separate.
- `GET /api/v2/admin/scaling/history?hours=24`: hours 1..168, live session and
  `pipeline.monitor`; clients cannot select an arbitrary stack/group/table.
- Maximum 721 buckets, latest actual sample per bucket, ascending timestamps.
  Missing storage gives an error rather than an invented empty history.
- UI offers 1h/6h/24h/7d, real replica/lag/RAM charts, refresh/error/empty states.
  Nulls and large time gaps break chart lines. It does not synthesize zero values,
  derive decisions from trends, or populate policy with measurement values.

The existing host timer is approximately 20 seconds after each run. Measurement
and database failures must be visible in its service result/journal; a failed
collection must not re-date an older sample. Old files still expire after 60s.
