# PostgreSQL logical WAL message probe — 2026-10-27

**Purpose:** test a CDC-carried business marker without adding a Medusa table,
column or row. This is an isolated transport probe, not a `order.placed`
subscriber implementation or cutover.

On the existing PostgreSQL 15.19 clone in `/srv/KLTN/cdc-shadow`, a single
transactional synthetic message was emitted with:

```sql
SELECT pg_logical_emit_message(
  true,
  'funnelmetry.shadow-probe.v1',
  '{"event_id":"shadow-probe-20261027-01","source":"isolated-cdc-shadow"}'
);
```

The existing Debezium 3.6.3.Final **main CDC connector** received it in
`cdc_shadow_medusa.message` with `op=m`, matching prefix, `source.txId=1828`,
`source.lsn=34592408`, `snapshot=false` and a base64-encoded `message.content`
that decodes to the synthetic JSON above. No schema/table/row was changed.
The PostgreSQL function returned WAL position `0/20FD698`. The message topic
of the separate workflow probe existed but yielded **zero** records in the
subsequent read; no claim is made that both connectors captured it. A single
source-authoritative connector and explicit prefix filter remain the target.

## Architectural interpretation

- All off-source **ecommerce** data can use one CDC acquisition path: ordinary
  row changes plus `op=m` logical messages for source-confirmed business facts.
  Browser SDK behavioral HTTP traffic is a separate domain and is unaffected.
- A source-side `order.placed` subscriber can emit a logical message **after**
  Medusa has released the native event. It must include the stable event ID and
  the approved order/cart/amount/currency/time snapshot, and perform only a WAL
  write through `pg_logical_emit_message(true, ...)`, with no Medusa data-table
  mutation or HTTP call to Pipeline. The subscriber still needs to be generated
  and verified through the installer.
- `transactional=true` ties the message to its **own SQL transaction**, not to
  the earlier multi-transaction `complete-cart` workflow. The native event to
  WAL-call gap remains; retry/dead-letter/operational reconciliation and a
  connector slot/WAL retention budget are required. If the slot becomes
  invalid or old WAL is discarded before Kafka receives the message, there is
  no table from which this message can be replayed or backfilled.
- Debezium receives the message content as bytes (base64 in the current JSON
  converter), and the downstream mapper must decode/validate the prefix,
  schema version and `event_id`. Kafka replay may duplicate delivery, so the
  canonical writer must deduplicate by stable `event_id`.

The live Medusa PostgreSQL remained at `wal_level=replica` with zero slots and
zero shadow publications throughout this experiment. No current subscriber,
Gateway route or Pipeline canonical writer was changed.

References: [PostgreSQL 15 `pg_logical_emit_message`](https://www.postgresql.org/docs/15/functions-admin.html),
[Debezium PostgreSQL message events](https://debezium.io/documentation/reference/stable/connectors/postgresql.html),
[CDC conversion marker probe](MARKER_PROBE_2026-10-27.md).
