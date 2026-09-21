# Funnelmetry Medusa CI Installer V2

This package implements the CI stage of the input-only integration plan without
writing to the Medusa checkout. It validates a pinned Medusa v2 DTC Starter,
reads `funnelmetry.integration.yaml`, and writes two review artifacts **outside**
the source checkout:

- `integration-plan.json`: host/capability report and ownership list.
- `integration.patch`: a PR-ready patch for the generated Browser SDK hooks, a
  bounded Medusa delivery dispatcher, and the `order.placed` subscriber. Patch chỉ thêm host binding mỏng và hai
  dependency đã pin: `@3002tad/funnelmetry-browser-sdk` và
  `@3002tad/funnelmetry-backend-integration-kit`; nó không chép runtime SDK/forwarder vào
  source Medusa.

The generated backend dispatcher owns only host-process delivery lifecycle: one
bounded in-memory queue, bounded retry through the backend kit, and a cooldown
circuit breaker. The Medusa subscriber returns immediately after scheduling its
work; it never waits for an ingress receipt or changes checkout/order outcome.
Queue-full, retry-exhausted, and process-restart events are observable
pre-durable-handoff loss, not a durability claim. Reconciliation remains the
mechanism for quantifying/repairing the supported current projection later.

The installer implements behavior catalog V2. Browser hooks emit only consented browser observations
(page, scroll, banner, filter, product view, checkout). It deliberately does **not** generate
`cart.add_clicked` or a browser-side search event. The source-owned storefront boundary instead emits
`cart.item_added` only after a successful line-item mutation. An intentional search receives an opaque
interaction id, and the server-side result wrapper sanitizes/normalizes the query before recording its
outcome. These hooks enqueue asynchronously and fail open, so neither cart nor Search API behavior
depends on Funnelmetry. The generated consent notice enables browser tracking only after the user
closes it. The order subscriber emits source-native `medusa.order_placed`; the versioned Normalizer
owns the conservative conversion to `order.created` as `BUSINESS_FACT`.

The pinned V2.2 runtime packages emit `checkout.started` once for each cart in a browser
session, at the initial address stage. Delivery, payment, and review route
transitions do not produce more `checkout.started` events. The installer
recognizes the prior V2 checkout binding and produces a reviewable upgrade patch;
it does not require a hand edit of Medusa source.

V2 preserves the reference-validation fixes: bounded queued delivery and circuit breaker; lazy package
loading; TypeScript-compatible query sanitization; non-negative integer validation for successful search
result counts; and `Date`/string normalization for authoritative order timestamps. The plan reports
`cartItemPersisted` and `searchSubmitted` as enabled only when the pinned host exposes every required
semantic-hook file.

The `bindings` block in `funnelmetry.integration.yaml` is the authoritative
binding allowlist. The current pinned Medusa profile requires the two
source-owned storefront bindings (`behavior.search_submitted` and
`cart.item_added`) and the backend binding (`medusa.order_placed`) to be listed
explicitly; browser bindings remain an explicit non-empty subset of the
supported catalog. The planner must not silently enable a binding that is absent
from this manifest.

`ingest.browser_url` is the URL embedded in the Browser SDK and must be reachable from the
storefront user's browser. `ingest.backend_url` is embedded in the Medusa subscriber and may be
an internal/container-reachable URL. A binding only requires the endpoint it enables.

There is deliberately no local `apply` command. The customer workflow owns patch
validation/application, package resolution, host validation, and committing back
to the same pre-created integration branch.

Runtime network topology is intentionally outside the source patch. On a Linux Docker host where Source
Ingress is a separate Compose project, storefront and backend must join the Source Ingress external
network and `FUNNELMETRY_INGEST_URL` must use its service DNS. Do not rely on `host.docker.internal` to
reach an ingress port bound only to host loopback.

## Commands

```powershell
# Run inside this package after checking out a Medusa project elsewhere.
node src/cli.mjs doctor `
  --config examples/funnelmetry.integration.yaml `
  --project <medusa-checkout>

node src/cli.mjs plan `
  --config examples/funnelmetry.integration.yaml `
  --project <medusa-checkout> `
  --out <directory-outside-medusa>
```

`--out` is rejected when it is inside the Medusa checkout. The container example
in `ci/medusa-integration-plan.workflow.yml` mounts `/workspace` read-only, so
the invariant is enforced both by Docker and by the CLI.

## CI flow

1. The source owner creates `funnelmetry/integration/<name>` and commits the
   non-secret `funnelmetry.integration.yaml` on that branch.
2. The read-only plan workflow records/checks the generated plan and patch so the
   owner can inspect the exact files affected.
3. The propose workflow independently regenerates the same patch from the YAML,
   validates its ownership allowlist, applies it, validates the host, and commits
   back to that same branch. It does not create a branch or merge/deploy it.
4. The normal host CI builds/deploys the resulting integration branch. Runtime secrets
   are injected by the customer's secret manager; they never appear in the
   manifest or plan artifact.

Trước khi áp patch, source owner phải cấu hình package registry hoặc artifact
source nội bộ chứa đúng hai package version được pin. Nếu package không resolve
được, host CI phải fail thay vì thay bằng một SDK/version khác.

The workflow template is intentionally not enabled in this repository: it must
be copied/adapted in the customer Medusa repository with a real installer image
reference or checked-out Funnelmetry source.
