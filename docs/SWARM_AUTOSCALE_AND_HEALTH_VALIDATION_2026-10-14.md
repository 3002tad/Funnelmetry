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

## Published image and sustained in-flight fixture

Commit `bfd8061f3b3b5f9eaaebfbb8b8046a22568cbc10` was pushed to GitHub.
The Worker was built from that committed worker/Dockerfile content, pushed to
GHCR as `ghcr.io/3002tad/funnelmetry/handoff-workers:sha-bfd8061f3b3b5f9eaaebfbb8b8046a22568cbc10`,
and the remote digest was verified as
`sha256:f61aa962eae67c8133c26d29bba68567abf001836b8d2bc19e48c4e691c901b9`.
The local live stack still runs its previous Worker digest; publishing is not
deployment.

A new isolated stack `funnelmetry-scale-paced-20261014` used this exact GHCR
digest, a separate Kafka volume, no Source Connector and no published ports.
The fixture Worker CPU limit was deliberately reduced to 0.25 CPU per replica
and a bounded producer sent 50,000 synthetic Raw events with 50 ms pacing per
100 messages. This load profile is a fault-injection tool, not a live resource
recommendation. Immediately before manually scaling 1→2, the two Raw
partitions had 4,402 and 5,094 unprocessed records. With two healthy replicas,
each member owned one partition; a subsequent sample still showed 3,353 and
5,010 lag while the producer was active. Thus the partition handoff really
overlapped backlog, unlike the earlier fixture.

One fixture replica was then sent SIGTERM while the producer and backlog were
still active. The old task ended `Complete`; Swarm created a replacement that
became healthy. Both partitions reached committed log end. Fresh
`read_committed` verification found exactly **50,000 unique canonical** and
**50,000 unique outcome** source-event IDs, matching Raw identities, zero
quarantine, and no missing/duplicate identities. After lag was zero, manual
2→1 scale converged to one member owning both partitions; the verifier passed
again. Worker logs contained five transient `AddPartitionsToTxn`/
`ConcurrentTransactions` error lines around rebalance, but zero normalizer
runtime-failure lines. This establishes data convergence for the tested
single-node synthetic workload; it does **not** establish a zero-error
transaction SLA, multi-node behavior or live Source Feed replay acceptance.
The fixture stack and its synthetic Kafka volume were removed afterward;
their data cannot be recovered. The live stack was not modified.

