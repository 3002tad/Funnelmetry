# CDC-11: Medusa three-stream cutover and rollback

**Status:** THREE-STREAM TARGET SHADOW RUNNING / NO LIVE CUTOVER. **Date:** 2026-10-30. This is the operator runbook for replacing (1) the reference backend order adapter, (2) Admin API `catalog-sync`, and (3) inventory/price acquisition with CDC. It does not deploy an HTTP Gateway. DEC-119/135 currently approve order-state v2 semantics for shadow development only; CDC-12 live authority still requires a separate decision. The existing Browser SDK and its HTTP ingestion remain in service.

**Read the latest checkpoint first:** Sections below record rollout in chronological
order; early statements about `wal_level=replica`, stopped workers, or absent
slots describe earlier checkpoints. The current source uses logical WAL and
three scoped slots; Connect and four shadow workers are running. The live
Dashboard still uses API catalog sync, and the native order adapter still
supplies `order.placed`. CDC-11 has specific remaining gates in Section 7;
CDC-12 authority and CDC-13 retirement follow only after those gates. The
candidate migration tool now accepts an exact applied journal prefix so
additional versioned candidate schema can be applied without replaying 021–023
or clearing the existing CDC projections; it still requires a reviewed digest.

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

**Current-catalog stage-2 coverage and Store API batch comparison,
2026-10-30:** Read-only audit `1dbdcab` reconciled source/projection before
and after enumerating all 120 published variant/channel/EUR contexts. The
resolver returned a supported inventory shape for all 120 (100 unmanaged,
20 single-item managed at eligible locations) and a simple default price for
all 120. Commit `c88ef9d` then fetched 104 products through the local Medusa
Store API using two existing publishable keys, compared every variant's CDC
candidate price/currency and the 20 managed variants' inventory quantities,
and returned `PASS_CURRENT_SOURCE_SHAPES_ONLY`: 120 matched, zero mismatches.
The comparison did not write source or Pipeline data; it guarded numeric/raw
source consistency and required source/projection/offset stability before and
after the API reads. The source presently has zero reservation items, zero
price lists and zero price-list rules. Its two `price_rule` rows are linked to
price sets without a current variant link; they do not cover an active Store
API variant. Therefore this is broad conformance for the **current simple
catalog shape**, not proof of reservation, backorder, price-list/rule/tier,
multi-location kit or future catalog changes. No availability or price asset
has been activated, and historical order amounts remain untouched.

**Catalog candidate read path without activation, 2026-10-30:** The target
`catalog_cdc_binding` table has no row for `medusa-reference`. In one Pipeline
PostgreSQL transaction, an `ACTIVE` binding for `cdc11_catalog_epoch1` was
inserted, the guarded `current_product_reference_names_cdc` view was compared
with the current API-sync view, and the transaction was explicitly rolled
back. Both views returned 104 product names with zero missing IDs or title
mismatches. A query after rollback confirmed zero binding rows. This tests
the candidate view against current descriptive names while leaving the
Dashboard provider `admin_api` and `catalog-sync` unchanged. It does not
constitute a CDC-12 decision, sustained quality evidence or a live cutover.

**Target catalog update, soft delete and relation-change transport,
2026-10-30:** A seed product with zero order-line references
(`prod_01M5WHNCECKPB2WA8QDM3WDVNG`, originally `Powder Canister`) was
changed through narrowly guarded PostgreSQL test statements and restored
immediately to its exact original title, `updated_at` and `deleted_at=NULL`.
The CDC product audit/projection saw title update and restore at offsets
104/105, soft delete and restore at offsets 106/107; the final projected row
is present, not soft deleted, and has its original title/timestamp. A temporary
Merch category link for the same product was seen as `c` at offset 4 and `d`
at offset 5; both source and projection returned to zero links for that
product. The target source/projection verifier then passed across catalog
(104 products, 120 variants, four categories/four links) and all 16 stage-2
tables, with matching digests and caught-up offsets. The catalog quality lease
blocked during the temporary relation change and later returned to fresh
`PASS`; catalog binding remained absent. These guarded direct DB mutations
prove WAL/CDC projection and restoration on the target. They do not certify
Medusa Admin API workflows or source-owned business lifecycle behavior.

