# Synthetic demo seed pilot

This is a bounded offline pilot for the [demo seed plan](../../../System_Backbone/docs/implementation/Funnelmetry_Demo_Data_Seed_And_DB_GPT_Agent_Optimization_Plan_2026-11-04.md). It does not connect to a live DB, a source connector, Kafka, DB-GPT, or an LLM. IDs and records are synthetic; reference datasets only inform high-level choices. The distribution is a scenario, not a statistical reproduction of those datasets.

```sh
node --test tools/demo-seed-pilot/pilot.test.mjs
node tools/demo-seed-pilot/pilot.mjs plan
node tools/demo-seed-pilot/pilot.mjs generate ../System_Local_Docs/demo-seed-pilot-01
node tools/demo-seed-pilot/pilot.mjs verify ../System_Local_Docs/demo-seed-pilot-01
node tools/demo-seed-pilot/postgres-check.mjs ../System_Local_Docs/demo-seed-pilot-01
```

`generate` requires a **new** directory and never resets or overwrites an existing dataset. Its manifest records the SHA-256 of the generator source and the fixture as well as a logical hash; generated_at is excluded from the logical dataset. It does not claim a Git commit for uncommitted generator code. `verify` regenerates and compares logical content. No database ingestion time is invented in the fixture.

`postgres-check` uses a uniquely named disposable `postgres:15-alpine` container, `--network none`, no published ports, no mounts and no persistent volume. It applies Pipeline migrations and exploration views, loads the fixture and runs [14 golden questions](GOLDEN_QUESTIONS.md): 12 SQL results against independent fixture calculations and two explicitly unsupported cases. It checks a demo read-only role and executes a denied write. A private `docker exec` stream runs the real CDC cart mapper twice at the same offset and verifies one effect and offset-gap rejection. It stops its own container afterwards. The check requires a Docker daemon and `pg` installed under `workers/traffic-source-writer/node_modules`. This is a bounded mapper/database check, not Kafka replay, a DB-GPT connector test, model evaluation or live quality certification. The CDC quality row remains `BLOCKED_BY_QUALITY` with `INCOMPLETE` historical coverage.

Browser event payloads are checked against the catalog; cart-added events use the actual CDC decoder and canonical constructor. Catalog/order/cart are synthetic current-state fixtures, not a complete replayable historical CDC stream. There is no claim of search-to-cart attribution or placed order, payment, conversion or revenue. UTM is projected through the actual raw observation extractor into the real hash/registry schema; labels and the `funnelmetry_demo` views are demo-only. Historical behavioral time is `occurred_at`, while raw `received_at` is the actual loading time. The pilot does not yet provide an actual DB-GPT read-only connection, demo metadata/KB publication, full-scale load tests or a live Medusa slice.

The seed range is fixed and scenario probabilities are explicit in `generator.mjs`. Identity in a browser event does not propagate into the CDC cart event; `context.cart_linked` is evidence of a cart relationship only. Do not use the demo source ID in a live database.

## Dataset foundation

The foundation adds an immutable pilot manifest, entity crosswalk and source coverage intervals from the existing fixture. Synthetic mappings are `FIXTURE_ONLY`; a candidate Medusa mapping must be supplied explicitly and remains `UNVERIFIED`. No mapping is inferred from title, category or SKU. The cutoff equals the fixture end and is `PROVISIONAL_OFFLINE_ONLY`, not a live CDC checkpoint. The `COMPLETE` intervals cover only records generated for the synthetic fixture; the live intervals are `UNVERIFIED`.

```sh
node --test tools/demo-seed-pilot/foundation.test.mjs
node tools/demo-seed-pilot/foundation-cli.mjs generate <fixture-directory> <new-output-directory> [anchor-json]
node tools/demo-seed-pilot/foundation-cli.mjs verify <fixture-directory> <output-directory>
node tools/demo-seed-pilot/foundation-postgres-check.mjs <fixture-directory> <output-directory>
```

Optional anchor JSON is an array of `{ "entity_type": "product", "synthetic_id": "demo-product-00000", "source_id": "medusa-reference", "source_entity_id": "prod_example", "mapping_evidence": "mapping-manifest:example" }`. A valid reference alone does not certify it; validate the actual catalog snapshot and mapping before using it for live joins. The output pins the source fixture, code and anchor checksums; generation uses a new directory and verification detects changes. `foundation.sql` uses PostgreSQL `btree_gist` to prevent overlapping crosswalk/coverage ranges. In this pilot each `dataset_id` pins exactly one immutable seed version; a new seed version requires a new dataset ID. The PostgreSQL check applies it only in an isolated disposable database, checks exact replay and rejects overlapping mappings, overlapping coverage and observed completeness without a checkpoint. It does not certify Kafka replay, a Medusa mapping or live coverage, and it does not publish semantic metadata.