Unattended live `--apply` is still blocked by the Docker-manager permission
boundary. `docker info` on the current engine reported no authorization plugin.
Code-level target allowlisting does not constrain the operator's full daemon
access. Docker's default authorization is all-or-nothing; a reviewed daemon
authorization mechanism or equivalent constrained manager boundary must be
provided and tested before running the controller unattended. See the
[Docker authorization documentation](https://docs.docker.com/engine/extend/plugins_authorization).
Release-specific **live** in-flight replay/rollback, capacity/error-rate
thresholds and controller actuator acceptance are also not yet approved.

## Scoped live Normalizer image rollout

On the single-node `funnelmetry-live-20261014` stack, the normalizer alone was
updated from Workers digest `sha256:a23a7597192c16367ac0627390acbc6a18a210bca0ef9ddad3556fd1cfaec93a`
to `sha256:f61aa962eae67c8133c26d29bba68567abf001836b8d2bc19e48c4e691c901b9`.
The latter was pulled from GHCR before rollout. The service retained one
replica, `stop-first` update and automatic rollback-on-failure policy. Docker
reported `UpdateStatus=completed`; the replacement task was healthy and both
`/healthz` and `/readyz` returned HTTP 200. A read-only Kafka probe found a
stable group with one member owning both Raw partitions, consumable lag `0`,
raw offset delta `2` consisting of two verified control-only tails. Recent
normalizer logs had zero matching `ERROR`, `ConcurrentTransactions`,
`AddPartitionsToTxn` or runtime-failure lines. The Connector `/readyz` returned
HTTP 200. The ledger writer and Connector remained on the older Workers digest.

PostgreSQL counts were 450 canonicalization outcomes and 435 canonical events
both before and after this rollout. No fresh Medusa event arrived during the
observation, so this does **not** prove live in-flight Raw-to-canonical behavior
on the new digest or a live rollback. A separate source-generated event and
ID-by-ID Raw/outcome/canonical trace are still required. Autoscale and
unattended controller `--apply` remain OFF. The existing ignored controller
config/state still belong to the old digest; do not reuse that state with the
new image or bypass its fingerprint/pending-action guard.

`runtime/deploy.env` now keeps `SWARM_WORKERS_IMAGE` on the old digest and pins
the new digest in `SWARM_NORMALIZER_IMAGE`. The launcher renders that optional
override only for `canonical-normalizer`; leaving it blank makes a fresh stack
use the common Workers image. This prevents a future reviewed `deploy-app`
from silently reverting the normalizer, while avoiding a rollout of every
worker. For manual rollback, first restore the old `SWARM_NORMALIZER_IMAGE`
value in the ignored env, then run `docker service update --image
ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:a23a7597192c16367ac0627390acbc6a18a210bca0ef9ddad3556fd1cfaec93a
--detach=false funnelmetry-live-20261014_canonical-normalizer` and recheck
health, group lag and outcomes. This rollback was documented, not exercised
against live data.

## Recovery after local Docker restart / absent stack

On the next operator check, Docker Desktop was already running and the Swarm
manager was active, but `funnelmetry-live-20261014` had no services. The
previously named PostgreSQL/Kafka volumes, eight Swarm secret names and the
stateful/edge node labels still existed. This was an absent stack, **not** a
task-replacement test; the reason the stack disappeared was not established.
No volume or secret was removed or recreated.

The operator first ran `node runtime/swarm.mjs check-app`, then restored the
data substrate with `node runtime/swarm.mjs deploy`. The bootstrap job reported
that the existing schema matched and no reseed/migration occurred. The Kafka
topic job verified the existing partition layout and completed after transient
startup connection retries. PostgreSQL and Kafka became healthy; the persisted
database still had 450 outcomes and 435 canonical events. Only then did the
operator run `node runtime/swarm.mjs deploy-app` to restore the application,
HTTPS edge and live Source Connector.

All continuous services reached 1/1; the normalizer retained the new scoped
digest, one replica and healthy/ready state. Local HTTPS `/healthz` returned
200 with TLS verification result 0. The connector reported `READY`, matching
feed ID, cursor `after_seq=450`, retention floor `0`, latest available sequence
`450` and no new returned event. A read-only Normalizer Kafka probe found one
stable member owning two Raw partitions, consumable lag `0`, with a raw offset
delta `2` consisting of verified control-only tails. There were no matching
recent transaction/runtime-failure log lines. The outcome split remained 435
normalized, 4 quarantined and 11 unsupported.

This confirms the existing state resumed on this single-node machine. It
does **not** prove automatic stack recreation after stack removal, a new live
Medusa event processed on the new digest, replay after loss of persistent
state, or multi-node HA. A source-generated event ID must still be traced
through Feed, Raw, canonicalization outcome and canonical ledger. Autoscale
and unattended controller `--apply` remain OFF.

## New live Medusa events after recovery

After a user-operated Medusa shop action, Source Connector stayed `READY` and
advanced the same Feed lineage from cursor `450` to `460`; the latest available
sequence was `460` and the retention floor remained `0`. A bounded, read-only
`read_committed` fetch of the two live Raw Kafka partitions found exactly ten
records with ingress sequences `451` through `460`, each with a distinct
`medusa-reference` event ID. No Raw payload was printed or written to disk.

The same ten IDs were found in `ingress_accepted_receipts`,
`canonicalization_outcomes` and `canonical_events`: ten normalized outcomes,
ten receipt-ingestion IDs matching outcome raw-record IDs, and ten matching
canonical IDs. The new canonical types included `behavior.page_viewed`,
`behavior.scroll_depth_reached`, `promotion.banner_impression`,
`behavior.product_viewed` and `cart.item_added`. The `product_viewed` event was
class `BEHAVIOR_INTENT`; `cart.item_added` was class `BUSINESS_FACT`. Database
totals advanced from 450 receipts/outcomes and 435 canonical events to
460/460/445. The canonical `(source_id, source_event_id, mapping_version)`
duplicate count was zero. The normalizer still had one healthy/ready replica,
a stable one-member group owning both Raw partitions, consumable lag `0` and
two verified control-only offset tails. No recent matching transaction/runtime
failure lines appeared in its service log. This proves the new pinned digest
processed those ten live records end to end on this single-node stack; it does
not prove live in-flight 1-to-2-to-1 autoscaling, rollback or multi-node HA.

The read-only controller adapter initially failed after the stack was freshly
deployed because Docker omits `UpdateStatus` until a service update exists.
Its narrow service-inspect template now emits JSON `null` for that absent
field while still rejecting an active `updating` or `rollback_started` state.
The targeted controller/adapter suite passed 13 tests; a subsequent live
read-only adapter probe reported one ready replica and zero consumable lag.
No controller state was reset and no `--apply` action was run.
