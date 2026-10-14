# Swarm autoscale: current Worker image fixture — 2026-10-14

This is an isolated, single-node `OFFLINE_DEMO` test, **not** authorization to
enable unattended autoscaling on the live stack. The disposable stack
`funnelmetry-scale-fixture-20261014b` used a separate Kafka volume, no Source
Connector, no published ports, and synthetic Raw events only.

## Image and result

- Worker: `ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:a23a7597192c16367ac0627390acbc6a18a210bca0ef9ddad3556fd1cfaec93a`
  (the image pinned by `funnelmetry-live-20261014_canonical-normalizer`).
- Kafka: `apache/kafka@sha256:4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed`.
- All four fixture topics had two partitions. The Worker used per-container
  transactional identity and the `swarm-scale-normalizer-v1` group.
- Published 600 synthetic `behavior.product_viewed` Raw records at one replica.
  While backlog remained, manually scaled 1→2; the two members each owned one
  partition. Both committed offsets reached log end (299/299 and 301/301).
  A fresh `read_committed` verifier found 600 unique canonical events and 600
  matching unique outcomes, with zero quarantine records.
- After the group drained, manually scaled 2→1. The remaining member owned
  both partitions and both committed offsets stayed at log end. Published 400
  more Raw records; both partitions again reached log end (509/509 and 491/491).
  A fresh verifier found **1,000 unique canonical events**, **1,000 matching
  outcomes**, and **zero quarantine records**, with matching source-event IDs.
- The canonical/outcome log-end offsets were 2,000 each for 1,000 actual
  records because transaction control records consume offsets. They are not
  record counts. The verifier counted visible `read_committed` messages.
- The four focused observer/policy/controller test files passed: 25/25 tests.

This demonstrates manual single-node Worker 1→2→1 and replay-safe processing
for this exact image. It does **not** demonstrate policy-triggered `--apply`,
in-flight SIGTERM during a transaction, cross-node placement, live Source Feed
replay, or production least-privilege Docker actuator access. Do not copy the
fixture result into the controller's live `evidence` fields as an unrestricted
release approval.

## Live stack observation and remaining gate

The live stack was not scaled. It remained at one canonical-normalizer replica
and its other continuous services remained 1/1 after the fixture run. The live
Raw consumer group showed offset 427/428 on partition 0 and 471/472 on
partition 1: the existing high-watermark-based observer reports lag 2. Given
the transactional Source Connector, a one-offset tail per partition may be a
control record, **but this run did not prove that**. Conversely, the persisted
canonical outcome count alone does not prove the consumer is drained while the
source continues publishing. The autoscale policy correctly refuses to treat
this nonzero or ambiguous offset gap as a zero-backlog scale-down signal.

Before live `--apply` or unattended operation: distinguish consumable backlog
from transaction control records without hiding real messages; verify a live
in-flight graceful drain/replay for the pinned image; review the controller's
release-bound evidence and conservative capacity thresholds; and isolate its
Docker-manager privilege behind an approved least-privilege boundary. Until
then, use read-only observation and operator-reviewed manual scaling only.

Fixture sources: `tools/swarm-controllers/fixtures/swarm-scale.yml` and
`tools/swarm-controllers/fixtures/kafka-scale-smoke.mjs`. The fixture stack and
its synthetic volume are disposable and must not be treated as live data or a
backup.

## Read-only Kafka tail follow-up

A subsequent read-only KafkaJS `Fetch` probe in
`tools/autoscaler/kafka-tail-diagnostic.mjs`, using `read_committed` and the
live group's committed offsets, returned a control record at offset 427 on
partition 0 and a control record at offset 471 on partition 1. Their
high-watermark and last-stable offsets were 428 and 472 respectively. No event
body was printed or consumer-group offset changed. This **confirms those two
specific offsets were transaction control records at the time sampled**; it
does not mean every future one-offset gap is a control record.

The observer now requests per-partition tail evidence and discounts only an
exact, complete, ordered control-only tail (at most 16 offsets), while keeping
the raw offset delta visible. Missing/partial or inconsistent evidence leaves
the raw lag unchanged; unknown committed offsets still fail closed. Unit tests
cover both cases. A live execution of the updated controller probe was attempted
but not completed because the execution approval service hit a usage limit.
Therefore this report does not claim the new probe has passed live runtime
acceptance or authorize live `--apply`.
