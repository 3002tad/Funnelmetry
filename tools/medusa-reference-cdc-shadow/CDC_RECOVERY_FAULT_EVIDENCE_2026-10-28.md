# CDC shadow: Connect/Kafka outage and missing slot — 2026-10-28

## Scope and provenance

All fault injection ran in the disposable, internal-only Compose project `funnelmetry_cdc_shadow_recovery1` on VPS `kltn`, using a read-only clone of live Medusa PostgreSQL. The outage cases used installer source archived from pinned Pipeline commit `cc9d9d863e1a7e3ec3f28584f0d3c9d6789f3f6f` and the Medusa-generated non-secret profile SHA-256 `f1ae4d39379887f77a2514e49c85bcfaf71736d8a83741b4d52b9f561dfb1ec1`.

Code review found that the pinned installer could accept an owned installation after its replication slot disappeared: `apply` did not require the previously owned slot, and `verify` ignored a missing-slot return value. Before the destructive slot-loss probe, a local, **uncommitted** guard was copied into this test project. The guard rejects a missing owned slot before starting Connect, requires the slot during `verify`, and rejects `wal_status` `unreserved` or `lost`. Six local installer unit tests passed. The slot-loss result below applies to this patched candidate, not to the pinned `cc9d9d8` release.

## Bounded outage observations

| Scenario | Slot while producer wrote | Retained WAL bytes at observation | `safe_wal_size` bytes | Fact topic / sink offset after catch-up | Result |
|---|---|---:|---:|---:|---|
| Baseline checkout | active, `reserved` | — | — | 1 / 1 | PASS |
| Connect stopped, one checkout | inactive, `reserved` | 115,576 | 284,865,256 | 2 / 2 after Connect restart | PASS; no duplicate or state mismatch |
| Kafka stopped, one checkout | inactive, `reserved` | 157,584 | 284,819,696 | 3 / 3 after Kafka and Connect recovered | PASS; no duplicate or state mismatch |

The retained-WAL figure is `pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)`, **not** the physical `pg_wal` directory size. During the Connect outage it rose from 70,072 to 115,576 bytes; during the Kafka outage it rose from approximately 112,080 to 157,584 bytes. The slot stayed `reserved`; the limit configured for the clone was `max_slot_wal_keep_size=256MB`. After the slot-loss test, `pg_ls_waldir()` reported two WAL segments totalling 33,554,432 bytes. This is a post-test observation, not a measured peak during either outage.

After each restart, the first mapper/sink verifier invocation could return `PASS` for the *previous* projected set while the new checkout was still in flight. The raw order topic and fact topic later advanced, and a second invocation showed the expected `2/2` and `3/3` offsets. Existing verifiers compare projected state, fact contents and sink offsets; they do **not** prove source completeness by themselves. Recovery acceptance therefore needs an expected source-order/LSN checkpoint in addition to these verifiers.

## Missing-slot probe on clone

With three facts committed and Connect stopped, a fourth synthetic checkout succeeded in the cloned Medusa backend. The inactive replication slot was then deliberately dropped **only from the clone**. The patched installer returned nonzero from `apply` with `owned shadow replication slot is missing; refusing automatic recreation`; `verify` returned nonzero with `owned shadow replication slot is missing; CDC verification failed`. The slot count remained zero, Connect remained stopped, and the fact-topic end offset remained three. The fourth checkout was intentionally **not** described as captured or recovered.

The test project, its private env files, network and volumes were removed. The pre-existing `funnelmetry_cdc_shadow` stack remained running; live Medusa PostgreSQL still reported `wal_level=replica`.

## Limits and next gate

These were short, controlled outages with a small number of synthetic checkouts. They do not establish a long-outage duration, WAL exhaustion threshold, load/latency SLO, or a procedure to restore data after an actual lost slot. A slot-loss recovery path must explicitly reconcile from a new source snapshot/checkpoint and versioned replay; recreating a slot with `snapshot.mode=no_data` cannot be treated as continuous capture. The fail-closed guard must be committed, CI-tested and pinned before reuse. Source-completeness verification and alert thresholds remain CDC-10 work.
