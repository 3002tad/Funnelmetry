# CDC-12 stage-2 current-offer read path

Status: **VPS canary active; disabled by default in the manifest**. This is a narrow Medusa reference
read path for current default price and managed stock. It is not an order fact,
historical price, revenue measure, or general Medusa price engine.

The endpoint is `GET /api/v2/reference-cdc/current-offer`, requires an
authenticated `analytics.read` session, and accepts exactly `source_id`,
`product_id`, `variant_id`, `sales_channel_id`, `region_id`, and `currency_code`.
It supports only `medusa-reference`. The declared grain is source × variant ×
sales channel × region × currency. It returns two independent statuses for
price and inventory, each `PASS_SAMPLE_ONLY` or `UNVERIFIED`; a missing or
stale quality lease returns HTTP 503 `BLOCKED_BY_QUALITY` for the whole read.

The physical inputs are `catalog_cdc_products_current`,
`catalog_cdc_variants_current`, `inventory_price_cdc_context_current`,
`catalog_cdc_binding`, and their two quality leases. One repeatable-read,
read-only transaction checks active catalog binding, fresh reconciled snapshot,
source/projection digest and offset equality, usable slot, running connector,
and all 16 stage-2 table keys before loading the allowlisted current rows.
The response includes both coverage epochs and lease verification timestamps.
No Medusa Admin or Store API call occurs on this read path.

The resolver currently accepts one default price in a currency-matched region
without price list, rule or quantity tier. For managed inventory it accepts
one required item at one linked location with a matching reservation total;
unmanaged variants return `inventory_quantity=null`. Unsupported shapes return
`UNVERIFIED` for the affected result and do not interrupt CDC capture or the
other result. Current price must never be used to rewrite historical order
amounts. Existing target conformance covered 120 published variant price and
currency contexts and 20 managed inventory quantities; the new HTTP read path
still requires target verification after image publication.

Swarm activation is explicit with `SWARM_ENABLE_CDC_REFERENCE_OFFER=true`,
only in `PARALLEL_LIVE` with `SWARM_PRODUCT_REFERENCE_PROVIDER=catalog_cdc`.
The flag defaults to false. Keep it false until the new image is healthy and
the lease is freshly PASS. Rollback sets the flag false; CDC projection and
offsets stay intact. This endpoint is a reference candidate and is not yet
registered as an active semantic tool or general analytical asset.

## Target canary, 2026-10-30

Tag `cdc-api-candidate-v2026.10.30.3` at commit `d60e51a` passed GitHub Actions
run `41051677519` including the stage-2 resolver tests, image build and smoke.
The VPS pulled and deployed
`ghcr.io/3002tad/funnelmetry-cdc-api-candidate@sha256:ba7d8db8488558f64eb4af1843f1034c71a4f03a5f5e906ae8621d097e0c976b`.
The prior API service spec is stored privately on the VPS at
`/srv/KLTN/.cdc12-stage2/dashboard-api-before.json` (mode 600). Image update
converged with the new endpoint off; HTTPS health returned 200. Then the API
service was updated with `DASHBOARD_ENABLE_CDC_REFERENCE_OFFER=true`.

The existing active analyst account authenticated, and the public HTTPS route
returned 200 for a storefront-visible variant: current `9.19 EUR` and
unmanaged inventory (`null`) matched the Medusa Store API for the same
product, variant and region. A managed-stock CDC read also returned the
single-location reference quantity, and a currency/region mismatch returned
price `UNVERIFIED` without an amount while leaving the independent inventory
result available. The quality monitor remained PASS for catalog and order,
with 16 stage-2 tables and at least 1026 MiB WAL headroom. No checkout or
historical-order replay was repeated.

This is a **stage-2 read-path canary**, still a temporary Swarm service override.
The VPS `main` checkout does not render this flag or image digest. Do not
redeploy the old manifest before reconciling the release. The endpoint is not
yet an active semantic metadata/tool binding; order v2 and Backend Adapter
remain on their prior path.

## Lease invalidation hardening, pending image release

The feature branch now rechecks catalog and stage-2 leases after closing the
repeatable-read projection snapshot. A revoked, expired, replaced or
incomplete lease returns `BLOCKED_BY_QUALITY` without the previously computed
offer. The recheck compares both coverage epochs, verification and expiry
instants, source/projection digests and offsets, connector/slot readiness,
and presence of all 16 stage-2 tables. The exact recheck SQL ran read-only on
the target PostgreSQL DB and returned `ready=true` for catalog epoch
`cdc11_catalog_epoch1` and stage-2 epoch
`cdc11_inventory_price_epoch1`. Targeted regression tests cover revocation,
replacement, changed verification time and missing table coverage. The new
The release and target runtime check are recorded below.

**Target rollout, 2026-10-30:** Tag `cdc-api-candidate-v2026.10.30.4` at
`3d00a9e` passed GitHub Actions run `41054640973` (46 selected tests,
image build and smoke). The image was pulled by SHA tag and the API service
converged on digest
`ghcr.io/3002tad/funnelmetry-cdc-api-candidate@sha256:e547def2929ac70d8194523201c0e4216206f1f1c1ae3a973946008d548373d1`.
The previous service spec is stored privately at
`/srv/KLTN/.cdc12-stage2/dashboard-api-before-lease.json` with mode 600.
An authenticated analyst GET through public HTTPS returned HTTP 200,
`REFERENCE_CURRENT_ONLY`, price `9.19 eur` and unmanaged stock status
`PASS_SAMPLE_ONLY` for the previously conformed storefront variant. A first
check passed uppercase `EUR` and returned price `UNVERIFIED` with
`currency_or_region_missing`; source CDC region and currency rows use raw
lowercase `eur`. Repeating the same request with the source code `eur` returned
the expected price. This was a query-case mismatch, not CDC data loss.
The target lease currently reports catalog and stage-2 epochs as ready; no
fault was injected into live leases solely to retest the fail-closed branch.
