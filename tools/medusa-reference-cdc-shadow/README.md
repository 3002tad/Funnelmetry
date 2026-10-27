# Medusa CDC shadow experiment

This is a **disposable, isolated conformance environment** for DEC-135/136. It
uses a logical dump of the running Medusa PostgreSQL database to avoid changing
the live database's `wal_level=replica` setting. It starts a private PostgreSQL
15 instance with logical WAL, private Redis, the **already built** Medusa backend
image, a private Source Ingress, one Kafka broker, and Debezium Kafka Connect.
The backend keeps the native `order.placed` subscriber. Debezium writes only to
`cdc_shadow_medusa.*`; there is no consumer into live canonical state.

## Preconditions

- Run on the single VPS that hosts `medusa_reference-postgres-1` and the
  already-built `medusa_reference-backend:latest` image for the tested commit.
- The source DB and image version must be recorded before tests. The clone
  command reads the live DB but never changes its config, role, slot, volume or
  tables. The shadow network is Docker `internal`; backend and Connect REST
  have **no published host ports**. Use `docker compose exec` for API checks.
  No shadow service is on the public tunnel.
- The cloned database can contain sensitive data. Keep this directory and its
  Docker volumes on the trusted VPS; do not send raw dump/CDC payloads to Git,
  logs, a public endpoint or an external AI service.

## Start and configure

From this directory on the VPS:

```bash
python3 prepare-private.py
docker compose -f compose.yml config --quiet
docker compose -f compose.yml up -d postgres redis source-ingress kafka
python3 clone-db.py
docker compose -f compose.yml up -d backend connect
python3 configure-cdc.py
docker compose -f compose.yml ps
```

`prepare-private.py` makes mode-600 credentials and refuses a partial rerun.
`clone-db.py` refuses a populated destination. `configure-cdc.py` creates a
replication role and column-filtered publication **only in the shadow DB**, then
registers a Debezium connector with `snapshot.mode=no_data`. A previously
existing connector with different config is rejected. Topic prefix, Connect
internal topics, database/Redis, Source Event Log and Docker network/volumes
are separate from live. The connector's slot is not dropped automatically.

The publication includes only IDs, order status/currency/time, cart completion,
Order↔Cart link, items, and order totals. It excludes email, address and Medusa
workflow `context` columns. It remains a source-specific **test allowlist**, not
approval for a production CDC table/column policy.

## Evidence gate

Run a synthetic successful checkout through the backend's container-local Store
API and compare: (a) raw CDC `op`, table, key, LSN and transaction
metadata, (b) native `medusa.order_placed` in the **shadow** Source Event Log,
(c) final DB Order↔Cart, amount/currency and workflow state. Then exercise a
controlled failure that reaches order creation and compare again. Do not infer
`order.placed` from `INSERT order` alone or call a snapshot row a new conversion.
Keep the candidate mapping `UNVERIFIED` until success, failure, retry and
amount/currency cases have conformance evidence.

The reproducible checks are:

```bash
# Copy IDs printed by the commands into these variables before each summary.
ORDER_ID=order_REPLACE_WITH_SYNTHETIC_ID
CART_ID=cart_REPLACE_WITH_SYNTHETIC_ID
PAYMENT_COLLECTION_ID=pay_col_REPLACE_WITH_SYNTHETIC_ID

python3 run-store-js.py checkout-shadow.mjs
python3 summarize-shadow.py "$ORDER_ID" "$CART_ID"

SHADOW_STOP_BEFORE_COMPLETE=1 python3 run-store-js.py checkout-shadow.mjs
python3 inject-payment-failure.py "$PAYMENT_COLLECTION_ID"
SHADOW_CART_ID="$CART_ID" python3 run-store-js.py complete-existing-shadow.mjs
python3 summarize-shadow.py "$ORDER_ID" "$CART_ID"

python3 restore-payment-session.py "$PAYMENT_COLLECTION_ID"
SHADOW_CART_ID="$CART_ID" python3 run-store-js.py complete-existing-shadow.mjs
python3 summarize-shadow.py "$ORDER_ID" "$CART_ID"
```

The failed order ID is found from the shadow `order_cart` table after the
failed checkout, where the associated `order` row is absent. Only synthetic
IDs should be passed to these commands. See
[the 2026-10-27 validation](VALIDATION_2026-10-27.md) for observed results.

## Stop / cleanup

`docker compose -f compose.yml down` stops the experiment but retains volumes
and connector state for inspection. Once evidence has been archived and the
operator explicitly chooses to discard the experiment, `docker compose -f
compose.yml down -v` removes **only this Compose project's** containers, network
and three shadow volumes. The `private/` directory holds disposable credentials
and is not tracked by Git. Do not point either command at the Medusa or Pipeline
live Compose/Swarm projects.

The reference path is [the CDC development contract](../medusa-ci-installer/CDC_DEVELOPMENT.md)
and [the Backbone CDC proposal](../../../System_Backbone/docs/implementation/PROPOSED_CDC_DATA_PLATFORM_ACQUISITION_2026-10-15.md).
