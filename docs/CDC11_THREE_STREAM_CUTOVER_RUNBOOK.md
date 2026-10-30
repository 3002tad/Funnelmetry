# CDC-11: Medusa three-stream cutover and rollback

**Status:** THREE-STREAM TARGET SHADOW RUNNING / NO LIVE CUTOVER. **Date:** 2026-10-30. This is the operator runbook for replacing (1) the reference backend order adapter, (2) Admin API `catalog-sync`, and (3) inventory/price acquisition with CDC. It does not deploy an HTTP Gateway. DEC-119/135 currently approve order-state v2 semantics for shadow development only; CDC-12 live authority still requires a separate decision. The existing Browser SDK and its HTTP ingestion remain in service.

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
`funnelmetry_cdc_source` overlay was created but Medusa PostgreSQL was not yet
attached to it. The separate `funnelmetry_cdc_target_shadow` stack initially had six
services: Connect and four workers were `0/0`; only its dedicated order
mapper DB was scaled to `1/1`. Migration 024 was applied to that new DB and
its ten `reference_cdc_v2_*` tables were listed. Existing live `catalog-sync`
remained `1/1`. The candidate workers image used in the stack was built from
Pipeline `13d6108` with local image SHA-256
`ac52de46374e25ac0a85a9c412f992b8913fc0da2e168e4fa1a05a818eef9b8c`;
this is a VPS-local candidate image, not a registry release. No connector or
CDC worker was started. An approval-review limit temporarily prevented further
SSH checks; access was restored and the later state is recorded below.

**Pipeline candidate schema applied, 2026-10-30:** Pipeline commit `57dd1e4`
passed CI run `40930362138`, including a real PostgreSQL migration rehearsal.
On the VPS, `candidate-schema plan` returned `READY_TO_APPLY` and digest
`a609835ef8d64d980d7f61079d58f0fde0cc6e741cf7919e13197b24939f5501`.
Before apply, a custom-format dump of the 13 MB live Pipeline DB was saved
outside Git at `/srv/KLTN/.cdc11-backups/pipeline-pre-candidate-20261030.dump`
with mode 600 and SHA-256
`df37cc1850034bc3def499997d9e95a05bdba98286154775096b412de97fff8b`.
`pg_restore --exit-on-error` completed in a temporary PostgreSQL 15 container
with no network; source and restored databases each had 54 public tables, one
bootstrap row and 104 product-reference rows. The temporary container was
removed; the dump remains for recovery. The reviewed migration task returned
`APPLIED_CANDIDATE_ONLY` with the same digest. The journal contains three rows;
representative catalog, inventory/price and order candidate tables are empty.
The one-shot task is back at `0/0`, the dedicated order mapper DB at `1/1`,
and Connect plus four CDC workers at `0/0`. Live `catalog-sync` remains `1/1`.
No Medusa WAL/slot or live analytical binding was changed.

**Read-only source schema check, 2026-10-30:** All declared columns in the
three generated Medusa profiles (23 distinct tables: 3 order, 4 catalog,
16 inventory/price) were present in the VPS PostgreSQL catalog. All 23 tables
had primary keys, including composite link keys and `currency.code`; the
stage-2 v2 `deleted_at` columns were present. This is a name/key check only:
types, source permissions, publication filters, snapshots, relation
cardinality and continuous quality are not yet verified. Medusa remains at
`wal_level=replica` with zero replication slots.

**Medusa source backup/restore, 2026-10-30:** A custom-format dump of the
approximately 20 MB Medusa database was stored outside Git at
`/srv/KLTN/.cdc11-backups/medusa-pre-cdc-20261030.dump`, mode 600, SHA-256
`e970a77c38cea2a9e79c42aa754c8cff7e21cb454746e6a12de991636832a9ad`.
`pg_restore --exit-on-error` completed in a temporary PostgreSQL 15 container
with no network; source and restored DB each had 143 public tables, 104
products, 120 variants and four categories. The temporary container was
removed; the dump remains. Current settings are `max_replication_slots=10`,
`max_wal_senders=10`, `max_slot_wal_keep_size=-1`. These observed values are
not a reviewed WAL retention or outage budget; no source runtime setting was
changed.

**Private source network rollout, 2026-10-30:** The pre-rollout untracked Medusa
VPS Compose override had SHA-256
`8c9c7a4c57cc6f53a75d2358b01f033c69c6ae96980d772af74174924d608fce`.
The feature-branch network-only template was copied outside the live checkout
to `/srv/KLTN/.cdc11-medusa-network.yml` (SHA-256
`1e7236a40a70f9c96dba257432687943ec5fc4a6390f460caea00e090a920545`).
The sanitized Compose render preserved `postgres_data`, the default command,
and the `127.0.0.1:5432` binding; it added only the internal attachable
`funnelmetry_cdc_source` overlay with alias `medusa-cdc-postgres`. PostgreSQL
was recreated with base, VPS and network overrides, became healthy, and kept
the same Docker volume. The backend `/health` returned 200; product count was
104; DNS and TCP 5432 from the private overlay passed. `wal_level` remains
`replica`. Every future Compose recreation of this PostgreSQL service must
include the network override, or the CDC attachment will be removed. No
replication role, publication, slot, connector or CDC writer was activated.

