# Medusa CI installer V3

The current manifest is `funnelmetry.io/v3`. The source owner creates an integration
branch and commits `funnelmetry.integration.yaml`. The planner validates the pinned
Medusa DTC Starter and writes `integration-plan.json` and `integration.patch` outside
the Medusa checkout. The source repository workflow applies the patch to that same
branch after checking the generated-file allowlist; it never edits `main` directly.

V3 generates Browser SDK hooks for page, product, checkout, filter, promotion and
search. Search submit calls `trackSearchQuery` without waiting for tracking. Its
payload includes normalized/sanitized keyword, search interaction ID and page instance
ID. The Browser SDK envelope adds session/anonymous identity, occurrence time,
session correlation and first-touch `utm_source` when available. V3 does not generate
search outcome/result count or modify the Search API.
After the storefront add action succeeds, the patch returns the existing cart ID to the
browser and emits `context.cart_linked` once per cart/session. This is a linkage
observation; the CDC stream alone supplies the `cart.item_added` fact.

V3 also emits a `funnelmetry/cdc-cart-line-item.json` profile. The installer only
generates configuration; source and target operators still create the PostgreSQL
publication/role, Kafka topics, Debezium connector and Pipeline mapper separately.
The previous storefront server delivery hooks and backend integration package are
absent from the V3 patch. The order, catalog and inventory/price CDC profiles remain
separately versioned.

To inspect a patch:

```powershell
node tools/medusa-ci-installer/src/cli.mjs plan `
  --config <medusa-checkout>/funnelmetry.integration.yaml `
  --project <medusa-checkout> `
  --out <directory-outside-medusa>
```

Runtime secrets are supplied by the host secret manager. The YAML carries only
references and public endpoints. The old V2 manifest and server hooks are historical
compatibility inputs; they are not the current acquisition target.
