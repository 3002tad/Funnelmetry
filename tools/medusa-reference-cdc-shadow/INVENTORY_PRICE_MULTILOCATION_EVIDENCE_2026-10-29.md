# One inventory item across two stock locations — 2026-10-29

**Environment:** isolated stage2b Medusa 2.19.0 clone on `kltn`, Compose project
`funnelmetry_cdc_inventory_price_shadow_stage2b`, coverage epoch
`inventory-price-shadow-20261029-b`. No live source, Pipeline binding or
Gateway change. The fixture was removed after every attempt; the Store API
quantity returned to its starting value and clone services were stopped.

## Runtime sequence

1. The probe selected a managed variant with one linked inventory item and one
   channel/location. It added a second stock location, the channel/location
   link and an inventory level with seven stocked units. CDC reconciled all
   16 source tables and offsets, but Store API quantity changed by **zero**.
   Restarting Redis and Medusa backend did not change the result.
2. Schema inspection showed that Medusa's existing inventory levels store
   `stocked_quantity` **and** `raw_stocked_quantity` (similarly for reserved
   and incoming quantities). The direct SQL fixture had initially written only
   numeric columns. With matching `raw_*_quantity` JSONB values and the same
   seven stocked units, Store API quantity increased by **seven** and returned
   to baseline after fixture removal.
3. The resolver candidate was extended to sum available quantity for one
   inventory item across the channel's eligible locations when each location
   has one level. A final probe compared its result from the **governed CDC
   context** with Store API. Both reported a seven-unit increase;
   `resolver_matches_store_api=true`, `cdc_reconciled=true`,
   `status=PASS_SAMPLE_ONLY`. Nine local resolver tests passed, including a
   second location and a missing-level case that remains `UNVERIFIED`.
4. The source numeric/raw verifier found **0** inconsistent inventory levels
   and **0** inconsistent price rows after cleanup. The context lease publisher
   now includes this check twice. After the projection caught up, it published
   a 45-second **context-only** lease with evidence ref
   `stage2b-multilocation-numeric-20261029` and digest
   `5d211f554c83ae990d8166a9739d5a4a4abf38091d9db14d81515881f98adff4`.
   A mismatch or query failure blocks lease renewal; it does not create a
   customer-visible inventory or price asset.

The numeric/raw check is source-side evidence, not a request to replicate raw
JSON amount buffers through CDC. A normal Medusa workflow must keep the two
representations consistent; future target-topology checks must verify this
continuously. The outcome confirms only **one item, two eligible locations,
seven added units**. Inventory kits, varied required quantities, backorder,
missing levels and pricing rules remain separate conformance work.
