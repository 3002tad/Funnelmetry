# CDC slot-loss recovery candidate — shadow only, 2026-10-28

**Status:** operator selected the new-snapshot-epoch/explicit-gap recovery
policy for CDC-10 shadow work. A bounded initial-snapshot semantic rehearsal
has passed; see [epoch 2 evidence](CDC10_REBASELINE_EVIDENCE_2026-10-28.md).
The durable epoch 2 mapper/sink and metadata binding are not implemented.
DEC-119/135 and `reference.medusa.order_recorded_state.v1` remain in force;
the live `medusa.order_placed` adapter remains authoritative.

## Why a new lineage is necessary

The [CDC-10 WAL-retention test](CDC10_LAG_LOAD_RETENTION_EVIDENCE_2026-10-28.md)
proved `wal_status=lost` on a disposable clone and found a synthetic order in
source but absent from the shadow sink. `snapshot.mode=no_data` cannot replay
WAL that PostgreSQL has removed. Restarting the same connector or deleting its
offset/slot would silently skip the gap. The old slot, raw Kafka topics,
mapper inbox/outbox and sink offsets must be preserved as an audit boundary.

## Proposed recovery contract: current-state rebaseline

1. Stop CDC consumption and mark the old coverage epoch `INCOMPLETE_FROM_LSN`
   at the first unverified source position. Do not publish a zero or an
   apparently continuous current-state metric from the old epoch. Keep the
   failed slot and old topics/volumes available for diagnosis until retention
   policy permits their disposal.
2. Allocate a **new** source/slot/topic/offset lineage, with its own
   `coverage_epoch_id`, connector config version and snapshot checkpoint.
   The source owner approves the three-table/seven-column publication and
   replication privilege again; the installer must refuse a foreign or reused
   slot. A Debezium `initial` snapshot on the new connector is the candidate
   baseline mechanism. Debezium documents that an initial snapshot reads the
   captured table rows and then resumes WAL streaming from its snapshot
   position: <https://debezium.io/documentation/reference/stable/connectors/postgresql.html>.
3. Stage `op=r` snapshot rows as **baseline entity state**, not `ON` changes or
   `order.placed` occurrences. Snapshot coverage is complete only after the
   connector reports snapshot completion and the mapper has durably processed
   every selected table/key. Then process subsequent committed row changes in
   transaction order under the new epoch. Duplicate rows at the
   snapshot→stream boundary must converge without a second logical effect.
4. Reconcile source/current-state IDs and counts at a documented barrier,
   including the intentionally missed synthetic order. Missing rows, unknown
   table coverage, an incomplete snapshot or an invalid slot keep the new epoch
   blocked. Publish a new current-state binding only after the source snapshot,
   mapper, fact output and analytical sink agree. Keep old epoch history
   queryable with its gap label.
5. Historical transitions that occurred solely in the lost WAL window cannot
   be reconstructed from current rows. The new epoch therefore supports a
   **current state from rebaseline onward** claim. It must not assert a
   continuous ON/OFF history, an immutable conversion count or revenue for the
   gap. A stronger historical guarantee requires a separately retained source
   event/archive or a restorable WAL backup spanning the gap.

This changes coverage semantics and metadata. It needs a separately versioned
reference profile/contract and a DEC-119/135 decision before activation. The
existing `no_data` v1 mapper cannot be reused unchanged: it rejects snapshot
`op=r` records and has no coverage epoch in its keys or sink binding.
An `initial` snapshot also requires column-level `SELECT` and an exact
Debezium `column.include.list`; the publication's column filter alone did not
limit the connector's snapshot read on the tested clone.

## Shadow acceptance rehearsal required for CDC-10

- Reproduce `lost` with an order present in source and missing from old sink;
  assert the current installer fails closed and no old connector restarts.
- Start a fresh, isolated new-lineage connector with initial snapshot; check
  that its baseline includes the missed order but emits **zero** new ON facts
  for snapshot-only rows.
- Create a checkout after snapshot completion; expect one new current-state ON
  in the new epoch, source transaction END processed, mapper/sink count and
  offset reconciled. Repeat connector/mapper restart and raw replay without
  additional logical effects.
- Inject snapshot interruption, partial table capture, duplicate boundary
  rows, Kafka outage and another slot loss; verify incomplete quality and no
  automatic promotion. Record snapshot duration, source CPU/RAM/IO/WAL, lag,
  retained WAL and disk peak. Acceptance thresholds must be configured from
  an approved resource/SLO budget, not inferred from the 30-order probe.
- Rehearse rollback of a **new epoch before promotion** by stopping only its
  consumers; preserve old evidence. After promotion, a lost old slot is not a
  valid rollback destination. Define what the UI/API shows while all epochs
  are blocked.

If the product instead requires complete historical reconstruction, this
candidate is insufficient. The owner must provide a replayable source history
or WAL backup for the lost interval, then prove order and identity continuity
before any new epoch can claim historical coverage.