`catalog-anchor-cli.mjs <source-snapshot.json> <projection-snapshot.json> <new-output.json>` reconciles explicitly captured Medusa and CDC IDs and relationships under a valid catalog lease. It produces deterministic keys and a synthetic catalog skeleton for the next generator, recording both snapshot hashes, WAL LSN, epoch and lease. `SNAPSHOT_VERIFIED` applies only to the compared catalog snapshot; it is not a verified live cutover, historical coverage or a mapping of the earlier independently generated 30-product pilot. Catalog IDs remain local operational data and should not be committed. Capture/compare at a stable point; a source snapshot and a projection snapshot are separate transactions, not an atomic distributed snapshot.

## Expanded historical pilot

`expanded.mjs` consumes the reconciled anchor rather than attaching the earlier 30 unrelated products. It generates deterministic synthetic sessions, browser events, cart changes and links, order lines and ON/OFF transitions, offer and stock revisions, payments, fulfillment transitions and customer evidence. The source catalog was compared only at its snapshot; generated prices, histories, behavior and transactions are scenario data. `coverage` rows begin `UNVERIFIED`; a passing disposable check is evidence for this fixture only, and does not amend live CDC coverage. Catalog skeletons currently contain keys and relationships, not product or category names.

```sh
node --test tools/demo-seed-pilot/expanded.test.mjs
node tools/demo-seed-pilot/expanded-cli.mjs plan <reconciled-anchor.json>
node tools/demo-seed-pilot/expanded-cli.mjs generate <reconciled-anchor.json> <new-output-directory>
node tools/demo-seed-pilot/expanded-cli.mjs verify <reconciled-anchor.json> <output-directory>
node tools/demo-seed-pilot/expanded-postgres-check.mjs <reconciled-anchor.json> <output-directory>
```

The PostgreSQL check creates a fresh network-disabled container without host ports or volumes, loads versioned fixture records into a demo-only schema, provides typed views, checks read-only access and deletes the container. It verifies replay of identical inserts, joins, event time, price at order time, money and grouped SQL results. `terminal_linked` is a fixture count and not a certified active funnel profile; the checker does not run live Kafka/CDC, publish semantic metadata, or provide a persistent demo deployment. An anchor and fixture contain Medusa catalog IDs and are local artifacts, not commit material. Do not load them into an authoritative Pipeline or Medusa database.

The current scenario supports product/category labels from a separately captured Medusa snapshot. Pass that local JSON as the **fourth** argument for `generate`/`verify` and as the **third** argument for `expanded-postgres-check`. Labels are joined by exact source ID; they represent the later label snapshot only and do not establish historical names. With no label file, the generator uses explicitly synthetic labels. The manifest pins the label file hash. `DEFAULTS` contains the versioned pilot seasonality, campaign, behavior and product-rank assumptions; these are demo parameters, not inferred annual seasonality of the reference sources.

```sh
node tools/demo-seed-pilot/expanded-cli.mjs generate <anchor.json> <new-directory> <labels.json>
node tools/demo-seed-pilot/expanded-cli.mjs verify <anchor.json> <directory> <labels.json>
node tools/demo-seed-pilot/expanded-postgres-check.mjs <anchor.json> <directory> <labels.json>
node tools/demo-seed-pilot/distribution.mjs <directory>/fixture.json <reference-aggregate.json> <rees-user-sample.json>
```

Current pilot adds two campaign price rules, two locations, synthetic category history, and cart quantity increase/decrease/delete. Remaining work before full seed includes baseline cart changes, richer channel/location and price-rule eligibility, full-size load verification, a durable demo environment and live cutover checkpoint, and coverage-aware metadata/KB publication. Payment, fulfillment and customer evidence remain synthetic until corresponding observed CDC analytical bindings exist.

## Persistent local offline database

`persistent-demo.mjs` provisions or verifies the **fixed local** `funnelmetry-offline-demo-pilot-postgres` container and `funnelmetry-offline-demo-pilot-data` Docker volume. It checks ownership labels, volume mount, `network=none` and no published ports before using existing resources. The database is isolated from the live Pipeline, Medusa, CDC, Kafka and DB-GPT. It uses local container-only trust; no network access is enabled. Docker access still grants control of the container.

```sh
node tools/demo-seed-pilot/persistent-demo.mjs seed <anchor.json> <fixture-directory> <labels.json>
node tools/demo-seed-pilot/persistent-demo.mjs verify <anchor.json> <fixture-directory> <labels.json>
```

