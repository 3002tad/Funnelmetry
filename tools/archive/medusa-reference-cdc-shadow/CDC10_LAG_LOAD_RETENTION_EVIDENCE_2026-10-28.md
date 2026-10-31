# CDC-10 shadow: source catch-up, bounded load and WAL retention — 2026-10-28

## Scope and provenance

All tests ran on VPS `kltn` in the new disposable Compose project
`funnelmetry_cdc_shadow_cdc10` at `/srv/KLTN/cdc-shadow-cdc10`. Its PostgreSQL
database was cloned through the existing read-only `clone-db.py`; the clone,
Kafka, Connect, mapper and analytical sink used private Docker volumes and an
`internal` network with no published ports. Live Medusa and Pipeline were not
test targets. Pipeline source HEAD was
`cc9d9d863e1a7e3ec3f28584f0d3c9d6789f3f6f`; the existing local,
uncommitted missing/lost-slot installer guard and the new CDC-10 probes were
copied only into this test directory. The generated Medusa profile SHA-256 was
`f1ae4d39379887f77a2514e49c85bcfaf71736d8a83741b4d52b9f561dfb1ec1`.
The clone used `max_slot_wal_keep_size=256MB` and `snapshot.mode=no_data`.

The test project's backend image ID was
`sha256:240e7f7abc11a103fa2cd23825f2f1783b690f66c09e956f2ea4e73b4ad92b55`,
Connect image ID was
`sha256:ef19acc1188babedc8bee6e890bb6e429903b919c07f5ad509befaec5bcdfb14`,
and Kafka image ID was
`sha256:4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed`.
This identifies the tested local images, not a supported live release.

## Source-completeness gate for synthetic orders

`verify-cdc-catchup.py` checks expected synthetic order IDs in the cloned
Medusa database; reads the current row-version transaction IDs for each order,
order↔cart link and cart; requires their Debezium `END` records to be processed
by the durable mapper; and checks the order's active state in both mapper and
sink. It also requires a usable replication slot and no pending mapper END or
outbox rows. The optional LSN is a **pre-workload baseline**, not a snapshot of
`pg_current_wal_lsn()` after a checkout.

An initial implementation required the slot's `confirmed_flush_lsn` to cross a
post-checkout `pg_current_wal_lsn()`. It returned `WAIT` even though the order,
mapper and sink had converged: PostgreSQL may have written unrelated WAL after
the order's last captured transaction, and Debezium need not confirm that
position until a later record or heartbeat. The corrected gate uses the source
transactions themselves. The one-order baseline passed with three source
transaction IDs matched to processed END records. The new verifier is scoped to
fresh synthetic orders whose current row versions are observed; it does **not**
prove completeness for historical orders, changed/frozen rows, compensation,
all source tables, or a recovered slot after WAL loss.

## Six-minute Connect outage

The bounded outage probe stopped Connect, created 12 distinct synthetic
successful checkouts with concurrency 3, waited 360 seconds, then restarted
Connect in a `finally` block. During the outage the source-order gate correctly
failed on `connector_confirmed_baseline`, transaction END, mapper and sink.

| Observation | Value |
|---|---:|
| Outage duration measured before resume | 361.19 s |
| Synthetic orders created while Connect stopped | 12 |
| Retained WAL before resume | 664,512 bytes |
| `safe_wal_size` before resume | 284,334,680 bytes |
| Physical `pg_wal` at observed points | 33,554,432 bytes |
| Slot state during outage | inactive, `reserved` |
| Resume until source gate + mapper/sink verification completed | 96.59 s |
| Final projected orders/facts including baseline | 13 / 13 |
| Final Kafka fact records / distinct IDs | 13 / 13 |
| Final sink offset / fact topic end offset | 13 / 13 |
| Pending END/outbox, duplicate deliveries, state mismatches | 0 / 0 / 0 / 0 |

The 96.59 seconds include verifier execution and polling. They are a batch
completion observation, not a per-event p95 lag or a duration guarantee.

## Bounded checkout load

Two successful 30-checkout runs used concurrency 5 on the same clone and
product, one with Connect active and one with Connect stopped during checkout
and restarted afterward. `docker stats --no-stream` was sampled during the
checkout interval; maxima are sampled peaks, not a continuous profiler.

| Measure | Connect active | Connect paused during checkout |
|---|---:|---:|
| Completed synthetic checkouts | 30 | 30 |
| Workload duration | 34.87 s | 32.04 s |
| Observed throughput | 0.86 orders/s | 0.936 orders/s |
| Checkout p50 / p95 | 5.74 / 6.41 s | 5.13 / 6.05 s |
| Workload end → source gate + sink completion | 3.06 s | 86.48 s |
| Sampled backend max CPU / RAM | 228.35% / 588.8 MiB | 181.46% / 599.4 MiB |
| Sampled Medusa clone PostgreSQL max CPU / RAM | 44.92% / 105.7 MiB | 44.12% / 99.92 MiB |
| Sampled Connect max CPU / RAM | 5.51% / 573.2 MiB | stopped |
| Sampled Kafka max CPU / RAM | 11.16% / 416.2 MiB | 5.93% / 410.0 MiB |
| Final Kafka facts / sink offset | 43 / 43 | 103 / 103 |

