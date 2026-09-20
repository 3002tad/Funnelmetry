# Kafka recovery — preparation only

Status: demo recovered using a bounded retained/completed-prefix procedure, verified
first against a restored copy. General RESTORE_REPLAY remains unimplemented.

Observed on Laptop 2:
- No original containers existed before image cleanup. Cleanup removed images only, not volumes.
- Named Kafka volume is empty; read-only metadata scan of remaining volumes found no Kafka recovery metadata.
- Apache Kafka 3.9.1 Docker default uses `/tmp/kraft-combined-logs`; compose mounted `/var/lib/kafka/data` without setting `KAFKA_LOG_DIRS`.
- Compose now explicitly sets `KAFKA_LOG_DIRS=/var/lib/kafka/data`. This prevents future mismatch; it does not recover deleted logs. Do not recreate a running older broker with this change without migrating its log data first.
- PostgreSQL is available with 63 canonical events, 57 journeys, connector handoff cursor 20 and 16 feed canonical events.
- Read-only authenticated Source Feed check from sequence 0 returned 20 records, matching configured feed lineage, retention floor 0, latest/next sequence 20. This is a point-in-time check, not a retention guarantee or processing-safe checkpoint.
- A custom-format PostgreSQL backup was copied outside Git into `%LOCALAPPDATA%/Funnelmetry/backups/<timestamp>/postgres.dump`; `pg_restore --list` succeeded. Full restore has not been tested.

## Recovery executed

- Isolated project `funnelmetry-recovery-check`: restored PostgreSQL backup and new
  Kafka with explicit durable log directory. Same six worker images as demo.
- Operator tool `workers/source-connector/src/recover-retained-prefix.mjs` replays
  from 0 to the saved handoff cursor WITHOUT changing that cursor. It requires
  explicit confirmation/expected cursor, exclusive connector advisory lock,
  matching lineage, retained full prefix, persisted matching receipts and terminal
  outcomes, and completed Journey/KPI applications for every normalized record.
  It preserves original receipt time and refuses incomplete projections. All source
  records are validated before the first Kafka publication. This is NOT arbitrary
  snapshot restore, missing-stage recovery, or a durable processing-checkpoint system.
- Fixed telemetry equality to ignore only outcome `processed_at` on replay;
  original stored document is retained, changed semantics still conflict. PostgreSQL
  regression test passed; 12 telemetry unit tests passed (DB test run separately).
- Both isolated and live replay verified 20 raw/receipt/outcome records and 16
  canonical/persisted/journey/funnel/KPI records via read-committed consumers.
  Four existing quarantined source records remain quarantined.
- Counts and full row hashes unchanged across ten tables: canonical_events,
  journeys, journey_events, funnel_instances, funnel_instance_steps,
  funnel_event_applications, funnel_kpi_instance_facts, funnel_kpi_step_facts,
  kpi_projection_applications, source_connector_cursors.
- Live PostgreSQL remains 63 canonical events, 57 journeys, four funnel instances
  and four KPI instance facts. Cursor stayed 20 throughout replay.
- Restarted NORMAL connector only after live verification. PostgreSQL, Kafka,
  six workers and dashboard API are running. Isolated project is stopped; its
  snapshot volumes remain available for diagnosis. No customer orders/events created.
- `meta.properties` now exists under `/var/lib/kafka/data` in live Kafka.

## Limitations / future recovery

Do not use NORMAL mode with an unverified old cursor against a new Kafka cluster. SourceConnector
currently rejects RESTORE_REPLAY (`RESTORE_MODE_NOT_IMPLEMENTED`). Before enabling
ingestion, implement/test an explicit recovery procedure against an isolated restored
database/new broker, verifying feed lineage/retention, stable identities, canonical
deduplication and Journey/Funnel/KPI effects before changing live state. Include
non-feed legacy data limitations. Do not treat the backup's handoff cursor as a
processing-safe checkpoint or silently reset it to zero. Historical pre-feed Kafka
messages are not recreated; their PostgreSQL projections remain intact. Do not
claim Kafka archive restoration for those legacy messages.
