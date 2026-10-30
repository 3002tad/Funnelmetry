# CDC-12 catalog canary — Medusa reference, 2026-10-30

Status: **PREPARED; not yet switched**. This is one stream's release record under
DEC-119/135 and the [CDC-11 cutover runbook](CDC11_THREE_STREAM_CUTOVER_RUNBOOK.md).
The user's 2026-10-30 instruction authorizes moving from the measured reference
load budget to cutover; this record limits that action to the catalog read path.
Order v2 and inventory/price analytical authority remain shadow.

## Exact versions and baseline

- Pipeline feature commit: `d06aca5687bc695c17d687babb98ed7a8f0d74d3`.
- New API: `ghcr.io/3002tad/funnelmetry-cdc-api-candidate@sha256:fbe8d3d39977f651ffb397d4da2a48365215e2baf38d28ab4f9898d9749dc410`.
- Previous live API: `ghcr.io/3002tad/funnelmetry/handoff-api@sha256:864b9d4ff3b175bbcf76145910b460795ac5bfa68fbdfa847380288ba89bb684`.
- Source/epoch: `medusa-reference` / `cdc11_catalog_epoch1`; schema digest
  `e070fcfd698232b624a0a61e89962c6ae8afed86c973815aa7543763ba290fc5`
  matches the live API service spec and tagged candidate code.
- At preparation: 104 source products, 16 inventory/price tables, 186 reference
  orders and order fact offset 374. The first post-update monitor cycle passed
  both independent leases with at least 1026 MiB safe WAL headroom. The
  catalog binding did not exist; Dashboard and `catalog-sync` remained live on
  the Admin API path. No browser/Backend Adapter path changes here.

## Switch and immediate checks

1. Record the current `dashboard-api` service image/env and a fresh quality
   lease, source/projection digest, topic/applied offsets and source product
   count. Stop if any catalog field differs or the lease is stale.
2. Pre-pull the candidate digest on the single Swarm node. Update only
   `funnelmetry_vps_live_dashboard-api` to that image while provider stays
   `admin_api`; require a healthy replacement task and no API 5xx.
3. Apply `tools/medusa-reference-cdc-shadow/activate-target-catalog-canary.sql`
   with `psql -X -v ON_ERROR_STOP=1`. The single transaction refuses a stale
   lease, different epoch, existing binding or missing readable products.
4. Set `PRODUCT_REFERENCE_PROVIDER=catalog_cdc` on only the Dashboard API
   service. Keep `catalog-sync` running during observation. Check the product
   reference response for current source products and a missing product, and
   confirm numbers/order historical amounts are unchanged.
5. Observe two consecutive monitor cycles and a fresh Dashboard request after
   each. Abort if the catalog lease blocks/expires, the API fails or current
   names diverge. If both cycles pass, `catalog-sync` may be scaled to zero;
   do not remove its service/credential until the CDC-13 cleanup gate.

The finite two-cycle window is an initial canary acceptance criterion, not a
claim of production freshness under arbitrary catalog-write load. The catalog
writer still invalidates its lease on new catalog records; the monitor must
reconcile again before the CDC read path returns success. No repeated checkout
or historical CDC probe is part of this canary.

## Rollback

If any immediate check fails, first restore the API provider/image to the
previous digest and require a healthy task. Ensure `catalog-sync` is `1/1`.
Then run `rollback-target-catalog-canary.sql` to mark the binding
`ROLLED_BACK`. Keep CDC capture and its offsets untouched for investigation.
Do not use current catalog price to rewrite historical order money.

The canary uses a temporary Swarm service override while the live checkout
remains on `main`; record the exact live spec and reconcile the manifest/image
pin before declaring CDC-13 cleanup complete. A later stack redeploy from
`main` may restore the prior image/provider, so do not treat the temporary
override as a durable installer release.