**Logical-WAL shadow source rollout, 2026-10-30:** The source owner approved a
controlled PostgreSQL restart for CDC shadow. The Medusa branch adds a separate
logical-WAL Compose override and a rendered-config guard; the exact files were
copied outside the deployed checkout to `/srv/KLTN/.cdc11-medusa-logical.yml`
and `/srv/KLTN/.cdc11-check-cdc-source-config.mjs`. The guard returned
`CDC_SOURCE_CONFIG_MATCH` with `CDC_MAX_SLOT_WAL_KEEP_MB=1024`, preserving the
private alias, persisted volume and loopback port. PostgreSQL restarted healthy
with `wal_level=logical`, `max_slot_wal_keep_size=1GB`; backend `/health`=200,
product count=104, private overlay TCP PASS, zero replication slots. The
provisional 1 GiB cap uses less than 1% of the observed 132 GiB free filesystem
space and gives 4× the clone's 256 MiB cap. Treat 30 minutes as an operator
response target, **not** guaranteed retention: the clone workload did not
measure flash-sale WAL production, and PostgreSQL applies the slot cap at
checkpoint boundaries. Alert below 512 MiB `safe_wal_size`; block shadow
readiness below 256 MiB or if `wal_status` is not usable, pending a target
topology quality monitor and measured load. The source still has no CDC role,
publication, slot or connector and no live binding was switched. See
[PostgreSQL replication settings](https://www.postgresql.org/docs/15/runtime-config-replication.html)
and [slot status semantics](https://www.postgresql.org/docs/15/view-pg-replication-slots.html).

**Target three-stream shadow runtime, 2026-10-30:** The operator-side
`install-target-source.py` checked all 23 approved tables/PK columns and
prepared three distinct column-scoped replication roles and publications on
Medusa PostgreSQL. Protected credentials/journals are under
`/srv/KLTN/.cdc11-source-state` (mode 700/600), outside Git; their values were
not logged. `install-target-connect.py` registered catalog, inventory/price
and order-v2 initial-snapshot connectors against private
`medusa-cdc-postgres:5432`. All three connector tasks reached RUNNING and
three slots were active/reserved; latest sampled retained WAL was under 1 KiB
per slot with `safe_wal_size` about 1038 MiB. Snapshot completion appeared for
all three profiles. Kafka has auto topic creation disabled, so a separate
one-shot `install-target-topics.mjs` task explicitly created and verified 30
scoped topics; the completed task was removed after verification. The first
Connect attempt hit its 1536 MiB cgroup limit and was OOM-killed; only the
shadow Connect limit was raised to 2 GiB, after which its REST API and tasks
remained available. `infra/swarm-cdc-shadow.yml` now carries the same limit.

Candidate writers now run 1/1: catalog 104 products, 120 variants, four
categories and four links; stage-2 context 686 rows, equal to the sum of its
16 source tables. Their snapshot-complete flags are true. The order mapper
received one source order/cart/link and remained `BASELINING` until
`activate-target-order-baseline.py` independently compared the source rows,
durable mapper snapshot and all four raw topic ends with the mapper stopped.
The activation set epoch `cdc11_order_epoch1` to `BASELINE_VERIFIED` with one
active baseline order, digest
`be1b614a1de453ad3b9d421e3db0ff1a3d82c29e40b66def13542382deb08df4`,
historical gap `INCOMPLETE` and zero placement-ON facts. After restart, the
mapper emitted one BASELINE and one BASELINE_COMPLETE record. The separate
order sink has two inbox records, one current-state row and fact offset two.
The target read-only `verify-target-projections.py` then returned
`PASS_SHADOW_POINT_IN_TIME`: catalog source/projection digests both
`1281d4cd3317b9c5ae8252843274f5f5849aef605c962869ca40355495bf821a`,
all four catalog table rows/selected attributes and topic ends matched;
stage-2 row keys, soft-delete flags, selected attributes and topic ends matched
for all 16 tables. The source still has zero reservation rows and zero price
list/list-rule rows, so these cases require controlled nonempty validation.
The target order quality probe initially blocked because its shared evaluator
required a mapper offset row for the empty transaction topic. With no
transaction END record the Kafka end is zero and the mapper correctly has no
row; the evaluator now accepts only that exact empty-prefix case and keeps a
nonzero missing prefix blocked. Seven fault/quality unit tests PASS. Two
independent target samples then returned `PASS_SHADOW_POINT_IN_TIME` with all
order checks true: source/mapper/sink state digest
`2311457e5802cf6f037ff7b12132b92229d881a49f4a32002774531185f98c6a`,
one current order and fact offset two. No continuous lease was established.
One explicitly acknowledged Store API checkout then created reference order
`order_01M65HX4QF1M8A84N97AF3KA83` while the native adapter and CDC shadow
both ran. The order quality probe again returned all checks true with two
source/mapper/sink current orders and fact offset four. Inbox types were one
BASELINE, one BASELINE_COMPLETE, one inactive STATE and **one active
TRANSITION** for the new order; no baseline row became a placement ON. The
catalog and stage-2 point-in-time reconciliation still passed after checkout.
This verifies target post-baseline ON propagation but not OFF, replay,
long-outage recovery or the versioned funnel read path.
The operator-side `monitor-target-quality.py` subsequently compared two stable
source/projection samples for all three streams. Its dry run and candidate
write both passed: 104 products, 16 stage-2 tables, two current orders and
fact offset four. A 240-second lease was written only to
`catalog_cdc_quality_lease`, `inventory_price_cdc_quality_lease` and
`reference_cdc_v2_quality_state`; the latter remains a reference current-state
gate, not a placement/conversion claim. The catalog binding has no active row.
`infra/systemd/funnelmetry-cdc-shadow-quality.service` runs the same operator
check repeatedly on the VPS; failure blocks candidate quality, and a stopped
monitor lets its leases expire. Verify service logs and fresh lease timestamps
before treating a candidate read as current. Each PASS journal line includes
the minimum slot safe WAL MiB and names any slot below the provisional 512 MiB
alert threshold; a slot below 256 MiB blocks the lease. After a post-restart
cycle took about 194 seconds including the configured 60-second pause, both
target verifiers were changed to read all Kafka topic ends in one exact
partition-checked query per sample. The first optimized cycle finished 14
seconds after service start; with the 60-second pause this gives a much wider
lease margin at the observed idle workload. Sustained load remains unmeasured.
Neither the monitor nor a PASS
candidate lease switches the Dashboard or grants CDC-12 authority.
The monitor also requires one running container for each of the four shadow
workers at both ends of its sample. A missing/replaced worker blocks the
candidate lease, including when the first container inventory fails. This
guard is necessary during a deliberate worker replay: matching old DB rows
alone do not show that a stopped consumer can process a new source change.
This proves a shadow snapshot chain with a bounded reconciliation lease on
target topology, **not** full target-topology stream conformance,
inventory availability/price resolution,
funnel read-path readiness, production load budget or CDC-12 authority. The
native adapter, Source Connector, Dashboard `admin_api` binding and
`catalog-sync` remain active. A reviewer rejected widening the private script
directory from 700 to 755 and changing the one-shot task to run as root; a
separate directory containing only non-secret script/profile copies was used
for that read-only mount, leaving private credentials inaccessible to it.

**Target replay and fail-closed rehearsal, 2026-10-30:** Four CDC-only Kafka
consumer groups were individually stopped, inspected, reset to earliest and
restored. Catalog replay left 232 ingest-audit records and 104 products;
inventory/price replay left 686 ingest-audit records; order sink replay left
four inbox records, two current-state rows and fact offset four; order mapper
replay left four outbox records, two state rows and epoch `BASELINE_VERIFIED`.
The target source/projection probes again returned `PASS_SHADOW_POINT_IN_TIME`
for catalog, all 16 stage-2 tables and order (two rows, fact offset four).
The new monitor also checked all four worker containers twice. Stopping only
the catalog writer and invoking one monitor cycle returned
`BLOCKED_BY_QUALITY`; all three candidate lease rows became blocked. After
restoring that worker, a fresh two-sample check returned `PASS_SHADOW_LEASE`,
minimum slot safe WAL 1038 MiB, with catalog/stage 2 `PASS` and order
`CURRENT_STATE_READY`. This is conservative all-stream shadow blocking; a
future independent cutover needs a reviewed per-stream failure policy. The
replay does not prove recovery from lost Kafka data, a lost PostgreSQL slot,
long Connect outage or production load.

**Short Connect outage with a real reference checkout, 2026-10-30:** Before
stopping only shadow Connect, the source had two orders at WAL LSN `0/21DF670`;
all three slots were `reserved` with about 80 KiB retained each and more than
1 GiB safe WAL headroom. During Connect `0/0`, a Store API checkout created
`order_01M65MDEFTNV1AQGBGW1ZH7MG5`; the source had three orders at LSN
`0/21F6308`, all slots stayed `reserved`/inactive and retained about 173 KiB.
The live adapter continued independently. After restoring Connect, all three
tasks reached RUNNING and the target verifiers again passed. The order sink
contained three current orders, exactly two `TRANSITION` records overall and
fact offset six; the new order was active and joined to its cart. Catalog
still had 104 products and all 16 stage-2 tables reconciled. The monitor
reported `BLOCKED_BY_QUALITY` while Connect was absent and while the new
projection was catching up, then `PASS_SHADOW_LEASE` at 05:29:24 UTC with
minimum safe WAL 1038 MiB. All three slots were active/reserved again. This
establishes bounded short-outage catch-up on the target, not the proposed
30-minute response target, p95/p99 lag, load budget, lost-slot recovery or
CDC-12 authority.

**Target Store API comparison, 2026-10-30:** The read-only
`verify-target-inventory-price-resolver.py` selected one eligible published
product/managed variant from the Medusa source, required source numeric/raw
inventory and price equality (zero mismatches), checked all catalog and
stage-2 CDC source/projection digests and topic offsets before and after the
Store API request, and evaluated the governed resolver candidate. For
`prod_01M5WHNDPT1QDJMTGGKXDPZWDY` /
`variant_01M5WHNDSH42DT338YNS18RXCQ`, all checks passed: inventory quantity,
default price amount and EUR currency matched Medusa Store API. The probe
reported `PASS_SAMPLE_ONLY`; its supported shape is one inventory item across
eligible locations and a simple default price. Price-list/rule/tier,
reservation, backorder, kit multi-location and other channel contexts remain
unverified on this target source. No inventory or price analytical asset was
published, and no historical order amount was changed.

## 1. VPS inventory and baseline provenance

The table combines the 2026-10-29 preflight with the 2026-10-30 shadow
rollout. Runtime evidence above is the latest checkpoint; recheck services,
slots and free space before any new operation.

| Item | Observed state | Consequence |
|---|---|---|
| Medusa | `/srv/KLTN/dtc-starter-funnelmetry`, deployed integration branch at `efc7a58`; Compose `medusa_reference` | Its native `order.placed` subscriber still serves the live reference funnel. The CDC feature branch is not deployed. |
| Medusa PostgreSQL | PostgreSQL 15 container; logical WAL and provisional 1 GiB slot cap; three scoped slots active/reserved after the short outage; backup and isolated restore passed | Source transport is running in shadow. Slot-loss recovery and measured production budget remain open. |
| DB network | Port 5432 remains bound to host `127.0.0.1`; Medusa PostgreSQL is now also attached to `funnelmetry_cdc_source` with alias `medusa-cdc-postgres`; Pipeline uses `funnelmetry_vps_live_data` | Private DNS/TCP checks passed. Replication credentials, publication and WAL configuration remain gated. Do not publish PostgreSQL to the public Internet. |
| Pipeline | `/srv/KLTN/Funnelmetry` live checkout at `b1c0a35` on `main`; candidate migrations 021–023 applied in its PostgreSQL DB; separate CDC shadow stack has Connect plus four workers running | `catalog-sync` and `source-connector` remain `1/1`; candidate quality leases do not change the Dashboard or order authority. |
| Resources | `/var/lib/docker` filesystem: 158 GB total, 134 GB available; host RAM: 15 GiB total, about 11 GiB available at observation time | These are a single observation, not a WAL/flash-sale budget or capacity approval. |
| Shadow projects | `funnelmetry_cdc_target_shadow` has Connect, four workers and mapper DB at `1/1`; the candidate-schema task is `0/0`. Older isolated clones also exist. | Never share a clone slot/topic/consumer group with the target shadow. Inventory clone resource reservations before a load rehearsal. |

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
- The Medusa source branch has `runtime/docker-compose.cdc-shadow.example.yml` as a network-only override template. The first VPS rollout attached PostgreSQL to the pre-created external `CDC_SOURCE_NETWORK` while preserving its `default` network. Keep the distinct `medusa-cdc-postgres` alias in Connect's source DB URL; `postgres` already resolves to the Pipeline database on the other overlay. The example does not change WAL settings or create credentials. Reconfirm the rendered Compose config, running network membership and DNS from the Connect network before connector creation or after a PostgreSQL recreation.
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

At the latest checkpoint, **live cutover is blocked** by incomplete target-topology stream conformance and production workload/WAL budget, no order-v2 funnel/profile read path, and no verified stage-2 inventory/price resolver. A bounded operator-side quality monitor is running for three candidate streams, but its PASS lease is neither production freshness certification nor CDC analytical authority. The next executable work is target update/delete/replay and fault/load probes, followed by versioned read-path/resolver conformance and explicit CDC-12 authority decisions per stream. This document does not grant permission to promote a CDC source or change live analytical authority.
