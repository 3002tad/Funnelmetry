# Admin Kafka offset lag — 2026-10-08

Master §23.14 Kafka/Processing read-only monitoring, implemented using Cookbook
pipeline-recovery-observability. This is not a health/recovery actuator.

## Runtime contract

`GET /api/v2/admin/kafka-lag`: current session + pipeline.monitor checked before
and after the probe, no-store. No query parameters, client-selected broker,
group or topic. Analyst/anonymous cannot call it. Error details are sanitized.

Off by default. Operator-only environment:

- DASHBOARD_KAFKA_LAG_ENABLED=true
- DASHBOARD_KAFKA_LAG_BROKERS: internal host:port CSV (maximum 5)
- DASHBOARD_KAFKA_LAG_TARGETS_JSON: explicit unique group_id/topic pairs (1–12)

`infra/compose.handoff-monitoring.yml` configures 7 pairs for the 6 default
handoff workers (telemetry consumes two topics). Included in new-demo.ps1.
If worker IDs/topics are overridden, update this allowlist. This overlay does
not support arbitrary remote SASL/TLS deployment; keep broker private to the
isolated demo network. Production needs separate credential/ACL review. The
plaintext demo broker does not enforce read-only ACLs; the probe implementation
uses read methods only. No Docker socket/control is exposed.

KafkaJS 2.2.4 uses admin.fetchOffsets(resolveOffsets:false), then
admin.fetchTopicOffsets. No producer, consumer join, commit/reset, or createTopic.
KafkaJS admin disables automatic topic creation. Reference:
https://kafka.js.org/docs/admin

Up to 128 partitions per target; oversized response becomes UNVERIFIED rather
than a truncated total. Request/connection timeouts 2 seconds, 2 short retries
for initial broker metadata, HTTP observation deadline 8 seconds. Results cached
5 seconds, one in-flight probe per API process. Slow cleanup keeps that probe
in-flight rather than spawning overlapping broker connections. This is not a
cluster-wide rate limit. Invalid configuration does not attempt a connection.

## Meaning and limits

- Lag is high offset minus committed next offset, exact decimal strings/BigInt.
- Unit is offset positions, not business events, seconds, or missing records.
- Transaction/control records and compaction mean gaps are possible.
- Missing or -1 commit: NO_COMMITTED_OFFSET, lag null (even on an empty topic).
- Commit below low: BELOW_RETENTION, null; never clamp/reset.
- Commit above high: INCONSISTENT_SNAPSHOT, null; snapshots are not atomic.
- Group/topic total exists only when every partition can be measured.
- Scope is all sources in configured groups, NOT the PostgreSQL source/date
  filter. The separate processing endpoint remains PostgreSQL-only and does not
  suddenly acquire source-specific Kafka metrics.
- Zero lag does not certify worker liveness or end-to-end success. Normalizer
  commits offsets with output transaction; downstream workers persist/project
  before transactional offset commit; telemetry persists before offset commit.
  Those implementation steps do not make offset monitoring a data audit.

## Verification / deployment

- API suite: 151 PASS, 4 optional integration tests SKIP; web build PASS.
- Unit cases: large exact offsets, zero lag, missing commit, retention violation,
  moving snapshot, failure redaction, configuration validation, cache/coalescing,
  timeout without overlapping probes, auth and post-probe grant revocation.
- Real offline broker HTTP smoke: 7 target pairs / 7 partitions read. All high
  offsets 0, committed -1, NO_COMMITTED_OFFSET; total lag intentionally null.
  Anonymous 401; client broker parameter 400. Initial metadata failure with
  retries=0 reproduced and fixed with bounded metadata retry.
- Built local API/UI tag 20261008-lag and recreated only API/UI. No migration,
  event injection, offset reset, topic mutation, live Medusa/Qwen activation,
  registry publication or Git commit.
- Not yet validated with a non-empty live workload or browser automation;
  Prometheus export, group membership/liveness and recovery controls remain open.