**Target stage-2 price update transport, 2026-10-30:** A simple EUR price row
(`price_01M5WHND4WXSD7BJ0CMSR1X1PG`) for the same unreferenced seed product
was changed under exact-value guards from 13.79 to 14.79, updating both
Medusa's numeric `amount` and `raw_amount.value`. The stage-2 context
projection observed 14.79 at price-topic offset 146. The source row was then
restored to 13.79, its original raw JSON and original `updated_at`; the
projection returned to 13.79 at offset 147, with two `u` audit entries.
The target verifier again passed source/projection equality across catalog
and all 16 stage-2 tables. This is CDC transport/update evidence from guarded
direct DB test statements; it is not Medusa price-workflow conformance,
price-list/reservation coverage, or authority for a live pricing asset.

**Order journey correlation check, 2026-10-30:** The initial target canonical
`checkout.started` carried `relations.correlation_id = cart:<cart_id>` rather
than `relations.cart_id`. The shadow reader now accepts the exact approved
correlation form, while rejecting contradictory cart keys. Its SQL prepared
and returned the strong CART journey plus checkout event for the baseline
order's cart on the live Pipeline DB. Baseline remains `BASELINE_ONLY` and
cannot become an ON terminal. The two post-baseline orders created through
Store API have no browser checkout event; they remain unbound for funnel use.
No official funnel profile/read binding has been activated.

**Post-baseline browser checkout correlation, 2026-10-30:** A fresh Edge
session accepted the tracking notice, added one reference product, completed
address/delivery and placed an order using Manual Payment. Medusa confirmed
`order_01M65NWVVQ1WK7ZATYZK8BKBRB` for cart
`cart_01M65NR4RZN8WS853F7MDG6CND`. The browser stream produced canonical
`checkout.started` event
`can_3a5c831023ddb67eddbb0e47b6c930b5325ad1ab554676506f9a693f74187fb0`
with exact `relations.correlation_id = cart:cart_01M65NR4RZN8WS853F7MDG6CND`.
The target order-v2 sink caught up to four current orders and fact offset
eight; this order is active at offset seven with a post-baseline ON transition
whose cart matches the current state. The candidate SQL returned exactly one
`STRONG` CART journey (`journey_346cf459bc85d4482011df93f11341250009fc9d39c87e47bcd6eec6143b50b7`)
and that checkout event for the same cart. The quality lease first blocked
during projection catch-up and became `CURRENT_STATE_READY` after the monitor's
next successful cycle at 05:54:10 UTC. These inputs satisfy the shadow
reader's `BOUND_SHADOW` predicate for this order; no official funnel terminal
or analytical binding was changed. The test uses one browser order and does
not establish cross-traffic completeness or production latency.

**Full shadow reader on the target, 2026-10-30:** Pipeline commit `a5b01fc`
adds a read-only order probe that calls the existing lease/revision guarded
`createShadowOrderJourneyReadPath`; CI run `41011511568` passed. The worker
image built from that commit is pinned as
`funnelmetry/cdc-workers-candidate@sha256:460a668f938d2241c3c5692265dd1d1c60e04562bfea4a2ee173be05211b7d99`
for the order-sink shadow service only. Running the probe in that service
returned `BOUND_SHADOW` for the browser order above, with its expected strong
journey and checkout event. It returned `BASELINE_ONLY` for
`order_01M5XWG33TD2A4EGX94NYA3EQZ` and `CHECKOUT_UNVERIFIED` for the
post-baseline Store API order `order_01M65HX4QF1M8A84N97AF3KA83`; the
non-bound results deliberately exit nonzero. The order-sink converged to
`1/1`; the three-stream monitor continued to report `PASS_SHADOW_LEASE` with
four current orders, fact offset eight, 104 products, 16 stage-2 tables and
minimum safe WAL 1037 MiB. Live `catalog-sync` and Source Connector stayed
`1/1`. This proves the reader predicate on the target for these three cases,
but does not activate a versioned funnel profile or test correction/OFF.

