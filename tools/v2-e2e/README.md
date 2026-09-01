# V2 end-to-end smoke test

This runner sends a four-step Commerce Conversion journey through the public Input Gateway and
waits until the KPI Projector materializes a converted 4/4 snapshot in PostgreSQL. It also resends
the first event to verify the durable duplicate receipt path.

Run it with the local V2 Compose stack documented in [`../../infra/README.md`](../../infra/README.md).
The credentials and generated commerce identifiers are local test values only; the runner does not
depend on Medusa or mutate `Medusa_Reference`.
