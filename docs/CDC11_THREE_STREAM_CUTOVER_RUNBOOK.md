# CDC-11: Medusa three-stream cutover and rollback

**Status:** CANDIDATE / NOT EXECUTED. **Date:** 2026-10-29. This is the operator runbook for replacing (1) the reference backend order adapter, (2) Admin API `catalog-sync`, and (3) inventory/price acquisition with CDC. It does not deploy an HTTP Gateway. DEC-119/135 currently approve order-state v2 semantics for shadow development only; CDC-12 live authority still requires a separate decision. The existing Browser SDK and its HTTP ingestion remain in service.

**Development update 2026-10-30:** The Medusa manifest/planner now emit a
separate order-v2 shadow profile for a declared coverage epoch with initial
snapshot, exact order predicate columns and a guarded rollback plan. The
planner's `verify` checks source-file ownership and artifact equality only;
it reports `runtimeConformance=NOT_CHECKED_BY_INSTALLER`. The existing v1
shadow profile remains historical, and only the v2 epoch may be selected for
a future target-topology rehearsal. The installer has not started Connect,
configured logical WAL or changed live order authority. Before running Medusa
workflows, pin `FUNNELMETRY_PLANNER_REF` to the reviewed Pipeline commit that
understands `cdc_order_v2_shadow`.

Read-only VPS check on 2026-10-30 still found Medusa PostgreSQL
`wal_level=replica` with zero replication slots; the deployed Medusa checkout
remains `efc7a58`, Pipeline checkout `b1c0a35`, and live `catalog-sync` plus
Source Connector remain active. The workers image from Pipeline `98ce920`
built successfully in a separate VPS worktree and all four CDC worker entry
points passed `node --check` inside an offline container. No live Swarm task
uses that candidate image. These checks do not satisfy the source/release,
continuous quality or CDC-12 gates below.

**Target shadow progress, 2026-10-30:** An encrypted, internal, attachable
`funnelmetry_cdc_source` overlay was created but Medusa PostgreSQL is not
attached to it. The separate `funnelmetry_cdc_target_shadow` stack has six
services: Connect and four workers remain `0/0`; only its dedicated order
mapper DB was scaled to `1/1`. Migration 024 was applied to that new DB and
its ten `reference_cdc_v2_*` tables were listed. Existing live `catalog-sync`
remained `1/1`. The candidate workers image used in the stack was built from
Pipeline `13d6108` with local image SHA-256
`ac52de46374e25ac0a85a9c412f992b8913fc0da2e168e4fa1a05a818eef9b8c`;
this is a VPS-local candidate image, not a registry release. No connector or
CDC worker was started. A subsequent read-only VPS check was rejected by
automatic approval review because its usage limit was reached; no later VPS
state is claimed in this document until access can be checked again.

## 1. Current VPS preflight inventory

Read-only checks on `ssh kltn`, 2026-10-29:

| Item | Observed state | Consequence |
|---|---|---|
| Medusa | `/srv/KLTN/dtc-starter-funnelmetry`, deployed integration branch at `efc7a58`; Compose `medusa_reference` | Its native `order.placed` subscriber still serves the live reference funnel. The CDC feature branch is not deployed. |
| Medusa PostgreSQL | PostgreSQL 15 container, `wal_level=replica`, **0** replication slots, `max_slot_wal_keep_size=-1` | Logical CDC is not enabled. A finite WAL retention/resource policy, source backup and controlled restart are prerequisites. |
| DB network | Port 5432 bound to host `127.0.0.1`; Medusa on `medusa_reference_default` bridge; Pipeline on `funnelmetry_vps_live_data` overlay | Kafka Connect in Pipeline cannot use the current loopback binding. Establish a dedicated, non-public source-to-CDC network and least-privilege replication access before runtime conformance. Do not publish PostgreSQL to the public Internet. |
| Pipeline | `/srv/KLTN/Funnelmetry` at `b1c0a35` on `main`; `funnelmetry_vps_live` has 18 Swarm services | `catalog-sync` and `source-connector` are both `1/1`; Pipeline live is not running the feature-branch CDC writer or migration 021. |
| Resources | `/var/lib/docker` filesystem: 158 GB total, 134 GB available; host RAM: 15 GiB total, about 11 GiB available at observation time | These are a single observation, not a WAL/flash-sale budget or capacity approval. |
| Shadow projects | Separate CDC clones exist; one older `funnelmetry_cdc_shadow` project was running during inventory | Never point a live connector at a clone slot/topic or share a clone consumer group with live. Inventory active shadow projects and resource reservations before live rehearsal. |

