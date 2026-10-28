# CDC-10 slot-loss rebaseline rehearsal — 2026-10-28

## Scope

The operator chose **new snapshot epoch with an explicit historical gap** for
the CDC-10 shadow experiment. This is a recovery policy for the isolated
reference clone, not permission to replace `order.placed` or activate CDC on
live Medusa. The test reused the retained, stopped
`funnelmetry_cdc_shadow_cdc10` project at `/srv/KLTN/cdc-shadow-cdc10`. The old
slot `funnelmetry_cdc_shadow` was already `lost` and its 103 projected active
orders remained separate. The old connector was stopped through Kafka Connect
REST; its configuration, topic, Kafka offset and volumes were retained.

`probe-cdc10-rebaseline.py` created new connector
`cdc-shadow-medusa-rebaseline-cdc10-epoch2`, slot
`funnelmetry_cdc10_epoch2`, topic prefix `cdc_shadow_medusa_epoch2`, and a
mode-600 ownership/quality record in `private/cdc10-rebaseline-epoch2.json`.
The record identifies epoch 1 as `INCOMPLETE` and epoch 2 as a
`CURRENT_STATE_FROM_REBASELINE` **candidate**. A new connector name also gives
it a separate Kafka Connect offset identity. No old offset was reset and no
`no_data` connector was resumed after the slot loss.

## Permission/column finding

The first `snapshot.mode=initial` attempt failed with `permission denied for
table order`. The earlier `no_data` path could stream the publication without
reading existing rows. On this clone only, the operator granted `SELECT` on
the same seven approved columns across `order`, `order_cart` and `cart`.
That alone was insufficient: the connector's initial snapshot tried to read
the full table. Adding an exact `column.include.list` to the new connector
made the snapshot succeed without granting broad table SELECT. The probe
rejects any snapshot payload with columns outside that allowlist. This
column filter is a required part of any future installer recovery profile;
publication columns alone do not define the snapshot read scope. See the
[Debezium PostgreSQL connector documentation](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)
for `initial` and `column.include.list` behavior.

The first draft validator expected only `true`/`last` snapshot markers.
Observed Debezium 3.6 markers on the three topics also included `first`,
`first_in_data_collection` and `last_in_data_collection`; the validator was
corrected before accepting the baseline. The final global `last` marker was
present. No raw CDC payload or credential was copied into this evidence.

## Runtime observations

| Check | Result |
|---|---:|
| Old slot after recovery | `lost`, inactive |
| New slot after recovery | `reserved`, active |
| Snapshot rows | `order` 105, `order_cart` 105, `cart` 106 |
| ID/link and deleted/completed predicate reconciliation to frozen clone | PASS |
| Baseline active order–cart pairs | 105 |
| Snapshot rows interpreted as new ON facts by probe | 0 |
| Baseline state SHA-256 | `2b78e6aaa116408df749f7266948e525ad8ed2113bf48967e7204ecef4c96dab` |
| Post-snapshot synthetic checkout | `order_01M5ZA1KE9FD3AJR7GRXP3FVCN` |
| Post-snapshot active pairs | 106 |
| New ON / OFF since baseline | 1 / 0 |
| Stream transactions with END counts matching row records | 5 |
| Current state reconciliation to clone | PASS |
| Current state SHA-256 after checkout | `7e9fcb8c2a225427ecdf53344d8c6473fd28174e94b6fd2a4064519fe6b50cd4` |
| Same check after Connect restart | PASS, same digest and one ON |
| Live Medusa after test | `wal_level=replica`, 0 replication slots |

## Kafka outage after the new baseline

Kafka in the CDC-10 project was stopped while Connect and the cloned Medusa
backend remained running. A second synthetic checkout completed as
`order_01M5ZAFJE1178BSRG49X5YVEQ5`; the recovery gate failed while Kafka
was unavailable. Immediately after broker restart, it still rejected a
source-versus-topic mismatch instead of claiming catch-up prematurely. A
later rerun passed without changing the connector lineage: 107 active pairs,
2 post-snapshot ON, 0 OFF, 10 stream transactions with matching END counts,
and current-state SHA-256
`5d6227a3bc1018c787a5a14f2aa5df4888974484df01469665626394b5bdb861`.
The new slot was `reserved` and active after recovery; observed retained WAL
was 545,752 bytes with `safe_wal_size` 284,072,768 bytes. This was a short
controlled broker interruption, not a long-outage SLO or throughput test.

The probe materializes the snapshot in memory and compares IDs, order–cart
links and timestamp nullness predicates against a read-only repeatable-read
source query while the cloned backend is stopped. It does not compare raw
timestamp values. It then materializes later topic rows, validates transaction
END counts and checks the resulting current state against source. This proves
the bounded **semantic rebaseline** for these records. It does not create a
durable epoch 2 mapper outbox, analytical sink or published metric. The 103
old projected orders and 105 new snapshot orders are deliberately not
interpreted as two additional historical conversions: one missed synthetic
order is known to be in the gap, and another source-only ID remains
unclassified against the old post-activation coverage.

## Remaining gate

CDC-10 is **IN_PROGRESS**. The snapshot probe still needs a versioned,
durable mapper/sink and metadata binding with `coverage_epoch_id`, a blocked
quality state during rebuild, exact offset checkpoint and replay tests. The
snapshot interruption, partial capture, duplicate boundary and second
slot-loss cases have not been run for epoch 2. The short Kafka interruption
above does not prove durable mapper/sink replay. Resource samples taken
after snapshot do not measure its peak; no sustained/flash-sale load or
approved SLO/WAL budget has been established. The old epoch cannot be a
rollback target after its slot is lost. None of these gaps permit silent
promotion to live analytics or replacement of the native adapter.

All CDC-10 containers were stopped after the test. Protected files, slots,
topics and volumes were retained. The earlier automatic review rejected
`docker compose down -v --remove-orphans` because deleting the cloned
PostgreSQL volumes lacked explicit approval; no alternate deletion was made.
