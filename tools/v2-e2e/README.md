# V2 end-to-end smoke test

This runner verifies three paths through the public Input Gateway:

- a four-step Commerce Conversion journey delivered in order;
- the same journey delivered in reverse arrival order but rebuilt by canonical event time;
- an event without source timestamps that must persist as `ingress_fallback` and non-authoritative.

Both commerce scenarios wait until the KPI Projector materializes a converted 4/4 snapshot in
PostgreSQL. The runner also resends an event to verify the durable duplicate receipt path.

Run it with the local V2 Compose stack documented in [`../../infra/README.md`](../../infra/README.md).
The credentials and generated commerce identifiers are local test values only; the runner does not
depend on Medusa or mutate `Medusa_Reference`.