`seed` refuses an existing dataset ID with a different logical hash; subsequent runs check rather than replace the dataset. It verifies fixture, generator, anchor and labels hashes, compares the stored manifest and every database payload with the fixture, executes [golden questions](PERSISTENT_GOLDEN_QUESTIONS.md), and checks a denied write. There is no automatic reset or deletion. Keep anchor, labels and fixture outside Git. This local database is not a deployed Swarm stack, has no Kafka/connector or DB-GPT access, and has no live continuation or published metadata. A separate deployment and verified cutover are required for those capabilities.

## Local scale and historical seed

`scale-run.mjs 10000|100000 <anchor.json> <labels.json> <new-output-directory>` creates a new size-specific database in the same network-disabled demo PostgreSQL container. It pins configuration, hashes and per-domain checksums, loads records in a transaction, compares actual DB payloads against the fixture, runs golden SQL and records timings and DB size. Existing databases and output directories are never overwritten. `full-integrity.mjs <full-output-directory>` runs the additional temporal/relational checks in [full-integrity.sql](full-integrity.sql) using temporary tables and indexes. These scripts are for bounded offline tests, not a general full-size loader, a live source connector or a PostgreSQL migration.

`expanded-pilot-v2-snapshot.mjs` preserves the earlier pilot generator for hash-verified replay. The newer generator covers the full configured time range, omitting future payment/fulfillment actions at the end of the synthetic interval. Previously generated fixture manifests remain pinned to their original generator checksum.

The approved full manifest also pins the original CRLF bytes of `persistent-golden.sql`. `.gitattributes` keeps that file in CRLF on checkout so its SHA-256 remains `7a05a56b9256bacb8ec39a6343169233d73c641f5eeb01e08d966a5c4538493e` on each platform; do not normalize it when reproducing the existing manifest.

## DEC-150: prepare the Pipeline database seed

`pipeline-demo-v1.sql` creates `demo_history` and 19 typed domain tables in the existing `funnelmetry_handoff` database. It refuses another database or an existing `demo_history` schema without its migration marker. No grants to DB-GPT and no combined observed/synthetic views are created by this migration. Tables keep synthetic origin, dataset identity, fixture ordinal and actual load time; natural keys reject duplicate entities or revisions.

`pipeline-seed.mjs` accepts only the approved `demo-historical-100000-v2` manifest and fixture bytes, verifies the logical hash, all 19 domain hashes, counts and fields before emitting any SQL. Its SQL runs as a single transaction with an advisory lock. The first run inserts the dataset; replay compares every typed row against the pinned fixture without changing `loaded_at`. A changed manifest, a missing row, an extra row or altered content fails the transaction. Only this fixture is supported; a new manifest requires an explicit reviewed version change. SQL output contains fixture data and catalog IDs: pipe it directly to `psql`, do not log it or commit the fixture.

```sh
node tools/demo-seed-pilot/pipeline-seed.mjs check /path/to/manifest.json /path/to/fixture.json
node tools/demo-seed-pilot/pipeline-seed-check.mjs /path/to/manifest.json /path/to/fixture.json
```

The integration check creates a temporary database called `funnelmetry_handoff` only if that name is absent in the **fixed, label-verified, network-disabled local pilot container**. It applies the migration twice, loads the full fixture twice and confirms a changed record makes replay fail; it removes only its own temporary database. It does not connect to the VPS.

For the separately scheduled VPS load, verify the backup, correct host and service first. The following illustrates a Bash session on that host; replace only the two local fixture paths. Run the migration and seed as the database owner. The existing Docker Swarm service label is checked for a single running PostgreSQL container. The fixture and manifest must be transferred to a protected directory on the VPS before these commands; they remain outside Git.

```bash
set -euo pipefail
mapfile -t db_containers < <(docker ps -q --filter label=com.docker.swarm.service.name=funnelmetry_vps_live_postgres)
test "${#db_containers[@]}" -eq 1
node tools/demo-seed-pilot/pipeline-seed.mjs check /path/to/manifest.json /path/to/fixture.json
docker exec -i "${db_containers[0]}" psql -X -v ON_ERROR_STOP=1 -U funnelmetry -d funnelmetry_handoff < tools/demo-seed-pilot/pipeline-demo-v1.sql
node tools/demo-seed-pilot/pipeline-seed.mjs emit-sql /path/to/manifest.json /path/to/fixture.json | docker exec -i "${db_containers[0]}" psql -X -q -v ON_ERROR_STOP=1 -U funnelmetry -d funnelmetry_handoff
```

The check and commands do not provide a processing-safe Kafka/Event Feed backup, CDC coverage certification, analytical metadata, DB-GPT access, or live joining. Those remain separate work. Do not reset the current Pipeline database or apply the offline pilot's destructive commands to it.

