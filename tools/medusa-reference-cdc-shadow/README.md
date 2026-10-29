# Medusa CDC shadow experiment

## Lost-slot recovery candidate

The isolated CDC-10 clone has a separate durable epoch-2 mapper, analytical
sink and guarded metadata for a lost replication slot. See
[durable recovery evidence](CDC10_DURABLE_SLOT_RECOVERY_EVIDENCE_2026-10-28.md)
and [second-loss, interrupted-snapshot and load-budget evidence](CDC10_SECOND_LOSS_SNAPSHOT_LOAD_BUDGET_2026-10-28.md).
The historical gap is permanently `INCOMPLETE`. The
[v2 semantic contract](../../../System_Backbone/docs/governance/REFERENCE_MEDUSA_ORDER_RECORDED_STATE_V2.md)
is approved for shadow development only; it does not replace the approved v1
contract or switch the live Pipeline.

## Separate catalog/master-data shadow

The Medusa integration manifest now declares
`reference.medusa.catalog_master_data.v1` separately from the approved
`order_recorded_state.v1` profile. The CI planner emits
`funnelmetry/cdc-catalog-shadow.json` with an exact four-table/column allowlist
for products, variants, categories and category links. It uses an **initial
snapshot** so pre-existing products are present before streaming later WAL
changes. The operator-side `install-catalog-shadow.py` creates a distinct
private role/publication/slot/connector; `catalog-projector` writes a keyed
current-state projection, audit and input offsets in a separate database.

On an isolated clone only, prepare the existing `compose.yml` services and
private credentials, then run:

```bash
export COMPOSE_PROJECT_NAME=funnelmetry_cdc_catalog_shadow_catalog1
python3 prepare-private.py
python3 prepare-catalog-private.py
python3 prepare-catalog-projection-private.py
docker compose -f compose.yml up -d postgres
python3 clone-db.py
docker compose -f compose.yml up -d kafka connect
python3 install-catalog-shadow.py plan --profile ./cdc-catalog-shadow.json
python3 install-catalog-shadow.py apply --profile ./cdc-catalog-shadow.json
docker compose -f compose.yml -f compose.catalog-projection.yml up -d --build \
  catalog-projection-db catalog-projector
python3 install-catalog-shadow.py verify --profile ./cdc-catalog-shadow.json
python3 verify-catalog-shadow.py --timeout-seconds 90
python3 probe-catalog-shadow.py --timeout-seconds 90
```

Use a fresh copy of this directory and its own Compose project/volumes; never
reuse the order-state shadow project or connect to live PostgreSQL. The probe
**modifies the clone** and restores its selected records. Rollback deletes only
the owned connector and retains slot/topics/volumes for replay:
`python3 install-catalog-shadow.py rollback --profile ./cdc-catalog-shadow.json`.
See [catalog snapshot/stream evidence](CATALOG_CDC_SHADOW_EVIDENCE_2026-10-28.md)
and [inventory/price stage-2 scope](CATALOG_CDC_STAGE2_SCOPE.md). This profile
does not switch the live Dashboard or stop `catalog-sync`.

## Separate inventory/price context shadow

The stage-2 profile `reference.medusa.inventory_price_context.v2` is separate
from both order-state and catalog stage 1. The CI planner generates
`funnelmetry/cdc-inventory-price-shadow.json` with an exact 16-table/column
allowlist. The operator-side installer checks the primary keys and creates its
own role, publication, slot, topic prefix and Debezium connector on an isolated
clone. An initial snapshot captures rows already present before streaming. V1
shadow evidence omitted `deleted_at` on 12 tables; its slot/topics must not be
reused for v2 or used to claim active inventory/price relationships.

From a **fresh copy** of this directory on the trusted VPS, with the generated
profile copied next to `compose.yml`:

