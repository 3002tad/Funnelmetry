# CDC-12 reference current-offer metadata

**Scope:** Medusa reference catalog plus 16-table inventory/price CDC context.
This release records semantic metadata only. It does not register a tool or
route to an Agent. The existing `/api/v2/reference-cdc/current-offer` endpoint
continues to calculate one current offer under its existing quality gate.

## Versioned contract

- Asset: `asset.reference_medusa_current_offer@1.0.0`.
- Contract: `reference.medusa.current_offer.v1`.
- Grain: source, variant, sales channel, region and currency. This is a
  parameterized current read, not a materialized fact or historical amount.
- Time basis: current CDC projections at the catalog and stage-2 lease
  verification times. A stale or invalid lease yields
  `BLOCKED_BY_QUALITY`; a price/inventory shape outside the proven Medusa
  reference cases yields `UNVERIFIED` for that field.
- Physical binding: catalog product/variant projections, the stage-2 context
  projection, their quality leases, and the fixed current-offer API path.
  No row of `inventory_level` alone is a sellable-stock claim; no current
  catalog price rewrites order history.

Migration `030_reference_current_offer_metadata.sql` adds immutable releases,
source/epoch-scoped bindings and append-only binding audit. The release and
active binding are published only after both CDC leases are fresh and the
required physical columns exist. Analyst metadata is readable at
`GET /api/v2/catalog/reference-current-offer`; it reports the release and
current runtime availability, without providing an executable tool.

## Operator sequence

1. Apply migration 030 through the reviewed `cdc-candidate-migrations.mjs`
   digest workflow. Previously journaled migrations 021-029 remain unchanged.
2. In a one-shot API image on the private data network, pass the DB password
   through the existing Docker secret and set:

   ```text
   CDC_OFFER_METADATA_SOURCE_ID=medusa-reference
   CDC_OFFER_METADATA_CATALOG_EPOCH_ID=cdc11_catalog_epoch1
   CDC_OFFER_METADATA_STAGE2_EPOCH_ID=cdc11_inventory_price_epoch1
   CDC_OFFER_METADATA_DECISION_REF=DEC-141-2026-10-30
   ```

3. Run `node /workspace/apps/dashboard-api/scripts/reference-current-offer-metadata.mjs publish-shadow`.
   Check the release document, epoch IDs and binding audit. With both leases
   still valid, set
   `CDC_OFFER_METADATA_ACTIVATION_ACK=ACTIVATE_REFERENCE_CURRENT_OFFER_METADATA_V1`
   and run the same script with `activate`.
4. Deploy the API image containing the metadata route and request it as an
   analyst. A successful response is metadata evidence, not a price/stock
   calculation for every possible Medusa shape.

The separate DB-GPT/Agent work will determine future tool contracts. No
stage-2 tool is required for this CDC reference cutover.

## VPS activation evidence, 2026-10-30

- Pipeline commits `af1c1f2` and `f41eb04`; PostgreSQL migration rehearsal and
  API candidate publication CI passed. Published API digest:
  `sha256:d71c3886294287a4e8a5fcedeb28df24dec166c160f8b295bcb1693330a52fcb`.
- Candidate migration plan found eight applied migrations and only
  `030_reference_current_offer_metadata.sql` pending. Reviewed digest
  `a58bf97f248685d5bcd1985f389a6d2fc639952d0f4a4de3c7e06cbb89b6c0d7`
  was applied; no prior candidate migration was rerun.
- Operator publication returned `SHADOW`, then `ACTIVE` for
  `asset.reference_medusa_current_offer@1.0.0`. Both CDC leases and exact
  source epochs passed the activation gate.
- Dashboard API service converged on the published digest. An authenticated
  `analyst@example.local` request to the metadata endpoint returned HTTP 200,
  `ACTIVE`, `REFERENCE_CURRENT_ONLY`, catalog epoch `cdc11_catalog_epoch1`,
  and stage-2 epoch `cdc11_inventory_price_epoch1`.
- The feature checkout's ignored `runtime/deploy.env` pins that API digest;
  `check-app` and `check-host` passed. This was a scoped API service update,
  not a full-stack `deploy-app`: the latter would reset independently enabled
  runtime flags from the current stack template. Full manifest reconciliation
  remains separate deployment work.