Both valid runs had zero duplicate deliveries, pending END/outbox rows and
source-state mismatches. One **earlier** attempt at the paused-Connect run had a
Store API checkout error; it was excluded from paired throughput figures, and
the script restarted Connect. A subsequent single checkout and the full rerun
succeeded. The failed attempt may have left source changes; therefore the
second run's final offset 103 includes those changes and is not interpreted as
exactly 30 new facts. This is a small sequential, non-randomized experiment on
one VPS with varying warmup/background load. It does not establish a causal
overhead percentage or a flash-sale capacity limit.

## Actual WAL-retention loss on the clone

After the load tests, the probe stopped Connect, completed one more synthetic
checkout, then requested 20 WAL segment switches with checkpoints. It wrote no
business rows for WAL pressure; `pg_switch_wal` and a nontransactional logical
message were used only on the clone.

| Requested switches | Slot status | Retained WAL bytes | `safe_wal_size` bytes | Physical WAL bytes |
|---:|---|---:|---:|---:|
| 4 | `reserved` | 62,299,008 | 218,103,592 | 83,886,080 |
| 8 | `reserved` | 129,407,872 | 150,994,728 | 150,994,944 |
| 12 | `reserved` | 196,516,736 | 83,885,864 | 218,103,808 |
| 16 | `reserved` | 263,625,600 | 16,777,000 | 285,212,672 |
| 20 | `lost` | NULL | NULL | 167,772,160 |

The lower physical-WAL figure in the final row reflects checkpoint recycling
after the slot lost required segments; it is not evidence of recovery. The
patched installer rejected both `apply` and `verify` when `wal_status=lost`, and
left Connect stopped. The synthetic order created after Connect stopped was
**not** reported as captured. A `no_data` connector cannot fill that gap by
simply recreating a slot. PostgreSQL documents `safe_wal_size` and `wal_status`
for this purpose: <https://www.postgresql.org/docs/15/view-pg-replication-slots.html>.

Afterward, only the clone's source, mapper and analytical PostgreSQL containers
were restarted for a read-only comparison; Connect and Kafka stayed stopped.
The clone contained 105 currently eligible order IDs, while the mapper and
sink each held 103 active IDs. Set comparison found two source-only IDs and
zero sink-only IDs. The specifically recorded synthetic order created while
Connect was stopped was present in source and absent from sink. The other
source-only ID was not classified as a slot-loss effect because the clone
includes pre-activation data and a failed earlier load attempt. This proves a
real coverage gap but does not assign every discrepancy to the lost slot.
All three PostgreSQL containers were stopped again after this read-only check.

Follow-up: the operator chose a new snapshot epoch with an explicit gap. The
[separate epoch 2 rehearsal](CDC10_REBASELINE_EVIDENCE_2026-10-28.md) proves a
frozen-source snapshot baseline and one post-snapshot ON in a fresh lineage.
Its durable sink, metadata, fault matrix and budget gates remain open.

## Outcome and remaining recovery gate

CDC-10 has evidence for source-transaction catch-up in these synthetic cases,
a six-minute bounded outage, small checkout load and actual WAL-retention slot
loss with fail-closed behavior. It **does not yet have a verified recovery**
after slot loss. Versioned snapshot/rebuild, source coverage epoch, missed
transition policy and reconciliation against the authoritative source remain
open. Because `reference.medusa.order_recorded_state.v1` is post-activation and
`no_data`, a new current-state snapshot cannot silently become historical ON
facts or be appended to the same lineage. There is no basis to mark CDC-10
complete or enable live cutover yet.

The test Compose project is stopped with its volumes and protected files still
present. An attempted `down -v --remove-orphans` was rejected by the automatic
approval review because deletion of the cloned database/volumes lacked explicit
user approval; no alternative deletion was attempted. Live Medusa was checked
afterward: `wal_level=replica`, zero replication slots. The pre-existing
`funnelmetry_cdc_shadow` stack was not targeted.

**Later shadow evidence:** the durable epoch-2 mapper/sink and
[second-loss, snapshot-interruption and budget drill](CDC10_SECOND_LOSS_SNAPSHOT_LOAD_BUDGET_2026-10-28.md)
close the open shadow fault items above. This document remains the exact
record of the first bounded load and first slot-loss observations, not a live
production capacity claim.
