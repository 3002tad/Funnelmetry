# Medusa CDC shadow validation — 2026-10-27

## Scope and environment

- Time: 2026-10-27 06:46–07:04 UTC, VPS `kltn`.
- Live Medusa source: commit `efc7a58`, Medusa 2.19.0, PostgreSQL 15.19. Pipeline baseline: `b1c0a35`.
- Test project: `/srv/KLTN/cdc-shadow`, Compose project `funnelmetry_cdc_shadow`. It contains a logical snapshot of the Medusa database, private Medusa backend and Source Ingress, PostgreSQL 15 with logical WAL, Kafka 3.9.1 and Debezium Connect 3.6.3.Final (image digest in `compose.yml`). The Docker network is `internal: true`; no service has a published host port or Cloudflare route.
- Only the cloned PostgreSQL has role `cdc_shadow`, publication `funnelmetry_cdc_shadow` and replication slot `funnelmetry_cdc_shadow`. The publication has an explicit column allowlist across `order`, `cart`, `order_cart`, `order_summary`, `order_item` and `order_line_item`. `snapshot.mode=no_data` prevents cloned historical rows from becoming new events. Raw records go to private topics `cdc_shadow_medusa.public.*`. No mapper or live canonical consumer is attached.
- Live PostgreSQL was read for the initial `pg_dump` only. Its post-test state remained `wal_level=replica`, 0 replication slots and 0 shadow publications. The four live Medusa containers remained running.

The data below comes from synthetic checkout probes on the clone. Only IDs,
event type, status, LSN, amount/currency and workflow state are retained here;
private credentials, customer fields and raw CDC payloads are omitted.

## Observations

| Case | Store API and final DB | CDC raw stream | Native Source Event Feed |
|---|---|---|---|
| Successful checkout | Cart `cart_01M5Y259MZ00PJ965SKGN4KC73`; order `order_01M5Y25BWHJDXC7ZG82PHYCW9M`; `complete-cart=done`; order status `pending`; total **15.51 EUR** | `order` create at LSN 33831544, tx 1720; `order_cart` create at LSN 33846344, tx 1721; cart `completed_at` update observed | Exactly one `medusa.order_placed`, same order/cart and **15.51 EUR** |
| Authorization failure after order creation | Cart `cart_01M5Y2GQN8D394BC587EP1GSHJ`; Store API HTTP 200 with `type=cart` and `Payment authorization failed`; `complete-cart=reverted`; order `order_01M5Y2H6EY41R9ZH0BW47ATJSX` absent from final `order` table; cart `completed_at=null` | `order` create LSN **33914680**, tx 1737; `order_cart` create LSN **33932488**, tx 1738; cart completion update LSN **33936512**, tx 1740; compensation reset LSN **33956536**, tx 1744; `order` delete LSN **33958088**, tx 1745 | **Zero** `medusa.order_placed` for the failed order |
| Retry same cart after restoring the synthetic payment session | Store API returned new order `order_01M5Y2M4PDBWE96V9YWP5EAZ2Y`; `complete-cart=done`; order `pending`; **15.51 EUR**. A second completion call returned the same order ID | New `order` create LSN 34000080, tx 1749; new `order_cart` create LSN 34021312, tx 1750; cart completion update LSN 34026776, tx 1752 | Exactly one `medusa.order_placed` for the retry order, same cart, **15.51 EUR** |
| Connector restart and new checkout | Debezium connector and task returned to `RUNNING`; new cart `cart_01M5Y2Q1ZAZYW2HR7YNMSEBEPB` and order `order_01M5Y2Q3MZ4559B2TZB24GVKHE`; `complete-cart=done` | New `order` create LSN 34100856, tx 1767; link and cart completion also observed after restart | Exactly one matching `medusa.order_placed` at Source Event Feed seq 3, **15.51 EUR** |

LSNs and transaction IDs are **local to this disposable shadow DB**.

The failure was induced **only in the clone** by changing one synthetic
`payment_session.provider_id` to a nonexistent provider. After the failed
checkout, the provider was restored in the clone and the same cart was retried.
No Medusa source code, live payment configuration or live order was changed.

## Semantic result

`INSERT order`, the `order_cart` link and a non-null `cart.completed_at` are
**insufficient** to emit the immutable `order.placed` funnel fact. They were all
visible in committed CDC transactions for the failed checkout, then compensated.
The native subscriber emitted no event for that attempt. Counting the first
insert would create a false conversion and could double count when the same cart
later succeeds with a new order ID. The residual `order_cart` row in the failed
case also cannot prove that an order remains valid.

This shadow publication does **not** yet expose a proven post-workflow commit
marker with the same semantics as native `order.placed`. Keep the native
subscriber authoritative for that fact and use CDC for raw changes/current-state
experiments. Any future CDC-only conversion mapper needs an explicit source
commit marker or another tested equivalent, plus durable dedup, compensation,
retry, amount/currency and replay tests. Current status: **CDC conversion
mapping UNVERIFIED; no cutover**.

## Operational result and remaining work

- Connector/task `RUNNING`; slot active. Retained WAL measured roughly 71–181 KB across the tests, well below this shadow's 256 MB slot limit. That is a short test, not a production WAL budget.
- After a controlled connector restart, the same connector/task returned to `RUNNING` and captured a newly created order. This verifies basic continuation; exact offset replay/dedup under failure and Kafka outage remain untested.
- Basic amount/currency matched for the simple 15.51 EUR Manual Payment checkout. Discount, tax, shipping adjustments, multiple currencies and snapshot/backfill behavior remain untested.
- This is an isolated semantic harness, not a deployable CDC installer or a Pipeline Gateway. The existing Medusa subscriber and Pipeline production ingestion remain unchanged.
- The shadow stack was left running on the VPS for further development. Stop without deleting evidence using `docker compose -f compose.yml down` from `/srv/KLTN/cdc-shadow`; dropping its volumes requires a separate discard decision.
