# Medusa product reference sync (opt-in, stage 1)

Implements Master §4.6 / DEC-117 for **product ID + title only**. Not a complete
variant/SKU/category/collection dimension or a published semantic asset.

Read-only `GET /admin/products`, `fields=id,title,updated_at`, stable ID order,
limit/offset pagination. Secret API key is sent as `Authorization: Basic <key>`
per [Medusa's API key contract](https://docs.medusajs.com/resources/commerce-modules/api-key/concepts).
It is NOT a publishable key, Feed Bearer token, browser key or Qwen key.
Use a separately provisioned server credential, with minimal source permissions.

## Semantics / limits

- PostgreSQL migration `020_product_reference.sql`, additive, no historical rewrite.
- Snapshot grain: source × sync UUID; title grain: source × snapshot × product.
- `observed_at` is Pipeline sync completion time, not historical validity time.
  `source_updated_at` is provider metadata only. No historical as-of claims.
- Append snapshots atomically. Latest *whole* snapshot selected before product join:
  at most one name per source/product, so analytical counts cannot fan out.
- Empty completed catalog clears the current name lookup but preserves old snapshots.
  Absence is not evidence of product deletion. Missing names do not reject events.
- Never fetch/use catalog prices to reconstruct orders or revenue; never emit events.
- Maximum 100 pages / 10000 products per run, 1 MiB per page, 10-second request
  timeout, two-minute total fetch budget, HTTPS only, no redirects, no raw
  response/credential logging. SIGTERM/SIGINT abort the in-flight fetch.
- Duplicate IDs, count drift, truncated pages and bad fields fail the whole sync.
  Offset paging cannot prove a consistent point-in-time source snapshot even if
  count stays constant: freshness/completeness remain **UNVERIFIED** in UI.
- Session advisory lock per source prevents overlapping writers. Lock failure or
  fetch/DB error preserves the previous snapshot. Retry next configured interval,
  default one hour, minimum one minute; no tight automatic HTTP retry loop.
- Snapshots are retained; no automatic deletion/retention policy yet. Monitor growth.

## Activate only after credentials are provisioned

1. Copy `runtime/catalog-sync.env.example` to ignored `runtime/catalog-sync.env`.
   Fill approved source ID, HTTPS Medusa origin, **Admin secret API key**, and DB
   credentials for the existing Compose network. Do not reuse source-connector key.
2. Back up the target database and apply migration 020 using the normal migration
   procedure. This code change does not apply it to a running demo automatically.
3. Add `-f infra/compose.catalog-sync.yml --profile catalog-sync` to the existing
   reviewed Compose file set; `up -d --build catalog-sync` enables startup + periodic
   sync. Preserve the existing network/security overlay and project name.
4. Restart the Dashboard API after code deployment. `/products` and event details show a title plus
   sync time/provider/snapshot when present; otherwise ID + explicit missing label.
   Do not treat a successful container start as successful source sync.

One-shot: same Compose configuration, `run --rm --no-deps catalog-sync node src/main.js --once`
(build image first). Does not migrate DB. Success logs count only; failures are sanitized.
Stop the worker to roll back activation; keep additive tables/history. No launcher
change, source change, remote request or credential creation is implicit.

## Tests

`npm test` validates pagination, field allowlist, failure bounds and rollback.
`tools/v2-e2e/run-medusa-contract.ps1` includes an isolated PostgreSQL catalog test:
migration rerun, title history, source isolation, cardinality and failed-batch atomicity.
These tests do not prove live Medusa credentials or source reachability.

## Local one-shot activation — 2026-10-02

- Approved local configuration read successfully from ignored `runtime/catalog-sync.env`.
  Medusa Admin GET returned HTTP 200 across two pages, 104 validated products.
- `POSTGRES_PASSWORD` in this catalog config is empty. No credential was printed or
  copied: the operator one-shot used the existing Dashboard API PostgreSQL pool,
  loading the catalog config separately rather than overriding API DB environment.
- Saved ignored `runtime/backups/before-catalog-20261002.dump`; complete archive
  listing checked. Restore rehearsal not performed; this is not a migration snapshot.
- Applied additive migration 020 in a transaction, then atomically saved one catalog
  snapshot under the per-source advisory lock. Canonical records and amounts unchanged.
- Read-only comparison found three distinct product IDs in canonical top-level/item
  data and three matching catalog names. Counts refer to this point-in-time dataset.
- Periodic worker NOT enabled. Complete its DB credential configuration before
  deployment. No ingestion/replay/source mutation or model call was performed.

This verifies live catalog access and one-shot storage, not ongoing freshness,
snapshot-consistent Medusa pagination or full variant/category metadata support.