```bash
export COMPOSE_PROJECT_NAME=funnelmetry_cdc_inventory_price_shadow_stage2b
export CDC_COVERAGE_EPOCH=inventory-price-shadow-20261029-b
python3 prepare-private.py
python3 prepare-inventory-price-private.py
python3 prepare-inventory-price-projection-private.py
docker compose -f compose.yml up -d postgres
python3 clone-db.py
docker compose -f compose.yml up -d kafka connect
python3 install-inventory-price-shadow.py plan --profile ./cdc-inventory-price-shadow.json
python3 install-inventory-price-shadow.py apply --profile ./cdc-inventory-price-shadow.json
python3 install-inventory-price-shadow.py verify --profile ./cdc-inventory-price-shadow.json
python3 verify-inventory-price-snapshot.py --timeout-seconds 90
docker compose -f compose.yml -f compose.inventory-price-projection.yml up -d --build \
  inventory-price-projection-db inventory-price-projector
python3 verify-inventory-price-projection.py --timeout-seconds 120
python3 probe-inventory-price-shadow.py
python3 probe-inventory-price-nonempty.py
python3 probe-inventory-price-replay.py
```

The projector stores allowlisted keyed rows and input offsets in a separate
PostgreSQL database. Its `inventory_price_context_active` view is raw context,
not a claim that stock is available to sell or that a price is the storefront
display price. The verifier checks keys, selected attributes, soft-delete state
and topic offsets; the probe changes then restores clone rows. The replay probe
resets **only** the isolated projector consumer group and checks that audit and
projection effects do not duplicate. See [stage-2 shadow evidence](CATALOG_CDC_STAGE2_SHADOW_EVIDENCE_2026-10-29.md).
That evidence belongs to v1 capture only. The fresh v2 snapshot, projection,
transition, replay and one simple Store API
sample are recorded in [v2 shadow evidence](CATALOG_CDC_STAGE2_V2_SHADOW_EVIDENCE_2026-10-29.md).
The nonempty clone fixture adds reservation/price-list/price-list-rule/price
rows and restores them after reconciliation; it does not establish Medusa
inventory or pricing calculation semantics.
For a controlled Store API comparison, start the clone backend, Redis and
Source Ingress alongside the five CDC services, then run
`probe-inventory-price-api-semantics.py`. Direct SQL changed the price-list
calculated amount in the sample but did not invalidate Store API inventory
quantity; the probe records `BLOCKED_BY_QUALITY` for that direct-SQL case.
`probe-inventory-price-checkout.py` exercises the Medusa checkout workflow on
the **same clone**, verifies a real reservation and the Store API quantity
change, then reconciles the CDC projection. It creates a synthetic order and
does not remove that order from the isolated clone. These are sample-level
conformance probes; they do not establish all location, kit, backorder,
quantity-tier or rule cases.
The [governed context candidate](INVENTORY_PRICE_GOVERNED_CANDIDATE_EVIDENCE_2026-10-29.md)
uses migration `022_inventory_price_cdc_context_candidate.sql` and the separate
`workers/inventory-price-cdc-writer` to persist the same 16 source tables,
transactional offsets and audit in Pipeline-style tables. On a private clone,
apply that migration to `inventory-price-projection-db`, create
`private/inventory-price-governed-writer.env` with
`prepare-inventory-price-governed-private.py`, and start
`compose.inventory-price-governed-candidate.yml` alongside the base and
projection Compose files. Run `verify-inventory-price-governed-candidate.py`
for source/offset reconciliation and
`publish-inventory-price-governed-quality.py --evidence-ref <non-secret-id>`
for a bounded **context-only** lease. The guarded mutation and lease probes
require the exact `stage2b` clone and epoch; they never run against live.
There is no active inventory/price business asset or production semantic gate.

`inventory_price_resolution_candidate.py` now resolves only the conformed
one-item/one-location managed-inventory case and one default currency price.
It requires a fresh full 16-table reconciliation result; empty tables are
recognized through verifier coverage rather than grouped row presence. Kit,
multiple location, price-list, rule, tier and reservation/level mismatch cases
return `UNVERIFIED` without a sellable quantity or display price. The isolated
`probe-inventory-price-resolver-candidate.py` compares the candidate output
with Store API after the governed projection catches up. See
[resolver evidence](INVENTORY_PRICE_RESOLVER_CANDIDATE_EVIDENCE_2026-10-29.md).