**Target order OFF and restoration, 2026-10-30:** The dedicated browser test
order `order_01M65NWVVQ1WK7ZATYZK8BKBRB` was temporarily soft deleted by
a guarded direct PostgreSQL statement after verifying its exact completed
cart link; it was then restored to `deleted_at=NULL`. The order-v2 sink
recorded `TRANSITION active=false` at fact offset eight, followed by
`TRANSITION active=true` at offset nine. Current state is again active for
the original cart, with fact next offset ten. The quality monitor returned
`BLOCKED_BY_QUALITY` while source/mapper/sink were catching up, then
`PASS_SHADOW_LEASE` at 06:44:56 UTC after the target order verifier passed
source/mapper/sink equality, ordered prefix and caught-up offsets. The full
guarded reader again returned `BOUND_SHADOW` for the same journey and
checkout event after restoration. This proves OFF/re-entry and fail-closed
catch-up on the target for a controlled DB change. It is not a Medusa Admin
workflow or a published funnel correction/UI test; the latter remains open.

**Correction read-model candidate (migration 025):** A separate read-only
`reference_cdc_v2_funnel_terminal_candidate` view joins the guarded v2 order
state to exactly one strong cart journey and a matching `checkout.started`.
Only a latest post-baseline ON transition with the same cart is visible. OFF,
baseline-only state, corrected cart without new ON, missing checkout and an
expired quality lease remove the candidate from the query result immediately.
The migration does not publish a Funnel Profile, write canonical events,
change `order.placed`, or expose the candidate in Dashboard. CI exercises
baseline→ON→OFF→ON and lease expiry in a rolled-back PostgreSQL transaction.
Target runtime verification and a versioned reference profile/API/UI binding
remain separate CDC-11 work.

**Target migration 025 and correction query, 2026-10-30:** CI run
`41018070468` passed the real PostgreSQL migration rehearsal and the
rolled-back baseline→ON→OFF→ON→lease-expiry regression. On the VPS the
Pipeline candidate journal first contained exactly 021–023 with the reviewed
checksums. The SQL file SHA-256 was
`ff1133cabc79e4290014c7d5898982c80a74a0988565956f0455f4c10ffd0004`;
a transaction guarded the journal prefix and absence of the new view, created
the view, inserted its checksum and committed. Querying the view for browser
order `order_01M65NWVVQ1WK7ZATYZK8BKBRB` yielded one row with the expected
cart, strong journey, checkout event and latest ON at offset nine. In a second
transaction, a guarded update set only this candidate current-state row to
`active=false`; the view then returned zero rows. `ROLLBACK` restored the row,
and the view returned one row again. The transaction did not alter Medusa,
Kafka, canonical events, the active funnel profile or Dashboard authority.
The view proves a target read-model retraction, **not yet** a versioned
reference funnel metric/API/UI correction. The official candidate migrator
will recognize the inserted journal checksum and view on its next release;
the target application image has not been rolled for this DB-only addition.
The subsequent three-stream quality monitor sample remained
`PASS_SHADOW_LEASE` with 104 products, 16 stage-2 tables, four orders, fact
next offset ten and minimum safe WAL headroom 1037 MiB.

**Aggregate API candidate, 2026-10-30:** Dashboard API code now has a separate
`/api/v2/analytics/reference-cdc-funnel-candidate` route behind
`DASHBOARD_ENABLE_CDC_REFERENCE_CANDIDATE=false` by default. Enabling it
requires explicit source ID, coverage epoch and cohort activation timestamp;
the route remains under the existing authenticated shop zone and requires both
`analytics.read` and `analytics.workspace.use`.
Its response is `SHADOW_CURRENT_STATE` with an `UNPUBLISHED` profile status,
never a Commerce Conversion or historical placement metric. A repeatable-read
query counts journey-grain product views, item adds and checkout starts, then
counts distinct journeys with the retractable CDC terminal view. A missing,
expired or changed quality lease returns `BLOCKED_BY_QUALITY` without counts.
The exact parameterized SQL was run read-only on the VPS Pipeline DB for the
target source/epoch and an explicit 2026-10-30 cohort start. Counts were
`1/1/1/1` for entrants/add/checkout/currently recorded journeys. A guarded
transaction changed only the candidate current-state row to OFF: the same
prepared query returned `1/1/1/0`; after `ROLLBACK` it returned `1/1/1/1`.
No order, source record, canonical event, live API route or published profile
was persistently changed. This is a correction-capable candidate query;
versioned profile identity, UI labels/quality rendering and CDC-12 activation
remain open.

