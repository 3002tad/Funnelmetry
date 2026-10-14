# Swarm autoscale and health follow-up — 2026-10-14

Scope: single-node Docker Desktop; live stack `funnelmetry-live-20261014` was
observed only. All actuator/fault tests below used isolated synthetic stacks
with separate Kafka volumes and no Source Connector or published ports. This
is not multi-node, production, or authoritative-cutover acceptance.

## Live read-only observation

- `controller.mjs once` without `--apply` observed the pinned normalizer at
  1 replica: liveness/readiness `HEALTHY`, consumable Raw lag `0`, raw offset
  difference `2`, and two verified control-only tails. Docker, Kafka, identity,
  and capacity probes were available. It held with
  `REPLICA_SAFETY_UNVERIFIED` because live release evidence was not configured.
- No controller scale, force-update, or background runner was enabled on live.

## Isolated SIGTERM and controller actuator tests

- Worker image:
  `ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:a23a7597192c16367ac0627390acbc6a18a210bca0ef9ddad3556fd1cfaec93a`.
  Kafka image:
  `apache/kafka@sha256:4ceccc577f03f51f6af8dbfda55194d0d892f4fa7913ffbded567ce3895622ed`.
- First disposable fixture `funnelmetry-scale-drain-20261014` exposed a
  lifecycle bug: a SIGTERM-clean worker exit was not replaced under
  `restart_policy: on-failure`. The continuous-worker policy was changed to
  `any` in code and in the fixture; one-shot publisher remains `none`.
- After that change, SIGTERM with thousands of synthetic Raw records pending
  produced a `Complete` old task and a healthy replacement. Both fixture Raw
  partitions reached committed log end. A fresh `read_committed` verifier saw
  exactly **10,000 unique canonical** and **10,000 unique outcome** IDs,
  matching the 10,000 synthetic Raw IDs; quarantine count was zero.
- Second disposable fixture `funnelmetry-scale-apply-20261014` used an ignored,
  fixture-scoped controller config/evidence and state. The first sample with
  incomplete committed offsets held as `UNKNOWN_WORKLOAD_OR_CAPACITY`. Once
  observable backlog exceeded 9,800, the controller held for its observation
  window, then `--apply` accepted 1→2. Two healthy tasks owned one partition
  each. It held at two replicas while lag remained nonzero. Only after lag
  stayed zero through the configured down window did `--apply` accept 2→1.
  The remaining task owned both partitions with lag zero. A post-action
  read-only observation reported `LIVE_AND_READY`; the fresh verifier again
  saw exactly 10,000 matching, unique canonical/outcome IDs and zero
  quarantine. No pending action or recovery circuit was open.

The fixture thresholds (5-second up window, 15-second down window, 5-second
cooldown) were deliberately shortened for this isolated test; they are **not**
live/production policy. The pinned image emitted repeated Kafka
`ConcurrentTransactions`/`AddPartitionsToTxn` errors under this 10,000-record
stress (over 1,000 ERROR log lines in one surviving task). The offsets still
advanced and both identity checks passed; the errors stopped after drain.
This does not establish acceptable throughput or error behavior for live
autoscale. Investigate that contention and repeat a representative load test.

## Deployment and remaining gates

The checked-in Swarm overlays now declare `/healthz` rather than `/readyz` as
the Source Connector task healthcheck and `restart_policy: any` for continuous
workers, API/Web, live services and edge; one-shot jobs retain `condition:
none`. A reviewed `check-app` and `deploy-app` applied these YAML changes to
the existing live stack without changing image digests, secrets or volumes.
Post-deploy, all continuous services reached 1/1; PostgreSQL, Kafka, API, Web,
Connector and the seven healthchecked workers reported healthy. Connector
`/readyz` remained HTTP 200 `READY` at cursor `after_seq=450`; local HTTPS
`/healthz` returned 200 with successful TLS verification. Docker service spec
inspection confirmed `restart=any` for normalizer, Connector and API, and
`/healthz` for Connector. This does not by itself prove a live fault-injection
or data-level replay acceptance for every service.

