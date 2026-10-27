# Durable CDC reference mapper: isolated runtime evidence (2026-10-27)

**Scope:** optional `compose.reference-mapper.yml` overlay in the private
`funnelmetry_cdc_shadow` Compose project on the KLTN VPS. This experiment did
not modify the live Medusa DB, live Pipeline, Browser SDK, Backend Adapter,
Cloudflare routes, or canonical `order.placed` topic. The Medusa database used
here is a clone. All new order IDs were synthetic.

## Runtime path

Debezium's `cdc_shadow_medusa.public.order`, `.order_cart`, `.cart` and
`.transaction` topics feed `reference-mapper/main.mjs`. A separate PostgreSQL
volume stores the raw allowlisted inbox, input offsets, END records, source
state, an order-keyed current-state projection, and the fact outbox. A Kafka
input offset is committed only after the inbox transaction commits. Complete
END transactions are applied in END topic offset order; source-state changes,
the fact transition and the END checkpoint commit together. The outbox sends
to `cdc_shadow_reference.order_recorded_state.v1` with a stable
`fact_change_id`. This is at-least-once output, so a future downstream
materializer must deduplicate by `fact_change_id`.

The payload contains only contract/source identity, order/cart IDs, current
`active` state, revision END ID, observed source time, and reference quality/
coverage labels. No amount, currency, email, address, payment, or authoritative
placement event is emitted by this mapper.

## Observations

| Probe | Result |
|---|---|
| Initial historical CDC-topic catch-up | 83 END transactions and 82 row changes were persisted and processed. The mapper reads all post-activation orders in the shadow topic, so its scope is larger than the prior selected-nine-order in-memory verifier. |
| Fresh Store API checkout | Synthetic `order_01M5YPMWGHR5PYVP065SSBJ8V2` produced one ON fact. A guarded SQL soft delete on this one cloned order produced one OFF fact; both outbox entries were published. The SQL operation is a CDC transport probe, not a source-owned Medusa deletion workflow. |
| Payment failure and retry | An isolated payment-provider fault for `cart_01M5YPNRA8SR36NXBBWCQ0FBVZ` produced ON then OFF for compensated `order_01M5YPP0M7JHCM79MQVFVNT08F`. Restoring the synthetic payment session and retrying produced a distinct ON for `order_01M5YPPKD78KH9WQCEGYXDS4J0`. |
| Mapper crash after durable inbox | A one-time fault for `cart_01M5YPRWKAB3BW8CJV4W70E02V` killed the mapper after persisting a completed-cart CDC row and before committing its Kafka input offset. Compose restarted it. After Kafka group rebalance, all 110 observed END transactions were processed, no END remained pending, and `order_01M5YPSDZY86XTBPG1K5P5XB5J` had exactly one ON fact in the outbox and Kafka. |
| Full Kafka input replay | A new consumer group read the entire four-topic input history against the existing projection DB. Before and after: 110 raw rows, 110 END records, 26 outbox facts, zero unpublished facts, and 14 active projected orders. No new logical fact was produced. The mapper was returned to its original consumer group. |
| Read-only reconciliation | `verify-reference-mapper.py` compared all 20 projected order states with the cloned Medusa DB predicate: zero mismatches. The fact outbox contained 26 unique changes; Kafka fact topic partition 0 ended at offset 26, contained the same 26 change IDs, and had no extra record. Zero END transactions or outbox facts were pending. |

The durable inbox/replay and correction checks pass for this finite shadow
dataset. The output cannot be called exactly-once under a crash between Kafka
send and marking the outbox row published; its stable ID supports downstream
deduplication. The shadow uses one Kafka partition per topic, a single mapper,
`snapshot.mode=no_data`, and post-activation state only. Historical bootstrap,
Kafka retention expiry, Debezium schema evolution, WAL-slot exhaustion,
multi-partition ordering, sustained flash-sale load, and source-owned cancel/
delete behavior remain untested. There is no amount/currency contract in v1.

This evidence supports continued **reference-state mapper development** only.
Native `medusa.order_placed -> order.placed` remains the live authority under
DEC-119/135; a Funnel Profile/metadata and governance change would be required
before any cutover to this weaker, retractable current-state terminal.