**UI candidate code, 2026-10-30:** The Funnel page has a separately labeled
CDC reference current-state panel with an explicit "view" action. It fetches
only when opened, presents entrant/add/checkout/currently-recorded journey
counts without a revenue or immutable-conversion claim, and hides stale
numbers on a quality error. The UI build passes. Because the target API image
has not been deployed with its opt-in flag and the v2 reference profile ID is
still OPEN in Backbone, this is code-level UI preparation, not a live
Dashboard cutover or acceptance test. The existing live funnel remains the
visible default.

**Observed target order-fact delay and WAL headroom, 2026-10-30:** The
mapper's `observed_state_at` comes from Debezium transaction END `ts_ms`;
subtracting that from sink `ingested_at` for the three post-baseline ON facts
gave 0.578 s, 70.785 s and 0.745 s. The 70.785 s observation is the
deliberate short Connect outage and catch-up. This is an END-to-sink interval,
not source commit-to-API or browser-to-dashboard latency; three observations
do not support a p95/p99 claim. A later read-only PostgreSQL slot check found
all three target slots active and `reserved`, retained WAL 302,016 / 301,864 /
77,736 bytes for catalog / stage 2 / order respectively, minimum
`safe_wal_size` 1,088,333,816 bytes and 32 MiB physical `pg_wal` at that
instant. These idle/low-volume values cannot size a 30-minute outage or
flash-sale budget; a bounded target workload is still required before
CDC-12.

**Steady target quality observation, 2026-10-30:** Parsing the monitor's
systemd JSON journal from 05:54:10 through 06:32:34 UTC yielded 32 consecutive
`PASS_SHADOW_LEASE` cycles and zero blocked cycles in that interval. The
largest interval between checks was 75.22 s, minimum reported safe WAL was
1037 MiB, and the order source/sink count reached four. Earlier in the same
journal window, two `BLOCKED_BY_QUALITY` cycles at 05:27:04 and 05:28:09 UTC
belonged to the intentional Connect outage. This supports sustained
low-volume shadow reconciliation after catch-up, not a workload or outage
SLO under flash-sale traffic.

**Bounded target workload, 2026-10-30:** The reproducible
`tools/medusa-reference-cdc-shadow/probe-target-bounded-load.py` created 12
synthetic Store API orders on the Medusa reference VPS with at most two
concurrent checkouts. Source order count increased 4→16; the order-v2 sink
offset increased 10→34 (two records per order), with 12 distinct ON
transitions. The workload lasted 16.725 s (0.717 order/s); checkout p95/p99
were 3.153/3.313 s, and the sink caught up 1.119 s after the last checkout.
Debezium END-to-sink p95/p99 were 1.055/1.178 s, **not** source-commit-to-API
or browser-to-Dashboard latency. Three resource samples had no errors:
Medusa backend peak CPU 149.34%, PostgreSQL 38.7%, Kafka 20.89%, Connect
2.5%; PostgreSQL block I/O at the last sample was 3.56 MB read / 1.58 MB
written (cumulative Docker counter, not workload delta). Peak retained WAL
was 591,704 / 556,768 / 626,352 bytes for catalog / stage-2 / order slots;
minimum safe WAL was 1,087,707,696 bytes for each, and physical `pg_wal`
peaked at 32 MiB. The quality monitor briefly blocked while source/sink
changed, then a fresh two-sample read-only probe returned
`PASS_SHADOW_DRY_RUN`: 104 products, 16 stage-2 tables, 16 orders and fact
offset 34. This is bounded **reference** evidence only. Twelve orders and
three resource samples cannot certify a sustained flash-sale or 30-minute
Connect outage budget; the finite 1 GiB per-slot cap, 512 MiB alert and
256 MiB quality stop remain conservative operational limits until a separate
load/outage approval. Do not repeat CDC-10 clone stress or target short-outage
tests to interpret this sample.

