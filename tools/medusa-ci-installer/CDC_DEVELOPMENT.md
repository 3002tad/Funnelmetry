# Medusa CDC installer profile — development contract

Status: **IN DEVELOPMENT / SHADOW ONLY** under DEC-119/135. Branch: `feature/cdc-medusa-v1` in both Streaming Pipeline and Medusa Reference. The manifest/profile/plan/verify/rollback-plan path below is implemented for the approved count-only reference semantic. A separate operator-side [shadow runtime installer](../medusa-reference-cdc-shadow/README.md#reference-cdc-installer-approved-semantic-shadow-runtime-only) now packages publication/connector/mapper/sink setup against an isolated clone; no live CDC activation is included.

## Ownership and inputs

The manifest also accepts a **separate** `cdc_catalog_shadow` block. It pins
`reference.medusa.catalog_master_data.v1`, an initial snapshot and the exact
product/variant/category/link column allowlist. The planner generates only
`funnelmetry/cdc-catalog-shadow.json` for that block; `catalog-rollback-plan`
removes only that exact generated file. It does not expand `cdc_shadow`, the
approved order-state v1 contract, or any live Medusa binding. The operator
installer and [snapshot/stream evidence](../medusa-reference-cdc-shadow/CATALOG_CDC_SHADOW_EVIDENCE_2026-10-28.md)
are shadow-only. Inventory and pricing are a [separately versioned stage-2
candidate](../medusa-reference-cdc-shadow/CATALOG_CDC_STAGE2_SCOPE.md).
Catalog and inventory/price now require their own `coverage_epoch_id` in the
source manifest. The generated artifact schemas are catalog v2 and
inventory/price v3; their business contracts remain catalog v1 and context v2.
The planner recognizes the exact earlier installer-owned artifacts and emits
an upgrade patch. It refuses altered files and does not change the native
order subscriber. The three epochs must match the separate Pipeline worker
environment before target-topology startup.
Before running the Medusa workflows with this new block, publish the planner
commit and update `FUNNELMETRY_PLANNER_REF` to that commit; both plan and propose
workflows fail closed when the pinned planner lacks `cdcCatalogState`.

The independent `cdc_order_v2_shadow` block generates
`funnelmetry/cdc-order-v2-shadow.json` for one explicit coverage epoch. It
requires `reference.medusa.order_recorded_state.v2`, `snapshot_mode=initial`,
the exact three-table order predicate allowlist and a slot/publication/topic
namespace distinct from v1, catalog and inventory/price. The generated file
declares `BASELINE_NEVER_ON`, `historical_gap_status=INCOMPLETE`, and retains
native `medusa.order_placed` authority. `order-v2-rollback-plan` removes only
that generated file after a drift check; runtime slot/topic/volume cleanup is
operator-owned. A lost slot requires a new coverage epoch and new isolated
runtime resources. This profile is a source-side plan artifact, not a v2
operator runtime installer or permission to activate a live CDC connector.

- The existing `medusa-ci-installer` accepts an optional `cdc_shadow` block in `funnelmetry.integration.yaml`. It generates only `funnelmetry/cdc-reference-shadow.json` in the Medusa integration branch. The native subscriber profile remains authoritative and required.
- Keep browser SDK, consent, and storefront server search/cart hooks installed in every profile. The backend order subscriber is the only source-code binding eligible for later CDC replacement.
- The pinned profile specifies Medusa 2.19.0, the exact `order`/`order_cart`/`cart` column allowlist, `no_data` snapshot, shadow publication/slot/topic names, source DB URL **secret reference**, source/Pipeline owners and native-subscriber rollback target. The manifest and generated artifact contain no DB password or replication token. The connector's actual private network and credentials are operator-owned runtime settings.
- Source-side artifacts and Pipeline-side artifacts have separate owners: source PostgreSQL settings/role/publication and optional Compose overlay versus Kafka Connect/slot ownership, raw topics, mapper, offsets, monitoring, and shadow projection.

## Required installer flow

1. `plan` validates the manifest and source version, generates the installer-owned CDC shadow JSON patch, and records operator preconditions without changing runtime.
2. `apply` works only on a pre-created non-main integration branch. It generates/reconciles only installer-owned files, remains idempotent, and refuses partial/stale files it does not own. Privileged SQL and runtime deployment remain separately reviewed operator actions.
3. `verify` checks that the checked-out integration matches the manifest, including existing browser/storefront/native-subscriber files and the exact generated CDC profile. It does **not** claim runtime DB/connector conformance; use the separate shadow verifier for that.
4. `rollback-plan` generates a deletion patch only for the exact installer-owned CDC profile. Drift fails closed. Runtime slots, publications, topics, volumes and credentials remain owned by operators and are never removed by this installer.

The Medusa `funnelmetry-integration-propose.yml` workflow applies the patch on
the already-created `feature/cdc-medusa-v1` branch or an existing
`funnelmetry/integration/**` branch. It checks that the pinned planner SHA
understands `cdc_shadow` and, when declared, `cdc_catalog_shadow` before applying
a patch; the GitHub repository variable
`FUNNELMETRY_PLANNER_REF` must be updated to the reviewed commit before CI runs.
No workflow merges or deploys the branch.

## Operator-side shadow runtime package

From a clean copy of `tools/medusa-reference-cdc-shadow/`,
`install-reference.py plan --profile <Medusa-generated-profile>` checks the exact
approved profile without Docker or credentials. The operator prepares a private
Medusa PostgreSQL clone with `prepare-private.py` and `clone-db.py`; this is a
separate, read-only-from-live source action. `apply` then validates Compose
isolation, creates only the approved column-filtered PostgreSQL publication and
role, registers one pinned Debezium connector, and starts the durable reference
mapper and analytical sink. `verify` checks runtime topology/connector/physical
tables; the existing mapper/sink verifiers check synthetic data reconciliation.
`rollback` stops the two reference consumers and deletes only the exact owned
connector. It retains the publication, replication slot, topics, volumes and
credentials for replay and operator-controlled cleanup. The generated profile
and installer contain no DB password; a mode-600 private env file supplies the
declared secret reference at runtime. The earlier broad six-table experimental
publication is incompatible and must not be adopted silently.

## Acquisition stages

| Stage | Order fact authority | CDC output |
|---|---|---|
| Current/default | Native Medusa `order.placed` subscriber → `medusa.order_placed` | None |
| Shadow candidate | Native subscriber remains authoritative | Separate raw topics/projection; no canonical live conversion write |
| CDC primary candidate | CDC mapper after explicit conformance and cutover decision | Versioned source mapping, effect identity, rollback checkpoint |

The CDC mapper must distinguish snapshot `READ` records from new business occurrences and preserve raw change identity separately from the stable order-placement effect identity. If no database transition proves equivalence to the native event, the current adapter remains the **live** order fact authority until a CDC-only source contract passes conformance. The shadow [native-event WAL probe](../medusa-reference-cdc-shadow/NATIVE_WAL_MARKER_CONFORMANCE_2026-10-27.md) proved that post-event WAL emission can lose a marker when its write fails; this subscriber must not be generated as the sole-authority CDC binding without a durable commit/replay design. The eventual target still sends ecommerce data to Pipeline through CDC; browser HTTP is separate.

The separate [reference state contract](../medusa-reference-cdc-shadow/REFERENCE_ORDER_RECORDED_STATE_CONTRACT_V1.md)
has durable mapper and analytical sink evidence. DEC-119/135 now approve its
retractable, post-activation **current-state** meaning and separate metric/profile
identity for reference development. It is not a version of `order.placed` or
an active Commerce Conversion terminal. The installer intentionally emits no
canonical mapping or live funnel activation for it.

## First implementation gate

The first implementation gate is met for the **count-only shadow reference**:
Medusa 2.19.0 schema and successful/failed/retried order behavior were probed
in a separate PostgreSQL clone; a PostgreSQL inbox/outbox mapper and analytical
sink passed ON/OFF, restart, full replay and duplicate checks. Live Medusa
PostgreSQL remains outside this installer and has no CDC activation. Amount,
currency, historical bootstrap, load/WAL budget, source-owned cancellation,
and exact native `order.placed` equivalence remain open gates.
