# CDC-10 durable lost-slot recovery candidate (2026-10-28)

## Scope and decision

This is a **shadow-only** recovery on the isolated `funnelmetry_cdc_shadow_cdc10`
Medusa clone. The approved `reference.medusa.order_recorded_state.v1` and the
live `order.placed` subscriber are unchanged. The lost v1 slot's missing WAL
cannot be recovered. The new candidate contract is
`reference.medusa.order_recorded_state.v2`, epoch `cdc10-epoch2`, with a
permanent `historical_gap_status=INCOMPLETE`. Its baseline is current state,
not a set of historical order-placement events.

The recovery mapper, outbox, Kafka topic, analytical sink and metadata use
separate versioned storage. The old slot, v1 databases and fact topic remain
available for audit. The source is still the clone, never the live Medusa DB.

## Durable sequence and observations

1. An independent semantic checkpoint from the Debezium initial snapshot was
   checked against the durable mapper's three-table snapshot counts and digest.
   It contained 105 orders, 105 links and 106 carts. Baseline activation was
   atomic and emitted 105 `BASELINE` records plus one completion marker; it
   emitted **zero** `ON` transitions.
2. Two later synthetic checkouts produced two `TRANSITION` records. Source,
   mapper and sink agreed on 107 active orders. The v2 fact topic and sink were
   at offset 110. Four mapper input topics, transaction END prefix, outbox,
   source row state and separate metadata were reconciled.
3. With both workers stopped, both Kafka consumer groups were reset to offset
   zero. After restart, all checks passed again: 105 baseline records,
   2 transitions, 107 source/mapper/sink orders and fact offset 110. The
   identical state digest was
   `3634d2e2f9139304dc0711358b0becf509f6f1743f386bcb4147a78f3439af6b`.
   The mapper's PostgreSQL offsets and the sink's inbox prevented duplicate
   logical effects on replay.
4. Stopping the isolated Connect service made the verifier fail closed:
   `recovery_quality_state=BLOCKED_BY_QUALITY`, reason
   `VERIFIER_DEPENDENCY_UNAVAILABLE`; the readable view returned zero rows.
   After restarting Connect and reconciling, the view returned 107 rows.
5. Expiring `verified_at` by 121 seconds made the readable view return zero
   rows even while the previous quality status remained `CURRENT_STATE_READY`.
   A new successful reconciliation reopened it. Metadata version
   `2.0.1-shadow` binds to the guarded view, not the raw state table.
6. The installed 30-second systemd timer was fault-tested on the clone. With
   Connect stopped, it persisted `BLOCKED_BY_QUALITY` and the view returned 0.
   After Connect restarted and its task became RUNNING, a later timer cycle
   passed all checks and restored `CURRENT_STATE_READY`. Journal output showed
   both failure and recovery; the service uses about 27 MB peak memory per
   verification run in this small test.

The read lease is 120 seconds. An operator must run the verifier more often
than that (recommended every 30 seconds) for continuous availability. Failure
to run it makes the analytical view empty. The raw tables remain available for
forensics only and must not be bound to Dashboard metrics. The verifier writes
quality only to the isolated recovery analytical database.

## Runbook for this candidate

Use `/srv/KLTN/cdc-shadow` with
`COMPOSE_PROJECT_NAME=funnelmetry_cdc_shadow_cdc10`. The independent checkpoint
is at `private/cdc10-rebaseline-epoch2.json`, mode 600. Start the isolated
Compose base plus `compose.recovery-epoch.yml`; keep the legacy v1 containers
and volumes. Run:

```bash
COMPOSE_PROJECT_NAME=funnelmetry_cdc_shadow_cdc10 \
  python3 verify-recovery-epoch.py --timeout-seconds 60 --write-quality
```

For repeated checks, use the supplied `funnelmetry-cdc10-recovery-verify`
systemd timer/service. They run the exact command every 30 seconds and are
pinned to this clone path/project. The command exits nonzero on an unavailable
dependency or failed reconciliation; retain journal output for audit. Stop and
disable the timer before intentionally shutting down the clone. Never use
`--remove-orphans` on this project. On a **second** lost
slot, block the current epoch, preserve its offsets/topic/DB, and start a new
versioned epoch with its own slot, prefix, topic and snapshot. Do not reset the
lost slot's offset or relabel the historical gap as complete.

## Remaining acceptance work

This candidate is not a live cutover. The later
[second-loss, interrupted-snapshot and load-budget evidence](CDC10_SECOND_LOSS_SNAPSHOT_LOAD_BUDGET_2026-10-28.md)
closes those **shadow** fault/measurement gates. DEC-119/135 subsequently approved
the [v2 semantic contract](../../../System_Backbone/docs/governance/REFERENCE_MEDUSA_ORDER_RECORDED_STATE_V2.md)
for shadow development. The metadata is still unpublished in the live Pipeline,
and the production/flash-sale budget remains unverified. No source data was written to the live Pipeline, and
no live Dashboard read path changed.