**Sustained target reference workload, 2026-10-30:** The same bounded script
then created 120 more Store API orders with at most three concurrent
checkouts. Source count rose 16→136; the order-v2 sink advanced 34→274,
exactly two records and one ON per new order. The run lasted 137.858 s
(0.870 order/s); checkout p95/p99 were 3.812/4.073 s, END-to-sink p95/p99
1.131/1.264 s, and sink catch-up after the last checkout 2.056 s. Nineteen
resource samples had no errors. Peak CPU was Medusa backend 211.4%, Medusa
PostgreSQL 41.34%, Kafka 110.98%, Connect 11.6%; peak retained WAL was
6,906,616 / 6,871,680 / 4,782,256 bytes for catalog / stage-2 / order,
minimum safe WAL 1,081,392,784 bytes and physical `pg_wal` 32 MiB. Host
filesystem had 141,462,499,328 bytes free after the run. A fresh two-sample
quality probe after catch-up returned `PASS_SHADOW_DRY_RUN` for 104 products,
16 stage-2 tables, 136 orders and fact offset 274; a one-shot candidate
lease write then returned `PASS_SHADOW_LEASE`.

**Cutover blocker exposed by that workload:** The continuous quality service
logged `BLOCKED_BY_QUALITY` at 09:55:41 and 09:56:49 UTC while source orders
were being written, before returning PASS at 09:58:07 UTC. Its order verifier
requires two successive source/mapper/sink digests and topic ends to be
identical. This is a quiescence check, so it cannot maintain a readable
quality lease throughout sustained writes. The transport and bounded resource
sample passed, but the **analysis availability gate did not**. Do not switch
live authority until a versioned moving-watermark/freshness policy verifies
continuous writes without weakening fail-closed behavior, and the same
target workload proves no false quality block. This is a new failure mode
found by the target workload, not a reason to repeat CDC-10 clone tests.

**Moving-input diagnosis and read-only candidate, 2026-10-30:** During a
separate 24-order/three-worker run, the strict order verifier failed while
source contained 145 orders and sink 142. Slot/Connect, mapper=sink and
baseline/gap checks passed; three new orders and transaction offsets were
still in flight (`source_mapper_equal`, `offsets_caught_up` and
`ordered_prefix_complete` failed). The run ended with all 24 new ON records
and sink offset 274→322. A new *read-only* bounded-lag evaluator and target
probe then ran three times while 18 more orders were created: each sample
found three new source orders pending, raw transaction backlog 24/28/26,
mapper and sink equal, usable slot, no existing-order state mismatch and
`PASS_BOUNDED_LAG`. The 18-order workload caught up to sink offset 358.
Policy limits were passed as probe arguments (8 pending orders, 128 raw
offsets, 10 seconds) and are **experimental, not approved cutover defaults**.
The probe does not write a lease or change writer invalidation. Before a live
quality policy can use it, pending first-seen time must persist across
monitor restarts; writer/lease transactions, stage-1/stage-2 freshness and
failure injection must be checked. Do not treat these three passing samples
as a CDC-12 authority decision.

**Pending-age persistence candidate:** Migration 026 adds only
`reference_cdc_v2_pending_quality_candidate` in the Pipeline analytical DB.
The moving-order probe can opt in to persist each pending order's first and
last observation there, retaining the earlier first-seen time on conflict.
It does not update `reference_cdc_v2_quality_state`, the readable view, or
the live Dashboard. The strict verifier remains the default. Migration and
probe need target rehearsal and restart/age-expiry evidence before this can
become an authoritative freshness policy.

