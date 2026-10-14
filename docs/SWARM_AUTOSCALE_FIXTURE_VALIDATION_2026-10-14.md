# Swarm canonical-normalizer autoscale fixture validation — 2026-10-14

Scope: disposable single-node `OFFLINE_DEMO` stack
`funnelmetry-scale-fixture-20261014`. This was **not** the teammate's live
stack, did not attach Source Connector, and published no host port. Synthetic
Raw Kafka records bypassed the authenticated Source Event Feed.

## Pinned runtime and gates

- Worker image: `ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:f743b0670e2b920580b551fe20077e716e11b28bc3b1eebbbfc34c49b2bf480d`.
- Kafka image: `apache/kafka@sha256:4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed`.
- Raw, canonical, outcome and quarantine topics each had two partitions. The
  normalizer used per-container transactional identity and one consumer group.
- Seven config/Kafka-runtime tests passed **inside the pinned Worker image**.
  Fixture-specific controller evidence references were then used only with this
  exact stack/image; they are not production release approval.
- Host controller remained read-only by default. `--apply` was used only with
  local ignored config/state bound to the fixture stack and digest.

## Observed sequence

1. Published 600 synthetic `behavior.product_viewed` Raw records. Before both
   partitions had committed offsets, lag was unknown; the controller must not
   interpret that as zero.
2. Manually scaled normalizer 1→2 to validate release behavior. Both tasks
   became healthy and owned separate Raw partitions. Both committed offsets
   caught up to log end. `read_committed` verification found 600 unique
   canonical events and 600 matching unique outcomes, no quarantine records.
3. After lag reached zero, manually scaled 2→1. Service converged, both
   partition offsets remained at log end, and the same identity check passed.
4. Published another 1,000 synthetic Raw records. Controller sample one saw
   lag 996 and held for the observation window. Sample two saw lag 815 and
   applied 1→2 (`ACCEPTED_AWAITING_READINESS`). At 2 replicas, Level-2 Recovery
   correctly held as out of scope while autoscale continued to observe. With
   lag 1 the controller did not reduce replicas.
5. After zero lag persisted through the down window, the controller applied
   2→1. A transient 2/1 service state resolved to 1/1; the next observation
   reported `LIVE_AND_READY` and no repeat action.
6. Final `read_committed` check: Raw **1,600**, unique canonical **1,600**,
   unique outcomes **1,600**, matching identity sets, quarantine **0**, and
   Raw group committed at both log ends. Controller pending-action and
   circuit-open gauges were **0**.

Kafka log-end offsets for canonical/outcome were 3,200 because transactional
control markers consume offsets. They are **not** event counts; the verifier
uses `read_committed` records and checks source-event identity. Repeating the
verification uses a fresh consumer group to avoid resuming a previous probe's
committed offsets.

## Boundary and follow-up

This accepts the isolated **single-node, synthetic Raw→canonical 1→2→1**
behavior of the pinned image and host controller. It does not accept live Source
Feed ingestion, multi-node placement, production least-privilege Docker access,
in-flight SIGTERM under load, restore/cutover, or end-to-end business effects.
The live Raw topic previously observed with one partition and explicit worker
identity remains ineligible for automatic 2-replica scaling. Do not copy the
fixture evidence references into a live controller config.

Reproduction artifacts:
`tools/swarm-controllers/fixtures/swarm-scale.yml` and
`tools/swarm-controllers/fixtures/kafka-scale-smoke.mjs`. Local controller
config/state under `runtime/swarm-controllers/` are ignored and stack-specific.
The fixture YAML now defaults the worker to zero replicas so a fresh run can
create its four topics before explicitly scaling the worker to one; the observed
run initially started the worker before topic creation and saw temporary
dependency-driven task retries. This startup improvement does not alter the
recorded 1→2→1 results.
The disposable stack and its synthetic Kafka volume are removed after evidence
capture; they are not a backup or authoritative data source.
