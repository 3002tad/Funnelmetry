# CDC-13 Medusa reference retirement evidence

Scope: `feature/cdc-medusa-v1` on Pipeline and Medusa, VPS `kltn`, 2026-10-31.
This closes the reference backend acquisition cleanup after DEC-140/141. It
does not implement the separate HTTP Gateway project.

## Source and installer

- Pipeline commit `2fddf3a` makes the Medusa CI installer CDC primary. A fresh
  pinned DTC Starter checkout receives Browser SDK/storefront hooks and exact
  order v2, catalog and inventory/price CDC profiles. The manifest rejects a
  backend message binding, CDC v1 shadow or native rollback target.
- Medusa commit `27915ae` removes the installer-owned CDC v1 profile and
  backend occurred-at helper, updates the order v2 profile authority, removes
  Funnelmetry sender variables from the backend Compose service, and leaves
  storefront behavioral delivery configured.
- The order v2 profile keeps its historic filename and technical `SHADOW_ONLY`
  field because the three CDC runtime provisioning tools validate this format.
  The approved analytical authority is the separate, quality-gated
  `reference.medusa.order_recorded_state.v2` profile. No `order.placed` event is
  inferred from CDC state.
- Installer CLI no longer offers `rollback-plan` commands. It verifies
  installer ownership before deleting retired artifacts. The Source Ingress
  returns HTTP 410 for new `medusa.order_placed` from `medusa-reference`; old
  feed records and analytical history remain readable.

## Pipeline and VPS

- `catalog-sync` source code, worker image entry, Swarm service, Docker secret
  requirement and Admin API product-reference fallback have been removed from
  the feature branch. The Dashboard product-reference provider is `catalog_cdc`
  with active binding and quality-lease checks.
- On VPS the old `funnelmetry_vps_live_catalog-sync` service (0/0) and
  `funnelmetry_vps_live_catalog_key_v1` Docker secret were removed. The user
  chose to retain the separate Medusa Admin Secret API Key itself.
- The old isolated `funnelmetry_cdc_shadow` Compose clone was stopped and its
  ten containers/network removed. Its volumes were retained. The active
  `funnelmetry_cdc_target_shadow_*` target services remain 1/1.
- Source Ingress was rebuilt from Pipeline feature commit and recreated under
  the same Compose project and durable event-log volume. `/readyz` returned
  `ready` with unchanged feed ID `22c74ac3-fc46-4b3a-bc65-d4c9e117453e`.
  Its deployed source contains the retired-message guard.
- Medusa backend was recreated without its old sender env; `/health` returned
  `OK`. The storefront retained its signing-key env for `cart.item_added` and
  `behavior.search_submitted`. Swarm Source Connector and all three CDC target
  streams remained 1/1. `node runtime/swarm.mjs check-app` passed on VPS.

## Verification and limits

Local targeted tests passed for installer fresh/migration/idempotence,
three-stream profile binding, Source Ingress retirement plus storefront event,
Dashboard CDC product references, and Swarm preflight/render (49 tests after
the manifest fixture correction). The first Pipeline CDC CI exposed a stale
event-browser test fixture; commit `347fa2e` now supplies the required CDC
catalog binding and quality rows, and that test passes locally. The first
Medusa propose CI exposed a test importing the retired backend occurred-at
helper; commit `03d00bd` removes that obsolete test. Medusa plan CI
`41100435360`, corrected Medusa propose CI `41102889777` and corrected
Pipeline CDC CI `41102612623` all passed. API image publish run
`41101601467` passed.

The CDC-13 Dashboard API image published from exact source commit `2fddf3a`
as digest `sha256:d8819e71ec8134ff5b866ada6130c0b0ef304d30e48bbd27381d8dbb65f1bfd9`.
Only `funnelmetry_vps_live_dashboard-api` was updated, and its ignored
`SWARM_API_IMAGE` pin now matches that digest. The service converged 1/1;
internal `/health` returned `status=ok` and `postgres=ok`. Inspection of the
running image confirmed the product-reference source has no `admin_api`
branch. The inactive Medusa Admin Secret API Key is retained by user choice.

Historical `order.placed` mappings/facts remain solely for legacy replay and
queries. CDC recovery continues through coverage epochs, snapshot and quality
gates. Browser SDK/storefront HTTP events still use Source Ingress/Event Feed
and Source Connector until the Pipeline Gateway has its own cutover.
