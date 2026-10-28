# CDC reference installer runtime rehearsal — 2026-10-27

## Scope

The approved `reference.medusa.order_recorded_state.v1` profile was installed in a fresh, isolated Docker Compose project on VPS `kltn`: `funnelmetry_cdc_shadow_installer1`. The existing `funnelmetry_cdc_shadow` experiment and live Medusa/Pipeline stacks were not changed. This is shadow development evidence, not production activation or adapter cutover.

## Procedure and observations

1. Copied a clean installer directory and the Medusa CI generated, non-secret `funnelmetry/cdc-reference-shadow.json` profile. `plan` accepted the exact profile SHA-256 `f1ae4d39379887f77a2514e49c85bcfaf71736d8a83741b4d52b9f561dfb1ec1` and isolated project name.
2. `prepare-private.py` created local mode-600 env files. A first immediate clone attempt raced PostgreSQL startup; `clone-db.py` was changed to wait up to 30 seconds for `pg_isready`. The subsequent read-only source dump restored into the empty private PostgreSQL with logical WAL.
3. `install-reference.py apply` returned `installed`. `verify` returned `pass` for PostgreSQL, Kafka, Connect connector/task, projection DB, mapper, analytical DB and sink. All networks were internal and no port was published.
4. Started the private Medusa backend, Redis and Source Ingress and made one synthetic Store API checkout. The clone returned one order. `verify-reference-mapper.py` returned `PASS`: one active order, one outbox fact, one Kafka fact record, zero pending outbox, zero state mismatch. `verify-reference-analytics.py` returned `PASS`: one unique fact, one current ON state, metric count one, sink offset equal to topic end offset one, metadata `SHADOW_ONLY` version `1.0.0`.
5. A second `apply` and `verify` passed without creating another fact. `rollback` returned `stopped`, stopped the mapper and analytical sink, and deleted the owned connector while retaining slot, publication, topics, volumes and credentials. In a second fresh-clone rehearsal, `rollback` followed by `apply` and `verify` also passed: the owned `STOPPED` state allowed reuse of its retained slot and Kafka volumes. The pre-existing `funnelmetry_cdc_shadow` containers remained running.
6. After each rehearsal, the test project and its named volumes were removed with `docker compose down -v`; the absolute test directory was verified and removed. No test project resources remained.

## Limits

- The synthetic checkout proves one data path through the packaged shadow stack. It does not establish event-rate, latency, WAL-retention, slot-loss or production recovery SLOs.
- This 2026-10-27 rehearsal verified rollback→apply infrastructure readiness but did not create a second checkout after resumption. The [2026-10-28 follow-up](INSTALLER_RESUME_DATA_EVIDENCE_2026-10-28.md) closed that data-level gap in a separate shadow project. Neither rehearsal enabled CDC on live Medusa.
- The native `order.placed` subscriber remains the live conversion authority. The reference current-state fact is count-only and can be retracted.

## Local checks

- Python installer tests: 4/4 passed.
- Medusa CI planner tests: 11/11 passed.
- `git diff --check` passed for Pipeline and Backbone edits.