A controlled SIGTERM was then sent to the single live normalizer task after
verifying its exact service/image and `restart=any` policy. The old task ended
`Complete`, Swarm created a new task, and the replacement became container
healthy. The controller initially held during startup grace; its next read-only
sample reported `LIVE_AND_READY`, one replica, consumable Raw lag `0` and two
verified control-only tails. Connector `/readyz` stayed `READY` at
`after_seq=450`. No controller `--apply` was run on live. This is a Level-1
task replacement check, not in-flight live event replay proof or Level-2
recovery acceptance.

Live autoscale remains **OFF**. Before unattended live `--apply`, investigate
the transaction error rate, approve release-specific evidence for the exact
image, verify live in-flight drain/replay and capacity thresholds, and provide
a reviewed least-privilege Docker-manager actuator boundary. Fixture success
cannot be copied into live `evidence` automatically. Single-node recovery is
not node/stateful HA. The controller's `status` command reports persisted
state only, not live health.

## Local microbatch candidate follow-up (not deployed live)

The canonical-normalizer source now uses a bounded, configurable transaction
microbatch (default 64 Raw records; 1–256), with canonical/quarantine output,
outcome and the final consumed offset committed atomically per chunk. Its
transactional ID is stable for the consumer group and Raw partition, rather
than for a disposable container instance, so a new owner can fence the old
producer. [KafkaJS transaction guidance](https://kafka.js.org/docs/transactions)
documents both transactional offset commits and the need for stable
per-partition transactional IDs. Unit tests cover chunk boundaries,
failed commit, stale batch, and partition-specific IDs. This is a candidate
source change only: it was built locally as
`funnelmetry-workers:normalizer-batch-candidate`, not published to GHCR or
deployed to the live stack.

An isolated fixture `funnelmetry-scale-batch-20261014` used its own Kafka
volume, no Source Connector and no published ports. With one replica it
processed 10,000 synthetic Raw events. After 1→2 scale, another 10,000 were
processed, followed by 2→1 scale. A fresh `read_committed` verification after
each stage found 20,000 unique matching canonical and outcome IDs in total,
zero quarantine, and both Raw partitions committed at log end. Both replicas
became healthy and each owned one partition while scaled out. The final
single replica owned both partitions at lag zero. The transaction-heavy prior
image produced over 1,000 `ConcurrentTransactions`/`AddPartitionsToTxn` error
lines during the previous 10,000-event fixture; the local candidate emitted
**one** `AddPartitionsToTxn`/`ConcurrentTransactions` error line across this
20,000-event run, near the scale/rebalance window, and no runtime failure.
This is a substantial reduction, **not** proof that the error is eliminated or
that this threshold is acceptable for production.

The fixture stack and its disposable Kafka volume were removed afterward;
that synthetic data cannot be recovered. The live stack was not changed.
Before promoting this candidate, commit/build/publish an immutable image,
repeat an in-flight scale/fault test on that exact digest, establish capacity
and error-rate acceptance thresholds, and review the manager actuator boundary.

After excluding the client label from the stable transaction-ID hash, the
local Worker image was rebuilt and tested again in a second isolated fixture,
`funnelmetry-scale-final-20261014`. It published 20,000 synthetic Raw records,
scaled 1→2 immediately after publication, and then 2→1 after drain. Fresh
`read_committed` verification both before and after scale-down found 20,000
unique matching canonical/outcome IDs, zero quarantine, both Raw offsets at
log end, and no normalizer runtime failures. Its logs had zero
`ConcurrentTransactions`/`AddPartitionsToTxn` errors. The second replica
reached the group after the backlog had already drained, so this is **not**
proof of in-flight partition handoff under sustained load. The second fixture
and its synthetic Kafka volume were also removed. The locally built image is
still not an immutable published release; live autoscale remains OFF.
