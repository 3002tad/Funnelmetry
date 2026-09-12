# V2 end-to-end smoke test

This runner verifies independent paths through the public Input Gateway:

- a strict four-step Commerce Conversion pipeline self-test delivered in order;
- the same journey delivered in reverse arrival order but rebuilt by canonical event time;
- the bounded Medusa transport-smoke demo: `behavior.product_viewed`, `cart.add_clicked`, `checkout.started`,
  and source-native `medusa.order_placed` conservatively mapped to `order.created`;
- an unsupported semantic that must produce both a terminal `unsupported` outcome and quarantine
  record without creating a canonical ledger row;
- an event without source timestamps that must persist as `ingress_fallback` and non-authoritative.

Both pipeline self-test scenarios wait until the KPI Projector materializes a converted 4/4 snapshot in
PostgreSQL. That is not a claim that the Medusa binding currently supplies all four facts. The Medusa
scenario explicitly rejects fabricated `cart.item_added` or `order.accepted` output and remains
`IN_PROGRESS`. The runner also verifies the durable duplicate receipt path, then waits for fourteen
unique accepted receipts and terminal outcomes (thirteen normalized and one unsupported).

Run it with the local V2 Compose stack documented in [`../../infra/README.md`](../../infra/README.md).
The credentials and generated commerce identifiers are local test values only; the runner does not
execute Medusa itself or mutate `Medusa_Reference`.

This runner does not yet cover the full DEC-073 Browser behavior catalog. Page, scroll, banner,
search and filter coverage requires the cross-repository rollout tracked in
`System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V1_ROLLOUT.md`.
