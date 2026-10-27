# Native `order.placed` → WAL message conformance probe — 2026-10-27

Status: **transport and normal-path semantics observed; sole-authority cutover blocked**.
This is DEC-135 isolated shadow evidence, not a production installer or a live
CDC deployment. A [shadow-only subscriber](shadow-order-placed-wal.cjs) was
bind-mounted through the opt-in `compose.wal-probe.yml` overlay into the already
built Medusa 2.19.0 backend image. It listens to
the native `order.placed`, reads Order↔Cart and monetary fields with Medusa Query
Graph, then calls `pg_logical_emit_message(true, ...)` through Medusa's existing
PostgreSQL connection. It writes no Medusa table, column or row. The existing
HTTP subscriber remained active **only in this shadow test** to compare events.

The subscriber emitted prefix `funnelmetry.shadow-order-placed.v1` into the
existing Debezium 3.6.3.Final main connector and isolated Kafka topic
`cdc_shadow_medusa.message`. The marker uses the same stable
`medusa:order.placed:<orderId>` event ID and versioned source type as the
current adapter; its payload contains order/cart IDs, occurred time,
15.51 EUR order total and amount semantics. It does **not yet carry the
adapter's item array**, so full payload conformance is not established.

| Shadow case | Native event/feed | CDC and WAL marker | Observation |
|---|---|---|---|
| Successful checkout `order_01M5YGQVE1MT4SBWHD7T1HMYDS` | One `medusa.order_placed`, seq 6 | One `op=m`, LSN 34736848, tx 1846 | Event ID, cart `cart_01M5YGQSDWCMG9Q9ESHZJKVH0A`, occurred time, `15.51`/`eur` matched; DB order remained `pending`. |
| Payment authorization failure `order_01M5YGT88NPHYA5C9PWYBAX509` | Zero | Zero markers; CDC saw order create and compensation delete | Row changes alone still cannot define placement. |
| Retry same cart, successful `order_01M5YGVEEW4MD4YVDF4Z6XR4G6` | One | One marker, LSN 34924936 | Repeating completion returned the same order and marker count stayed one. |
| Debezium connector stopped during checkout `order_01M5YGXJHZVD852CEFAAXA29AF` | One | WAL write succeeded while slot inactive; after restart, one marker, LSN 35190608 | Short connector outage was recovered within the configured WAL-retention budget. Before restart slot retained approximately 314,680 bytes; this is not a long-outage or slot-loss test. |
| Injected fail-open exception **before WAL write**, `order_01M5YH0RE54PEQ0XR3ZV8SDRKH` | One; checkout succeeded | Zero marker, despite committed order CDC rows | After clearing injection and repeating completion on the same cart, marker count remained zero. The native-event→WAL-call gap caused a permanent missing conversion in this scenario. |
| Injected one-time exception with subscriber **rethrow**, `order_01M5YH5VETH4P4JXP385SMJF7D` | Checkout succeeded | Zero marker | Medusa Redis event bus logged: `Retrying is not configured. Use 'attempts' option when emitting events.` The source event as emitted in this reference did not retry this subscriber. |

## Decision from this probe

The WAL message is a valid **CDC transport** and has correct normal-path
order-placement semantics in these synthetic cases. It is **not** a reliable
sole source for `order.placed` with the current post-event, fail-open hook:
the injected failure proves a lost marker; rethrowing does not recover it with
the current Medusa event-emission settings. `transactional=true` commits the
message's own transaction, not the earlier multi-transaction checkout.

Do not cut over the canonical conversion writer or remove the current adapter.
Before that, design a source-owned recovery/commit contract that still sends
all ecommerce data to Pipeline **via CDC**. Candidate approaches to evaluate
include a durable integration-owned marker in a separate PostgreSQL schema,
provided an actual source extension point can atomically couple it to the
business transition, or a source event-delivery contract with proven durable
retry/replay. A separate outbox written only after the native event has the
same gap and is insufficient by itself. No candidate has been approved here.
Full payload conformance, multiple currency/tax/discount cases, slot loss,
WAL exhaustion, Kafka duplicate replay, privacy and installer generation
remain open.

The shadow backend was restored without the WAL probe overlay.
PostgreSQL, Kafka and Debezium shadow containers were running. Live Medusa
PostgreSQL was rechecked read-only: `wal_level=replica`, **0** replication
slots and **0** shadow publications. No live source or Pipeline canonical
writer was modified.

References: [transport-only probe](WAL_MESSAGE_PROBE_2026-10-27.md),
[original marker counterexamples](MARKER_PROBE_2026-10-27.md),
[Medusa 2.19.0 Redis event bus retry code](https://github.com/medusajs/medusa/blob/v2.19.0/packages/modules/event-bus-redis/src/services/event-bus-redis.ts).
