# CDC-10 second slot loss, interrupted snapshot and shadow resource budget

Date: 2026-10-28. Scope: **isolated clone only**, Compose project
`funnelmetry_cdc_shadow_cdc10` on the 8-vCPU/16-GB VPS. The live Medusa
PostgreSQL and Pipeline were not targets. `order.placed` remains the live
conversion authority; no CDC profile/metadata was published to live analytics.

## Bounded load and mapper correction

The first 120-checkout run (five concurrent clients) fully reconciled but
exposed an O(transactions × all orders) mapper loop. It achieved 0.884
orders/s, with CDC source-END → sink-ingest lag p95 83.991 s and a 110.49 s
batch catch-up observation. That code is not an acceptable load baseline.

The mapper now derives affected orders from changed order, order-cart link and
cart IDs, including both sides of a changed relation. After rebuild, the
second 120-checkout run, with the same concurrency, yielded:

| Measure | Observed |
|---|---:|
| Successful synthetic checkouts | 120/120 |
| Workload duration / throughput | 129.129 s / 0.929 orders/s |
| Checkout p95 | 6.013 s |
| CDC source-END → sink-ingest lag p95 / maximum | 1.357 / 1.500 s |
| Workload end → full source/mapper/sink verifier PASS | 26.098 s |
| New transition records | 120, total 183 → 303 |
| Fact topic / sink offset | 712 / 712 |
| Maximum retained WAL / minimum `safe_wal_size` (sampled) | 6,241,880 / 264,984,096 bytes |
| Slot status, sample errors | `reserved`, 0 |
| Sampled backend CPU/RAM peak | 193.37% / 1,121.28 MiB |
| Sampled Kafka CPU/RAM peak | 197.68% / 663.6 MiB |
| Sampled Connect CPU/RAM peak | 1.75% / 540.7 MiB |
| Sampled recovery mapper CPU/RAM peak | 13.7% / 35.36 MiB |

The earlier 60-checkout run also reconciled at 0.86 orders/s, but its 8.484 s
lag p95 used the old mapper and is not pooled with the corrected run. Docker
stats are samples, not continuous peaks. These are two-minute, single-host
measurements, not a flash-sale or multi-hour capacity claim.

## Second lost slot and new snapshot

With Connect stopped, one synthetic checkout completed on the clone. The
epoch-2 fact topic remained at offset 712. Checkpointed WAL pressure on the
clone reduced `safe_wal_size` to 16,689,072 bytes after 16 segment switches;
after 20, slot `funnelmetry_cdc10_epoch2` became `lost`. The verifier persisted
`BLOCKED_BY_QUALITY` and the guarded analytical view returned zero rows. It
did not recreate the slot, advance the fact offset or turn the missed order
into a claimed historical transition.

The clone-only slot-capacity overlay retained the two lost slots for audit and
allowed new lineages. A first epoch-3 snapshot finished before the attempted
kill; **that attempt is not counted as an interruption test**. To create a
measurable partial snapshot, 120,000 unlinked synthetic carts were added to
the frozen clone; they have no order links and cannot create order ON facts.
The epoch-4 connector was SIGKILLed after Kafka had emitted part of its
initial snapshot, then restarted. Debezium restarted the snapshot, as its
[PostgreSQL connector documentation](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)
specifies for an interruption before snapshot completion.

| Table | Source unique rows | Snapshot topic records | Duplicate snapshot records | Final unique rows |
|---|---:|---:|---:|---:|
| `order` | 409 | 818 | 409 | 409 |
| `order_cart` | 409 | 818 | 409 | 409 |
| `cart` | 120,410 | 182,945 | 62,535 | 120,410 |

The final snapshot marker appeared and epoch-4 slot was `reserved`; epoch-2
remained `lost`. The mapper's versioned epoch-4 probe consumed the complete
topic, persisted exactly 409 orders, 409 links and 120,410 carts, marked
`snapshot_last_seen=true`, and retained **zero outbox/business ON records**
while `BASELINING`. Identical snapshot rows from the repeated attempt were
deduplicated by table/row ID and payload; a changed payload is rejected as an
unsafe retry. Resetting the epoch-4 consumer group to offset zero left the
same snapshot counts and zero outbox records after catch-up.

The epoch-4 mapper is a **probe before baseline activation**. It has no
analytical sink or published metadata. The durable epoch-2 baseline/sink
reconciliation remains the prior recovery evidence. Together these tests
prove fail-closed second loss and duplicate-safe snapshot ingestion, not an
automatic cutover to epoch 4.

## Shadow budget decision

For this **specific clone** the bounded operating envelope is:

- Admission target: at most **0.8 successful checkout/s**, five concurrent
  synthetic clients, for runs up to two minutes. This is below the measured
  0.929 checkout/s run and leaves a small margin; longer bursts are unverified.
- Acceptance observation: source-END → sink-ingest lag p95 at most **5 s**,
  checkout p95 at most **8 s**, and full post-workload reconciliation within
  **30 s** for the 120-checkout drill. A failure blocks claims and requires
  investigation; no automatic capacity claim follows.
- Clone slot cap: `max_slot_wal_keep_size=256MB`. Alert at
  `safe_wal_size < 128 MiB`; block analytical readiness below **64 MiB** or
  when `wal_status` is `unreserved`/`lost`/unknown. The verifier implements
  the 64-MiB guard; the 128-MiB warning is reported separately.
- Retention is a **byte budget**, not a guaranteed outage duration. The clone
  kept about 665 kB over the previous six-minute Connect outage, while only
  20 forced 16-MiB WAL switches invalidated a 256-MB slot. A time-based
  guarantee must be based on measured peak WAL rate, chosen outage+catch-up
  duration, segment/checkpoint overhead and free-disk reserve.

The production/flash-sale budget remains **UNVERIFIED** under DEC-135: this
single-VPS probe does not measure multi-hour demand, multiple source DBs or
high-rate catalog/inventory CDC. Before production sizing, choose a peak
workload and recovery duration, then set slot cap and disk reserve from
`peak WAL bytes/s × (outage + catch-up) × safety factor`, including WAL segment
rounding and concurrent slots. No live PostgreSQL setting is changed by this
shadow budget.

The later [v2 semantic approval](../../../System_Backbone/docs/governance/REFERENCE_MEDUSA_ORDER_RECORDED_STATE_V2.md)
records these results as shadow evidence; it does not activate the candidate
metadata or grant a live source cutover.

## Final isolation state

The CDC-10 recovery timer was disabled, and all containers in the test Compose
project were stopped without deleting volumes, slots, topics or protected
checkpoints. The epoch-2 quality row remained `BLOCKED_BY_QUALITY` and its
guarded view returned 0. The epoch-4 mapper stayed `BASELINING`, with no
outbox, so this probe cannot be mistaken for an active analytical source.
The live Medusa PostgreSQL was checked separately: `wal_level=replica` and
zero replication slots. Reusing this clone requires a new operator review of
the retained epoch-3/4 probe slots and their WAL headroom; do not start all
connectors blindly.