The Medusa runtime override `runtime/docker-compose.vps.yml` is untracked on the server; capture its sanitized checksum, network/volume/command delta and deployment provenance before any DB restart. Do not copy its secrets into Git or evidence.

## 2. Authority and rollback invariants

1. **Order:** `reference.medusa.order_recorded_state.v2` is a retractable current-state fact keyed by source, coverage epoch and order. Snapshot rows are BASELINE, never placement ON. WAL gaps remain `INCOMPLETE`. It is not an alias of native/canonical `order.placed`, nor a source for historical placed-order value. A new terminal/profile/metric version and UI labels are required before switching the reference funnel. Keep old historical assets explicitly versioned.
2. **Catalog:** stage-1 product/variant/category/link CDC may replace only the API-created current descriptive reference names after source reconciliation, stable coverage/freshness and guarded read-path validation. Historical order amount and quantity remain from point-in-time order facts.
3. **Inventory/price:** stage-2 v1 16-table context capture omitted `deleted_at` on 12 tables and is historical shadow evidence only. Use the corrected v2 allowlist and a fresh snapshot/slot/topic/epoch. Neither version is yet a sellable-stock/display-price resolver. Do not publish those claims until the dependency graph, nonempty reservation/price-list fixtures, Medusa API conformance and production quality gate pass.
4. One authoritative writer per **business effect and asset**. Shadow CDC may coexist with adapter/API sync only in disjoint tables, topics, profile IDs or bindings. Do not merge order v2 ON with canonical `order.placed` or count both in one funnel.
5. Keep the native subscriber and Source Feed producing during the rollback window, but isolate/deactivate its **analytical** terminal when v2 becomes authoritative. This preserves a rollback input history only within verified Event Feed retention. After the window and a separate CDC-13 decision, remove the installer-owned subscriber; the browser/storefront HTTP path remains.
6. A source DB slot loss, schema/column drift, Kafka offset gap, incomplete snapshot, expired quality lease, source/projection mismatch or insufficient WAL headroom must block the affected CDC asset. Never re-create a lost slot with `no_data` and call it continuous; start a new epoch, baseline current state and retain the historical gap as incomplete.

## 3. Release and source-side gate

Before touching live Medusa PostgreSQL, record a reviewed manifest with environment ID, source owner, full Medusa/Pipeline commit SHAs, immutable image digests, schema migration checksums, generated installer profiles, table/column allowlists, secrets by reference, existing source-feed lineage/cursor, target Kafka topics/groups, and rollback owner. A feature-branch commit or green CI job is not a deployed image or runtime acceptance.

For the three generated source profiles, match `source_id` and the distinct
`coverage_epoch_id` values to `CDC_SOURCE_ID`, `CDC_ORDER_EPOCH`,
`CDC_CATALOG_EPOCH` and `CDC_INVENTORY_PRICE_EPOCH` in the target shadow stack.
The catalog and inventory/price artifact schemas are now v2 and v3,
respectively; their domain contracts did not change. The exact older artifacts
can be upgraded by the reviewed CI planner patch. Pin the new planner commit
before running Medusa workflows; an old planner must reject the new manifest.
Run `node tools/medusa-reference-cdc-shadow/check-target-profiles.mjs
--medusa-root <Medusa checkout>` with the exact non-secret `CDC_*` environment
variables intended for `infra/swarm-cdc-shadow.yml`. It fails closed on an
older profile, mismatched epoch/source/topic or resource collision. A PASS
confirms configuration alignment only; it does not check PostgreSQL, Connect,
Kafka offsets or runtime freshness.

The separate `infra/swarm-cdc-shadow.yml` is a candidate for the target VPS:
Kafka/authoritative Pipeline PostgreSQL are reached through the existing
Pipeline overlay; Connect reaches Medusa PostgreSQL through an additional
private, attachable source overlay; the order mapper has its own database and
volume. It publishes no host ports. Its Connect, mapper DB and four CDC worker
services default to **zero replicas**. Do not scale a worker before its
schema, exact Kafka topics/groups, source publication/slot, credentials,
initial snapshot and retention budget are checked. Catalog/stage-2/order sink
write only their separate candidate tables in the Pipeline database; no
Dashboard provider or order profile is switched by this file. The shared CDC
PostgreSQL helper accepts Docker password/DSN files without putting credentials
in YAML. The Compose clone Dockerfiles now build from the repository root so
they include that helper. This stack is not a substitute for the source-owner
PostgreSQL overlay and approved `wal_level`/role/publication changes.

