# Inventory/price CDC resolver candidate — 2026-10-29

**Scope:** isolated stage2b Medusa clone, Compose project
`funnelmetry_cdc_inventory_price_shadow_stage2b`, epoch
`inventory-price-shadow-20261029-b`. No live binding, API sync cutover,
source DB change or published analytical inventory/price asset.

The candidate consumes the governed 16-table CDC context. Before resolution,
the probe independently reconciles source rows, selected attributes, soft
deletes, Kafka ends, applied offsets, connector, snapshot and slot. It passes
the verifier's explicit 16-table coverage set to the resolver: legitimately
empty tables need not appear in grouped context rows. Product/variant flags in
this probe are read directly from the *clone source DB*; replacing that input
with catalog stage-1 governed CDC is still required for a CDC-only target path.

## Observed result

- Eight pure resolver tests passed. They cover managed inventory with
  reservation, unmanaged variant, absent quality/coverage, an empty but
  verified table, reservation/level disagreement, multiple locations, a
  currency-scoped default price, and blocking a price list or quantity tier.
- The first runtime probe passed for one managed variant/item/location and
  a simple EUR default price. After adding the coverage gate, the next probe
  correctly returned `BLOCKED_BY_QUALITY` because the grouped context query
  omitted empty tables. The gate was corrected to use the independent verifier
  coverage list, then re-run against the same clone.
- Final runtime probe returned `PASS_SAMPLE_ONLY`: all five checks were true
  (`availability_resolved`, `inventory_matches_store_api`, `price_resolved`,
  `price_matches_store_api`, `currency_matches_store_api`). The probe did not
  print the private publishable API key or raw source rows.
- All clone services were stopped after the test. Volumes and offsets remain
  for audit. The live Medusa/Pipeline services were not changed.

The supported sample matches [Medusa inventory reservation behavior](https://docs.medusajs.com/resources/commerce-modules/inventory/reservations-lifecycle)
and [price calculation context](https://docs.medusajs.com/resources/commerce-modules/pricing/price-calculation).
These documents describe broader behavior than the single runtime sample.

## Remaining scope

This is a narrow resolver candidate, not the final stage-2 analytical asset.
Multiple items, backorders, inactive channels, full Store API key
scope, price lists, rules, tiers, temporal applicability and region/context
selection still require controlled Medusa API conformance. A fresh, continuous
target-topology quality service must then bind stage-1 catalog and stage-2
context in one governed read path. Current catalog price must never restate a
historical order value.

One managed item across two linked locations was subsequently conformed with
Store API; see [the follow-up evidence](INVENTORY_PRICE_MULTILOCATION_EVIDENCE_2026-10-29.md).