## Exploratory analytical views

`pipeline-analytical-views-v1.sql` exposes the pinned synthetic seed through read-only `funnelmetry_demo` views. `behavior_events_all` combines synthetic browser events and compatible observed browser events from the fixed exclusive seed boundary, `2026-11-01T00:00:00Z`. Every row carries its origin, source and quality; the presence or absence of observed rows does not establish continuous coverage. Other demo domain views remain synthetic-only. Observed catalog/cart/order current-state remains separately available in `funnelmetry_explore`, because snapshots are not historical transactions. Crosswalk can relate matched catalog IDs, but does not link customer, cart or session identities across sources. Views are exploratory: publication of semantic metadata/KB and DB-GPT retrieval acceptance remain separate.

```sh
node tools/demo-seed-pilot/pipeline-analytical-views-check.mjs
```

The test uses a temporary network-disabled PostgreSQL container and checks the boundary, missing data, unwanted event types, idempotent view migration, and read-only role access. Do not use these views to infer observed payment, revenue, search-to-cart or complete historical CDC coverage.

`pipeline-demo-coverage-v1.sql` adds `funnelmetry_demo.dataset_coverage`, a demo-specific status for the pinned synthetic dataset. `READY_FOR_DEMO` means the current domain counts and session time range match the stored pinned manifest; the seed transaction previously checked each row. `DEMO_DATA_MISMATCH` signals a count or session range mismatch. This status applies only to the specified synthetic period and is not a continuous coverage or observed CDC certification. The view checks counts, not a new per-row checksum; the recorded loader evidence covers the initial load. The same isolated test checks replay, read-only access and detection of a changed domain count.

The next release is `demo-commerce-analysis@1.0.0`. The 15 reference questions, SQL and answers live in [DEMO_GOLDEN_QUESTIONS_V1.md](DEMO_GOLDEN_QUESTIONS_V1.md), [demo-golden-v1.sql](demo-golden-v1.sql) and [demo-golden-v1-answers.json](demo-golden-v1-answers.json). `verify-demo-golden.py` recomputes Q01–Q14 independently from the two pinned fixture files. Q15 contains runtime coverage and unsupported observed claims, so its observed count is a point-in-time answer. `demo-semantic-release.mjs check|emit-sql` validates and installs the versioned `funnelmetry_demo.semantic_release` in PostgreSQL; it checks the physical columns and both dataset readiness views before publishing. The AI role can read this release but cannot alter it.

`publish-demo-kb.py check|publish|verify --password-file <existing-owner-only-file> --email <admin-or-analyst-email>` runs on the VPS operator host. It reads the release through the AI role, logs into the Pipeline API using an existing account credential, then creates one digest-named DB-GPT KB document with `text-embedding-v3`. `verify` checks retrieval of the release marker and two deterministic SQL queries via the DB-GPT editor. The password and bearer are kept in memory and are never printed. The publisher sends derived metadata/guide text to the configured embedding provider; it does not send fixture rows or SQL results. Select the reported KB space in DB-GPT; automatic space selection is not implemented.

## Synthetic continuation through 2026-11-05 UTC

`gap-seed.mjs` builds the pinned synthetic continuation `demo-gap-20261101-20261105-v1` using the same reconciled catalog anchor. The chosen 1,750 sessions approximate four days of the preceding November scenario; all event and business identifiers are namespaced separately from the original fixture. Reproduction requires the local anchor and labels whose hashes are recorded in the manifest. Generated fixture and manifest are operational data and stay outside Git. The 19 domain tables include synthetic price, stock, cart, order, payment and fulfillment; no lost WAL records are reconstructed.

`pipeline-seed.mjs` accepts this pinned manifest, verifies the bytes, all domain checksums and rows, and rejects a first load if observed browser events overlap the period. The replay compares existing rows. After loading, `pipeline-gap-binding-v1.sql` exposes both datasets through the existing demo views. Join domain entities on **dataset_id and entity key** to avoid multiplying repeated catalog snapshots. The combined browser view includes synthetic history before 2026-11-05 and observed events after it; late observed events in the synthetic period remain in `funnelmetry_explore.behavior_events` and are reported by `funnelmetry_demo.gap_overlap_status`. `gap_dataset_coverage` checks the manifest counts and session time bounds. Neither view certifies observed coverage.

```sh
node tools/demo-seed-pilot/gap-seed.mjs <anchor.json> <labels.json> <new-directory>
node tools/demo-seed-pilot/pipeline-seed.mjs check <manifest.json> <fixture.json>
node tools/demo-seed-pilot/pipeline-gap-check.mjs <manifest.json> <fixture.json>
```
