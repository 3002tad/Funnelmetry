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

For the optional workflow-marker experiment, run
`python3 configure-workflow-marker-probe.py` after the first connector is
healthy. It uses the second shadow replication slot and publishes only seven
non-context columns from `workflow_execution`. Run a *new* synthetic checkout
after enabling it; `snapshot.mode=no_data` does not replay earlier workflows.
Compare one cart/order with
`python3 summarize-workflow-marker.py "$CART_ID" "$ORDER_ID"`.
The observed result and the installed Medusa source-code check are in
[the marker probe](MARKER_PROBE_2026-10-27.md).
The separate [logical WAL message probe](WAL_MESSAGE_PROBE_2026-10-27.md)
tests CDC transport for a synthetic business marker without changing source
tables. It does not implement or validate the Medusa subscriber.
The [native-event WAL conformance probe](NATIVE_WAL_MARKER_CONFORMANCE_2026-10-27.md)
uses the opt-in `compose.wal-probe.yml` overlay to bind-mount a shadow-only subscriber and tests success, compensation, retry,
connector downtime and an injected source-side failure. It found a lost-marker
case, so the post-event WAL hook cannot yet replace the adapter.
The [verification-point audit](ORDER_CDC_VERIFICATION_POINT_AUDIT_2026-10-27.md)
checks other Medusa PostgreSQL and workflow candidates, and separates a
retractable order-state projection from the native placement event.
The [order-state gate probe](ORDER_STATE_GATE_PROBE_2026-10-27.md) replays seven
synthetic shadow orders through `evaluate-order-state-gate.py` and compares
`ON`/`OFF` corrections with the native event and final DB state. It does not
authorize replacing the existing `order.placed` terminal event.
For the optional soft-delete follow-up, run
`python3 configure-order-state-gate-publication.py` in this isolated directory
before `evaluate-order-state-gate.py`. This adds `order.deleted_at` only to the
shadow publication; the [soft-delete probe](ORDER_STATE_SOFT_DELETE_PROBE_2026-10-27.md)
records the resulting `ON→OFF` transition and its semantic limit.
The [reference order-state contract candidate](REFERENCE_ORDER_RECORDED_STATE_CONTRACT_V1.md)
records the dedup, full replay, serialized checkpoint, reversed cross-topic
arrival, missing-row recovery and shadow connector restart checks. Run
`verify-order-reference-contract.py order_ID:cart_ID [...]` only for synthetic
shadow pairs after the `deleted_at` publication step. This is a count-only
current-state reference proposal, not a live canonical `order.placed` mapping.

To repeat only this probe, use
`docker compose -f compose.yml -f compose.wal-probe.yml up -d --no-deps backend`,
then run the synthetic checkout commands below and
`python3 summarize-wal-markers.py "$ORDER_ID"`. The optional environment
variable `SHADOW_WAL_PROBE_FAIL_BEFORE_EMIT` accepts `1` (swallow injected
failure) or `throw-once` (rethrow a one-time injected failure); both are for
isolated fault tests only. Remove the overlay from the Compose invocation and
run `docker compose -f compose.yml up -d --no-deps backend` to restore the
regular shadow backend. The overlay does not belong on the live Medusa stack.

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

## Optional durable reference mapper

The optional durable reference mapper uses `compose.reference-mapper.yml` and
its own PostgreSQL volume. Run `python3 prepare-reference-mapper-private.py`,
then `docker compose -f compose.yml -f compose.reference-mapper.yml up -d --build
reference-projection-db reference-mapper` and `python3 verify-reference-mapper.py`.
It persists an allowlisted CDC inbox, END checkpoints, state and fact outbox;
output to `cdc_shadow_reference.order_recorded_state.v1` is at least once with
stable `fact_change_id`. See [runtime evidence](REFERENCE_MAPPER_RUNTIME_EVIDENCE_2026-10-27.md).
This count-only shadow projection does not replace the Backend Adapter.

## Optional analytical sink and metadata

The `compose.reference-analytics.yml` overlay consumes the reference fact
topic into a second PostgreSQL volume. It stores the ON/OFF audit, one current
row per source/order, and a versioned shadow-only semantic definition with a
physical binding. Start it on the trusted VPS after the mapper is running:

```bash
python3 prepare-reference-analytics-private.py
docker compose -f compose.yml -f compose.reference-mapper.yml -f compose.reference-analytics.yml up -d --build reference-analytics-db reference-analytics-sink
python3 verify-reference-analytics.py
```

The metric counts only approximate current `active=true` reference orders.
See [analytical sink evidence](REFERENCE_ANALYTICS_RUNTIME_EVIDENCE_2026-10-27.md).
For a physical duplicate-delivery test, run
`SHADOW_DUPLICATE_FACT_PROBE=1 python3 probe-reference-fact-duplicate.py`;
this writes one duplicate only to the shadow Kafka topic.

## Stop / cleanup

`docker compose -f compose.yml down` stops the experiment but retains volumes
and connector state for inspection. Once evidence has been archived and the
operator explicitly chooses to discard the experiment, `docker compose -f
compose.yml down -v` removes **only this Compose project's** containers, network
and its base shadow volumes. If the optional reference mapper is running, use
both files in the stop command: `docker compose -f compose.yml -f
compose.reference-mapper.yml down`; include `-v` only when deliberately
discarding its separate projection volume too. When the analytical overlay is
active, include `-f compose.reference-analytics.yml` in the same command to
stop its service; `-v` also discards that analytical volume. The `private/`
directory holds disposable credentials
and is not tracked by Git. Do not point either command at the Medusa or Pipeline
live Compose/Swarm projects.

The reference path is [the CDC development contract](../medusa-ci-installer/CDC_DEVELOPMENT.md)
and [the Backbone CDC proposal](../../../System_Backbone/docs/implementation/PROPOSED_CDC_DATA_PLATFORM_ACQUISITION_2026-10-15.md).