For the **existing** Pipeline PostgreSQL database, use
`infra/bootstrap/cdc-candidate-migrations.mjs plan` through the shadow stack's
`candidate-schema` service. It checks `handoff_bootstrap=READY`, confirms
that candidate objects are absent or all three journaled migrations match,
then emits a combined SHA-256 digest. To apply 021–023, redeploy only the
shadow stack with `CDC_MIGRATION_MODE=apply`, the reviewed digest as
`CDC_EXPECTED_MIGRATION_DIGEST` and
`CDC_SHADOW_MIGRATION_ACK=CDC11_CANDIDATE_ONLY`; scale `candidate-schema`
from zero to one, inspect its terminal log and journal, then scale it back to
zero. The migrator uses one transaction and rejects a partial/unowned
candidate schema. Migration 024 belongs to the separate order mapper DB and
must be applied there, as in the shadow rehearsal; this tool never applies it
to Pipeline PostgreSQL. Do not call the fresh-database `bootstrap-swarm` on
the existing live Pipeline database.

The fresh-database bootstrap now pins the original v2 core list through
`020_product_reference.sql`; it does not discover numbered CDC candidate SQL
by scanning the directory. This preserves the pre-CDC baseline schema digest
and prevents mapper-only migration 024 from entering the Pipeline database.
Migrations 021–023 remain an explicit, separately journaled candidate upgrade.
The pinned baseline includes exactly the same twenty core SQL files as
`origin/main` at this review; future baseline schema changes need an explicit
manifest and digest review.

- Freeze the Medusa version and compare actual `pg_catalog` schema, primary keys and soft-delete columns with the order-v2, catalog-stage-1 and inventory/price-stage-2 profiles. Refuse drift; do not broaden publication to `FOR ALL TABLES`.
- Backup and restore-test Medusa PostgreSQL plus the Pipeline authoritative DB before changing `wal_level`. Record source DB backup checkpoint and separate Pipeline processing-safe checkpoint. A file checksum alone is not a restore test.
- Source owner approves a dedicated replication role with only the required logical replication/SELECT grants, three separate publications/slots or a reviewed equivalent, column allowlists, PII exclusions, `pg_hba` scope and credential rotation. Each connector/profile needs distinct slot, topic prefix, consumer group and coverage epoch. Size `max_replication_slots`, `max_wal_senders`, finite `max_slot_wal_keep_size`, disk alert thresholds and outage budget from a measured production workload; clone values are not production defaults.
- Create a dedicated protected Docker network between the Medusa PostgreSQL container and the Pipeline Connect service, or an equivalently governed private DB transport. Keep PostgreSQL off public ports. Verify DNS/port, authentication, role restriction and end-to-end TLS policy for the chosen topology before starting Connect. The current `127.0.0.1:5432` host port is not a connection address for a Swarm overlay task.
- The Medusa source branch has `runtime/docker-compose.cdc-shadow.example.yml` as a network-only override template. With a reviewed source-owner rollout, attach PostgreSQL to the pre-created external `CDC_SOURCE_NETWORK` while preserving its `default` network. Use the distinct `medusa-cdc-postgres` alias in Connect's source DB URL; `postgres` already resolves to the Pipeline database on the other overlay. The example does not change WAL settings or create credentials. Confirm the rendered Compose config, running task membership and DNS from the Connect network before connector creation.
- Apply the approved PostgreSQL logical-WAL change through the source runtime owner, then restart under a maintenance/rollback plan. Verify `wal_level=logical`, active slot states, publication columns, PostgreSQL health, Medusa checkout health and WAL headroom. Failure returns to the original source configuration and leaves live adapter/API sync authoritative.

## 4. Shadow on target topology, by dependency order