**Target migration 026 rehearsal:** CI for the five-file candidate migration
passed. On the VPS, the guarded operator plan verified the four existing
journal checksums and absence of the new table, then applied only migration
026 in one transaction; a second plan returned `ALREADY_APPLIED`. The
moving probe ran twice using persisted candidate state and returned
`PASS_BOUNDED_LAG` with zero pending orders, zero raw offset backlog,
178 source/sink orders and fact offset 358. The strict monitor remained
`PASS_SHADOW_LEASE`; no writer invalidation or readable-view policy changed.
An actual pending order crossing a monitor restart and the failure cases
still require proof before promotion.

**Candidate pending-age restart check:** A synthetic order ID was inserted
only into the Pipeline candidate pending table with first observation 30
seconds earlier. A new Python process read the same first-seen timestamp
(`PASS_PERSISTED_PENDING_AGE`, age floor 30 s); the test row was then removed
and the table verified empty. This proves candidate storage survives a probe
process restart. It does not prove that a live source order is classified
correctly after a worker/monitor restart or make this quality policy active.

**Catalog/stage-2 moving-quality candidate:**
`moving_projection_quality.py` is a pure, read-only evaluator for bounded
source-to-projection row and Kafka-offset lag. Its caller must provide the
exact profile topic allowlist, canonical row values, a source sample taken
after the projection sample for each table, persisted first-observed times, and explicit
row/offset/age/WAL thresholds. Insert, update and delete differences are
treated as pending, then blocked when the limit or age is exceeded. Lost slot,
stopped connector, incomplete snapshot, foreign offset topic and low WAL
headroom block immediately. This is candidate code only: it is not connected
to the target monitor or quality leases, has no persistence table for these
two streams, and does not justify CDC-12 cutover.

**Target read-only probe, 2026-10-30:**
`probe-target-moving-projections.py` now binds the candidate evaluator to the
exact four catalog and sixteen inventory/price table profiles. A single probe
against the live VPS shadow topology returned `PASS_BOUNDED_LAG` for both
streams, zero pending rows, zero lag on all twenty raw topics, and all six
connector/snapshot/slot/WAL/offset/pending checks true. The operator copied
the candidate scripts into separate `/srv/KLTN/.cdc11-moving-probe/`; the
strict monitor service and its files were untouched. The values 8 pending
rows, 128 offsets and 10 seconds were probe arguments, **not approved policy**.
The idle result proves profile/row normalization and target wiring only. It
does not establish behavior under moving catalog data, persistence across
restart, a continuous lease, or analytical availability under writes.

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
5. For this Medusa reference, stage-2 acceptance covers CDC capture and current
   simple Store API contexts: the 16 source tables and offsets reconcile; all
   120 published variant price/currency results and 20 managed inventory
   quantities match the Store API in the recorded target sample. The resolver
   can claim only shapes it explicitly supports. Reservation, backorder,
   quantity tier, price-list and rule cases outside those proven shapes return
   `UNVERIFIED`/`BLOCKED_BY_QUALITY` for the affected derived answer; raw CDC
   capture and unrelated catalog/order analytics continue. Nonempty clone
   cases already exercised transport and resolver failure behavior; no new
   target business fixture is required solely to cut over this reference.
   Recheck source shapes and Store API comparison at the cutover checkpoint.
   Never use a current catalog price to rewrite historical order money.
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

At the latest checkpoint, **live cutover is blocked** by a target workload/WAL
and outage budget, no published/versioned order-v2 reference funnel profile or
correction path to analytical/UI results, and no CDC-12 authority decision per
stream. The post-baseline browser order passed the guarded shadow journey
reader and controlled target OFF→ON restoration; target catalog
update/soft-delete/relation and price update transport also passed. All 120
current published variant price/currency contexts matched the Store API, as
did the 20 managed inventory quantities. This is sufficient shape evidence
for the **current reference data** if unsupported future contexts remain
`UNVERIFIED` and do not poison unrelated analyses; it is not a general Medusa
pricing or sellable-stock claim. The bounded quality monitor protects capture
coverage but its PASS lease does not certify a business resolver or grant CDC
analytical authority. Target replay, restart, fail-closed and short Connect
outage have passed; do not repeat them. This document does not promote a CDC
source or change live analytical authority.
