# Source Connector — opt-in runtime (stage 3)

Implements part of Master v0.3.11 and
`System_Backbone/docs/implementation/CORE_IMPLEMENTATION_CONTRACTS_V1.md`.
Runtime entry point is available; **not activated against the real Source**.

Implemented:

- HTTPS Bearer-authenticated long polling with timeout, response-size bound,
  redirect rejection and sanitized errors. Defaults are development settings,
  not benchmarked SLOs.
- Explicit pinned feed identity and cursor; no implicit start-at-latest or discard.
- Whole-batch validation, non-gapless ordered sequences, retention-floor checks,
  empty-batch cursor preservation and feed regression detection.
- Single-flight sequential publishing: advance cursor only after publisher ACK.
  Stop on publish/save failure; retry after ACK/save failure may duplicate records.
- Stable feed-record ingestion ID and existing canonical-normalizer raw message
  shape; source envelope excludes transport fields. `received_at` is Pipeline
  handoff time; `source_accepted_at` is separate source evidence.

Adapter contracts:

- `feedClient.read({event_feed_id, after_seq, limit})` returns the Source feed shape.
- `publish(message)` must resolve **only after durable Kafka broker ACK**.
- `cursorStore.load()` returns an explicitly initialized cursor.
- `cursorStore.advance(expected, next)` must persist atomically with compare-and-set.
  A single active runtime owner/lease is required; the in-process busy guard alone
  does not coordinate multiple replicas.

Adapters now implemented (unit-tested with injected pg/KafkaJS clients):

- `postgres-cursor-store.js`: dedicated session advisory lock per connector ID,
  explicit bootstrap, feed identity pinning, monotonic compare-and-set updates,
  fail-closed connection loss and session destruction on close. Same-feed parallel
  replicas must use the same connector ID. The caller must close a failed store.
- `kafka-publisher.js`: transactional raw + accepted receipt publish with `acks=-1`;
  completion means transaction commit, not merely HTTP acceptance or send enqueue.
  Any Kafka failure poisons this publisher; recreate the transactional producer
  before retry. Receipt consumers retain their existing idempotency contract.
- `019_source_connector_cursors.sql`: additive migration for handoff progress.
  Not applied to a running database by this change. The normal Compose migration
  service will apply it when explicitly run on the next deployment.

Runtime wiring must use a stable unique Kafka transactional ID per connector,
acquire PostgreSQL ownership before connecting that producer, and stop/close both
on ownership loss. The pre-publish session check reduces stale-owner work but is
not an atomic PostgreSQL/Kafka fence; duplicates remain possible and expected.

Runtime now wires pg/KafkaJS, ownership-before-producer startup, sanitized errors,
bounded dependency retries and `/healthz` (process endpoint) versus `/readyz`
(last successful poll). Permanent protocol/auth errors enter BLOCKED until an
operator corrects configuration/restarts. Development timing defaults are not SLOs.
The process health endpoint is not proof of poll progress or a completed watchdog.

Not implemented/claimed yet: processing-safe checkpoints, RESTORE_REPLAY or live-source
acceptance. Never use the handoff cursor as a downstream processing checkpoint.
Do not wire this library into the demo launcher until these adapters and recovery
contracts are implemented and tested. No remote feed is contacted by unit tests.

Tests:

```powershell
cd workers/source-connector
npm ci --ignore-scripts
npm test
```

## Isolated integration check

From the repository root, with Docker running:

```powershell
docker compose -p funnelmetry-connector-test -f workers/source-connector/test/compose.integration.yml up --abort-on-container-exit --exit-code-from test --attach test
```

Uses separate PostgreSQL/Kafka containers, test-only credentials and topics;
PostgreSQL data is temporary. Checks migration rerun, exclusive ownership, resume,
real transactional raw/receipt publish, and simulated crash after ACK before save.
The Event Feed is injected, so this does not test public HTTPS. The check now runs
the real normalizer and ledger Kafka runtimes after publishing the raw backlog.

Verification 2026-09-18: 32 unit tests passed; isolated PostgreSQL 15/Kafka 3.9.1
integration check exited 0. It observed raw sequences `[1,1,3]` after the injected
ACK/save failure, matching 3 committed receipts and persisted cursor 3. Test
containers stopped afterwards. No migration or event was applied to the private
demo database/topics. This is adapter integration evidence, not live-source or
normalizer/ledger end-to-end evidence.

Verification 2026-09-19: expanded integration passed with 4 raw deliveries
`[1,1,3,5]`, 4 accepted receipts, 2 unique canonical rows and 1 quarantine event
(unknown mapping). Cursor 5 means Kafka handoff only. Three canonical-persisted
handoffs include the replay; the replay reuses the first stored document.
Changed business content still raises a ledger conflict. Unit regressions:
32 connector + 16 normalizer + 12 ledger tests passed.

This test first reproduced a real replay bug: processing timestamps differed and
the immutable ledger rejected the replay. The ledger now ignores only
`ingested_at`/`normalized_at` for duplicate comparison, preserving the first
document for downstream handoff. All other fields remain conflict-checked.
A fresh normalizer consumer group now reads retained raw records; existing groups
still resume committed offsets. No manual offset bootstrap is used by this test.

Kafka emitted transient coordinator/transaction retry messages during startup;
the test completed with no runtime crash callback. This is not a latency/SLO,
long-running reliability or downstream Journey/KPI duplicate-effects benchmark.

## Opt-in deployment (not run automatically)

Copy `runtime/source-connector.env.example` to ignored `runtime/source-connector.env`.
Supply approved feed identity, separate Bearer token, URL and initial cursor. Never
silently start at the latest sequence. `NORMAL` is only safe with the original Kafka
cluster; `RESTORE_REPLAY` deliberately fails until safe-checkpoint recovery exists.

Use `infra/compose.source-connector.yml` after `infra/compose.v2.yml`, selecting
profile/service `source-connector`. This overlay does not publish any connector port.
Review base PostgreSQL host-port exposure before deployment, or retain the existing
private overlay. Do not run the entire default Compose stack unintentionally.
The existing demo launcher is unchanged; it still starts legacy containers.

Next: real-service integration tests through the
normalizer/ledger, explicit initial cursor choice and authenticated reference-path
long-poll tests. Keep actual tokens in ignored runtime env/secret storage.