For the isolated order-v2 mapper/sink chain, `verify-reference-order-v2-quality.py`
checks source order state, Debezium slot/connector, Kafka ends, mapper ordered
prefix and sink state twice before it can issue a short `CURRENT_STATE_READY`
lease. It accepts explicit epoch, source ID, slot, connector, topic prefix and
fact topic. `--write-quality` writes only to the clone chain DB; it cannot
publish live metadata. A lost slot, source/projection mismatch, missing marker
or offset gap yields `BLOCKED_BY_QUALITY`. See
[quality gate evidence](REFERENCE_ORDER_V2_QUALITY_GATE_EVIDENCE_2026-10-29.md).

This profile has no live Medusa DB grant, Dashboard binding or `catalog-sync`
cutover. It still needs relationship/price/inventory semantic conformance,
a context-aware resolver and continuous target-topology quality monitoring
before any inventory or price analytical capability can be published.

This is a **disposable, isolated conformance environment** for DEC-135/136. It
uses a logical dump of the running Medusa PostgreSQL database to avoid changing
the live database's `wal_level=replica` setting. It starts a private PostgreSQL
15 instance with logical WAL, private Redis, the **already built** Medusa backend
image, a private Source Ingress, one Kafka broker, and Debezium Kafka Connect.
The backend keeps the native `order.placed` subscriber. Debezium writes only to
`cdc_shadow_medusa.*`; there is no consumer into live canonical state.

## Reference CDC installer (approved semantic, shadow runtime only)

`install-reference.py` is the operator-side companion to the Medusa CI installer.
The CI installer turns `funnelmetry.integration.yaml` into the reviewed,
non-secret `funnelmetry/cdc-reference-shadow.json`; this CLI consumes that exact
profile. It installs only the approved three-table/seven-column
`reference.medusa.order_recorded_state.v1` path into this private Compose stack.
It refuses changed profile fields, a non-shadow project, published ports,
non-internal networks, a broad/drifted publication or connector, and orphaned
slots. An already owned installation also refuses a missing slot or unsafe WAL
status instead of silently creating a new slot. It leaves the native subscriber
and all live Pipeline resources alone.

Use a **fresh copy of this directory with its own `private/` and Docker volumes**
for each installer rehearsal. The earlier six-table experimental publication
is deliberately incompatible; the installer will not silently narrow it.
`COMPOSE_PROJECT_NAME` may be `funnelmetry_cdc_shadow` or a unique name such as
`funnelmetry_cdc_shadow_installer1`; set the same variable for every command,
including `clone-db.py` and the verifier scripts. Never point it at a live
Medusa or Pipeline project.

```bash
export COMPOSE_PROJECT_NAME=funnelmetry_cdc_shadow_installer1
PROFILE=/srv/KLTN/dtc-starter-funnelmetry/funnelmetry/cdc-reference-shadow.json
python3 install-reference.py plan --profile "$PROFILE"

# Source owner: prepare an isolated clone. clone-db.py reads live Medusa only;
# it refuses an already populated destination and writes no dump to the host.
python3 prepare-private.py
docker compose -f compose.yml up -d postgres
python3 clone-db.py

# Pipeline operator: installer creates the narrow publication/role, registers
# one Debezium connector, and starts mapper + analytical sink.
python3 install-reference.py apply --profile "$PROFILE"
python3 install-reference.py verify --profile "$PROFILE"

# After synthetic checkout creates facts, run data-level reconciliation too.
python3 verify-reference-mapper.py
python3 verify-reference-analytics.py

# Reversible stop: no slot, publication, topic, volume or credential deletion.
python3 install-reference.py rollback --profile "$PROFILE"
```