1. Deploy pinned Kafka Connect and raw CDC topics with names separate from the clone projects and from the existing Source Connector. Start **catalog stage 1** initial snapshot, then stage 2 initial snapshot, then order v2 epoch snapshot/transaction stream. Record a source LSN/transaction checkpoint for each profile; do not compare unrelated Kafka offsets as one global sequence.
2. Run candidate writers into separate governed tables. Apply migration 021 for stage 1, migration 022 for stage-2 context, migration 023 for the order v2 sink and migration 024 for its mapper DB; keep the catalog binding `SHADOW` and Dashboard provider `admin_api`. Migrations 022–024 create no active business analytical binding. Check stage-2 source keys/relations and order-v2 mapper/sink schema independently. The [stage-2 governed candidate clone evidence](../tools/medusa-reference-cdc-shadow/INVENTORY_PRICE_GOVERNED_CANDIDATE_EVIDENCE_2026-10-29.md) proves context/replay and one-shot lease invalidation only; [order v2 mapper→sink evidence](../tools/medusa-reference-cdc-shadow/REFERENCE_ORDER_V2_MAPPER_CHAIN_CANDIDATE_EVIDENCE_2026-10-29.md) proves chain/replay on preserved clone raw topics only. Neither is a target-topology production quality monitor. Do not move clone volumes or Kafka offsets into live.
3. Reconcile source rows and relationships at a declared checkpoint: counts and row-level digest, snapshot-complete marker, per-topic end/applied offsets, connector/task status, slot/WAL state, orphan checks, source identity, epoch and observed lag. Repeat while Medusa receives real updates; check update, soft/hard delete, relation change, duplicate, replay, restart and outage. A PASS at one instant is not a continuous freshness guarantee.
4. For order v2, verify BASELINE produces no ON; after activation, successful checkout produces one ON and compensation produces OFF as specified. Check cart/order/journey binding, event-time basis, correction propagation to funnel and UI, and `INCOMPLETE` behavior after any gap. Do not infer order amount/currency or native placement from current-state snapshot.
5. For stage 2, validate inventory per product/variant, sales channel and eligible stock location with required item quantities and reservations; compare controlled cases with Medusa 2.19.0 Store API. Price needs currency, region, quantity tier, price-list period/status and rule context; compare controlled cases with Medusa's calculated price. Empty source tables must receive controlled nonempty test cases in a clone first. Any unsupported rule/context yields `UNVERIFIED`, not a guessed display price.
6. Run target-topology fault and load tests with measured Medusa CPU/IO, WAL retained bytes, slot safe headroom, Connect/Kafka backlog, snapshot duration and p95/p99 source-to-readable lag. Define the acceptable thresholds explicitly in the cutover record; the CDC-10 clone budget is insufficient for production approval.

## 5. CDC-12 cutover sequence (gated; not yet authorized by this document)

The source owner and Pipeline owner approve one cutover record per stream after §3–4 PASS. Each record includes barrier/checkpoint, exact image/profile/schema versions, start/end time, success and stop criteria, and a rollback deadline with replay retention evidence.

| Stream | Switch | Required immediate check | Rollback before deadline |
|---|---|---|---|
| Catalog stage 1 | Activate one CDC binding/quality monitor; set Dashboard provider to `catalog_cdc`; only then scale `catalog-sync` to zero | Dashboard references match source for sampled and aggregate products, no missing names beyond declared quality, lease remains fresh | Restore `admin_api` provider and `catalog-sync`, reconcile API snapshot; keep CDC shadow for investigation. Do not overwrite historical order facts. |
| Order v2 reference | Publish versioned reference profile/metadata and make it the **only terminal for that new profile**; explicitly retire old live profile for new official reference comparisons | New checkouts produce correct ON/OFF, cart/journey joins and corrections; no double count with native `order.placed`; old historical conversion remains separately labeled | Revert profile activation and analytics read path. Native subscriber/Source Feed history must still cover the interval; replay/dedup against the prior profile before declaring old semantics restored. If coverage is lost, report an explicit gap. |
| Inventory/price | Activate separately governed analytical assets only after Medusa API conformance and continuous quality PASS | Variant/channel/location and price-context results agree with controlled source cases; money is currency scoped; no historical order-value rewrite | Disable the affected asset/binding and return `BLOCKED_BY_QUALITY`; raw CDC context remains for audit. No fallback to an unqualified one-row inventory or catalog-price claim. |

After each stream, monitor a bounded observation window with source/projection digest, Kafka/DB offsets, WAL headroom, lag, quality lease, Dashboard/API errors and source checkout health. Stop the next stream if any invariant fails. The exact duration and thresholds are `OPEN` until the release record is approved.

## 6. CDC-13 cleanup gate

Only after the rollback window expires and all consumers/dependencies are inventoried: remove the installer-owned backend order subscriber in a reproducible Medusa branch/installer release; revoke its signing credential; retire old order profile with historical audit preserved; remove `catalog-sync` service and its Admin API sync credential; archive old API-created reference tables only under a migration/retention policy. Do not remove Medusa Admin/Store API, Browser SDK, Source Ingress/Event Feed/Connector used by browser events, or shared volumes as part of this CDC-only change.

## 7. Present stop conditions

At the date of this inventory, **live cutover is blocked** by `wal_level=replica`, no replication slot, an unapproved DB network/role/WAL budget, no target-topology conformance, no continuous live quality service, no order-v2 funnel/profile read path, and no verified stage-2 inventory/price resolver. The next executable work is to close these gates on the feature branches and run a target-topology shadow rehearsal. This document does not grant permission to modify live Medusa DB settings or promote a CDC source.
