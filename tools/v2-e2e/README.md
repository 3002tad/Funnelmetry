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

After all four original events have reached the KPI Projector, each Commerce self-test sends twelve
concurrent retries (three per event). It requires duplicate receipts with the original ingestion IDs,
unchanged raw-topic offsets, four canonical rows and journey links, and unchanged KPI instance/step
facts (including revision and occurrence counts). This tests HTTP retry suppression through the
analytics boundary; it does not inject Kafka redelivery or a worker crash.

Run on a dedicated stack without unrelated ingress traffic: the raw-offset check is topic-wide.
For example, from the repository root, with ports 31000 and 55433 available:

```powershell
docker compose -p funnelmetry-e2e-check -f infra/compose.v2.yml --profile smoke build
docker compose -p funnelmetry-e2e-check -f infra/compose.v2.yml up -d
docker compose -p funnelmetry-e2e-check -f infra/compose.v2.yml run --rm --no-deps e2e-smoke
docker compose -p funnelmetry-e2e-check -f infra/compose.v2.yml stop
```

Wait for Input Gateway to be healthy before running the smoke command. The project name isolates
Kafka/PostgreSQL volumes from `funnelmetry-v2`; migrations apply to the test project only. Build still
updates the shared `:local` image tags. Stop retains test volumes and evidence; no runtime data is deleted.
The runner requires `KAFKA_TOPIC_RAW` in addition to its existing environment variables (Compose supplies it).

## KPI worker downtime drill

On the dedicated test project, start the stack, wait for Gateway health, then stop only
`kpi-projector`. Run `e2e-smoke` with `--no-deps` in a second terminal. The first scenario sends
four new events and waits up to 90 seconds for KPI conversion. Before that deadline:

1. Verify the worker is stopped and its consumer group has no active members.
2. Verify four new canonical events have no corresponding `kpi_projection_applications` row,
   and the `funnelmetry-kpi-projector-local-v1` consumer group has backlog.
3. Start `kpi-projector` again without changing offsets, re-seeding or re-sending the original events.
4. Require the runner to finish PASS, including concurrent retry checks, and every scenario event
   to have a KPI application. Record the final consumer offsets separately; do not equate offset lag
   with missing business events or require zero when only transaction control positions may remain.

This checks recovery of retained backlog after worker downtime. It does **not** simulate a crash
between PostgreSQL commit and Kafka offset commit, or establish exactly-once behavior for all faults.
Kafka offset lag can include transaction control records; it is not the count of business events.
Keep the UI demo and its database on their separate project/network throughout this drill.

Run it with the local V2 Compose stack documented in [`../../infra/README.md`](../../infra/README.md).
The credentials and generated commerce identifiers are local test values only; the runner does not
execute Medusa itself or mutate `Medusa_Reference`.

This runner does not yet cover the full DEC-073 Browser behavior catalog. Page, scroll, banner,
search and filter coverage requires the cross-repository rollout tracked in
`System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V1_ROLLOUT.md`.
