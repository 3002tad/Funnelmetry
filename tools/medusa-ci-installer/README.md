# Funnelmetry Medusa CI Installer (plan-only prototype)

This package implements the CI stage of the input-only integration plan without
writing to the Medusa checkout. It validates a pinned Medusa v2 DTC Starter,
reads `funnelmetry.integration.yaml`, and writes two review artifacts **outside**
the source checkout:

- `integration-plan.json`: host/capability report and ownership list.
- `integration.patch`: a PR-ready patch for the generated Browser SDK hooks and
  Medusa `order.placed` subscriber.

There is deliberately no `apply` command. Applying the patch, committing it and
building a production host image remain explicit customer CI/CD decisions.

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

1. The Medusa repository commits a non-secret `funnelmetry.integration.yaml`.
2. CI runs `plan` and publishes review artifacts.
3. A developer reviews the generated patch and opens/merges a separate PR if it
   is acceptable.
4. The normal host CI builds/deploys the resulting Medusa image. Runtime secrets
   are injected by the customer's secret manager; they never appear in the
   manifest or plan artifact.

The workflow template is intentionally not enabled in this repository: it must
be copied/adapted in the customer Medusa repository with a real installer image
reference or checked-out Funnelmetry source.