`prepare-private.py` creates a mode-600 `private/connector.env` containing the
`FUNNELMETRY_CDC_SHADOW_DATABASE_URL` secret referenced by the profile. An old
`connector.env` without that key must be migrated by the operator in the
isolated copy; the installer never fills a missing secret from another key or
prints its value. `apply` records a profile hash and ownership state in
`private/cdc-reference-installer-state.json`. Reapplying the same profile is
idempotent; a changed profile or foreign connector fails closed. `verify`
checks infrastructure and physical tables; the two verifier scripts above
check data after facts exist. `rollback` stops only reference consumers and
deletes only an exact owned connector, retaining all durable resources for
inspection and replay. An owned `STOPPED` installation may be applied again
with the same profile and private Kafka volumes; this path passed an isolated
rollback→apply→verify VPS rehearsal. Destructive cleanup is a separate
operator decision. See [installer runtime evidence](INSTALLER_RUNTIME_EVIDENCE_2026-10-27.md)
for the fresh-clone checkout and rollback results, and
[post-resume data evidence](INSTALLER_RESUME_DATA_EVIDENCE_2026-10-28.md) for
the fact/offset comparison after `rollback → apply`.
The [controlled outage and slot-loss evidence](CDC_RECOVERY_FAULT_EVIDENCE_2026-10-28.md)
records the separate recovery probe. A lost slot requires operator-controlled
reconciliation; do not delete the installer ownership record or create a new
slot and continue with `snapshot.mode=no_data` as though capture were continuous.
The mapper/sink verifier scripts validate projected data and offsets, but do
not by themselves prove that every source checkout has arrived.

### CDC-10 fault and load probes

The [2026-10-28 CDC-10 evidence](CDC10_LAG_LOAD_RETENTION_EVIDENCE_2026-10-28.md)
adds a source-transaction catch-up gate, a six-minute Connect outage, bounded
synthetic checkout load and a real lost-slot test on a **separate disposable
clone**. `verify-cdc-catchup.py` accepts `--expect-order` for each fresh
synthetic order and optional `--baseline-lsn` captured **before** the workload.
It checks the source row versions' transaction IDs against processed Debezium
END records and the mapper/sink state. Do not pass a post-checkout
`pg_current_wal_lsn()` as a required flush point: that can include unrelated
WAL beyond the last captured transaction.

`probe-cdc10-bounded-outage.py` and `probe-cdc10-load.py` require
`COMPOSE_PROJECT_NAME=funnelmetry_cdc_shadow_cdc10` and bounded order counts.
They restore Connect after a successful or failed workload. The retention
probe also requires that exact project and a 256 MB slot cap; it deliberately
invalidates the clone's slot and leaves Connect stopped when lost. Do not run
it against the pre-existing shadow project, a live source, or a source whose
data must be retained. The resulting clone is not safe to apply/restart using
the same `no_data` lineage. Its volumes are retained until the operator
explicitly decides how to archive or discard them.

These probes establish only bounded shadow observations. A versioned
snapshot/rebuild procedure after actual slot loss is still required before
CDC-10 can be marked complete or the reference path can be activated live.

The operator selected an explicit-gap, new-snapshot-epoch recovery policy.
[`probe-cdc10-rebaseline.py`](probe-cdc10-rebaseline.py) rehearses this on the
retained lost-slot clone using a fresh connector, slot and topic prefix. It
requires `COMPOSE_PROJECT_NAME=funnelmetry_cdc_shadow_cdc10` and keeps the
old lineage intact. Run `setup` once with only postgres, Kafka and Connect
running; the snapshot must have an exact seven-column Debezium
`column.include.list` and source role grants on those same columns. Keep the
backend stopped while `baseline` compares all selected rows against source.
After `BASELINE_VERIFIED`, start the clone backend and perform one synthetic
checkout; run `transition --expect-order order_ID`, then restart Connect and
repeat to check deterministic current state. See
[epoch 2 evidence](CDC10_REBASELINE_EVIDENCE_2026-10-28.md). This is an
in-memory semantic probe; it does not install a durable epoch 2 mapper/sink,
publish a metric or mark CDC-10 complete.

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
