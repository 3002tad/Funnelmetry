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

## Manual live 1-to-2-to-1 replica rehearsal after release

The operator manually scaled only `funnelmetry-live-20261014_canonical-normalizer`
from one to two replicas and back to one, on the new Workers digest above.
Before scale-out, the single task was live/ready, its group was stable on two
Raw partitions, consumable lag was `0`, and the reservation/headroom probe
allowed at least two replicas. No controller runner/session or `--apply` was
active. The two tasks became live/ready with distinct container-mode instance
IDs; Kafka reported a stable two-member group with assignments `[1]` and
`[0]`, one partition per member. Consumable lag remained `0` (raw offset
delta `2`, both verified control-only tails). The scale-down precheck again
required two ready tasks, a stable two-member/two-partition group and zero
consumable lag. After manual scale-down, one ready task owned both partitions
with lag `0`. PostgreSQL totals remained 460 receipts, 460 outcomes and 445
canonical events; no matching transaction/runtime-failure log lines appeared.

The Source Feed cursor and latest sequence stayed at `460` throughout this
rehearsal. **No new source event was processed while two replicas were
running.** This is live service scaling and Kafka rebalance evidence, not
live in-flight event processing, duplicate-effect acceptance or automatic
policy/actuator acceptance. The stronger synthetic in-flight fixture evidence
above remains separate. Autoscale and unattended controller `--apply` stay OFF
until a source-generated in-flight test, release-specific review and the
least-privilege Docker-manager boundary are accepted.

## Follow-up: live Medusa events during two normalizer replicas

The first user shop action arrived **after** the rehearsal above had scaled
back to one replica: the service update to one replica was at
`2026-10-14T15:21:48Z`, whereas 21 new outcomes were processed between
`15:25:43Z` and `15:26:28Z`. Those 21 normalized events therefore are not
counted as two-replica evidence.

For a second, separately bounded manual test, the operator scaled only the
canonical normalizer to two replicas at `2026-10-14T15:29:01Z`. Both tasks
were alive and ready, had distinct container-mode instance IDs, and formed a
stable two-member Kafka group assigning partitions `[1]` and `[0]`. Following
another user shop action, 34 distinct outcomes were processed from
`15:29:16Z` through `15:30:19Z`, all with status `normalized`. All 34 IDs
matched accepted ingress receipts and canonical events; receipt ingestion IDs
matched outcome raw-record IDs, and outcome canonical IDs matched ledger IDs.
The observed types were `behavior.page_viewed`, `behavior.product_viewed`,
`behavior.scroll_depth_reached`, `cart.item_added` and `checkout.started`.
The canonical `(source_id, source_event_id, mapping_version)` duplicate count
was zero. Database outcomes reached 515.

Before scale-down, both tasks were still ready and the two-member group was
stable with consumable lag `0` (raw offset delta `2`, both verified
control-only tails). The operator then manually restored one replica; the
remaining task was ready and owned both partitions in a stable one-member
group, again with consumable lag `0`. This demonstrates live in-flight
processing during a manual 1-to-2-to-1 transition on this single-node stack.
It does **not** demonstrate automatic controller action, worker-failure
recovery, multi-node HA, or production authorization for controller
`--apply`; those remain separate acceptance gates.

## Read-only live baseline and current-digest automatic fixture

The local controller config/state were preserved: `config.json` still pins the
older Workers digest `a23a7597...`, while the live normalizer runs digest
`f61aa962...`. Calling the persisted controller against live with that stale
config would correctly fail scope/fingerprint checks. The new
`tools/swarm-controllers/measure.mjs` read-only probe accepts an explicit
current digest in memory, discards any old-image release attestation, and
does not write the config/state or invoke a Swarm action. Three live samples
at `15:37:02Z`, `15:37:09Z` and `15:37:15Z` each showed one ready replica,
a stable one-member/two-partition group, consumable lag `0`, raw offset delta
`2` with two verified control-only tails, valid identity and no unavailable
probes. The single idle CPU/RAM snapshot was `2.48%` and `46.22 MiB` of its
`512 MiB` limit. This is an idle baseline, **not** a throughput benchmark or
approval of the experimental scale thresholds. Docker authorization plugins
were still absent (`null`); no live controller `--apply` was run.

Two fresh, isolated `OFFLINE_DEMO` Swarm fixtures used the exact live Workers
digest, separate Kafka volumes/topics, no Source Connector and no published
ports. The first published 60,000 synthetic Raw records. The controller saw
a `19,643`-record backlog in one sample, but the next sample found lag `0`,
so it correctly did not scale on an unsustained signal. A fresh
`read_committed` verifier found 60,000 unique matching canonical and outcome
IDs, both Raw partitions committed at log end and zero quarantine.

The second fixture ran the controller in the foreground with `--apply`
**only against that fixture**, sampling every five seconds. Its first 100
synthetic events established both partition offsets, then another 50,000
created a sustained backlog. Across 16 audit samples the maximum observed
lag was `34,953`. The controller accepted 1→2 for `SUSTAINED_BACKLOG` at
`15:45:15Z`, waited for convergence, and accepted 2→1 for
`SUSTAINED_LOW_BACKLOG` at `15:45:50Z` after zero lag persisted. The runner
was stopped; persisted state had no pending action or open recovery circuit,
and the fixture ended at one ready replica. A fresh `read_committed` verifier
found exactly 50,100 unique canonical and matching outcome IDs, both Raw
partitions committed at log end, and zero quarantine. The fixture Worker
service logs contained one `AddPartitionsToTxn` error line, zero
`ConcurrentTransactions` lines and zero runtime-failure lines. Both fixture
stacks and their **synthetic-only Kafka volumes** were removed after
verification; their data cannot be recovered. The live stack remained at one
normalizer replica.

The fixture deliberately limits each normalizer to `0.25` CPU and uses a
five-second up/15-second down window. These numbers are fault-injection
settings, not live performance thresholds or an error-rate SLA. Unattended
live autoscale remains OFF pending a reviewed restricted Docker-manager
actuator boundary, release-specific live rollback/drain acceptance, and a
representative capacity/error-rate benchmark. The old persisted live
controller state must be reviewed/migrated for the new digest; do not reset
it merely to bypass its fingerprint guard.

## Live worker RAM rollout and supplementary signal

On 2026-10-14, the live stack `funnelmetry-live-20261014` was redeployed with
the shared continuous-worker reservation raised from 128 MiB to 256 MiB and
the hard limit changed from 512 MiB to 516 MiB. Docker reported completed
updates for the normalizer, ledger, ingress telemetry, traffic source, journey,
funnel, KPI and maturity workers; each service spec reported reservation
`268435456` bytes and limit `541065216` bytes, with one running replica.
The one-shot profile publisher retained its separate 128/256 MiB settings.

Three read-only post-rollout normalizer probes found one ready task, stable
one-member Kafka group over two partitions, consumable lag `0`, valid identity,
no unavailable probes, and RAM readings of 6.80%, 6.84% and 6.82% of the new
limit. These are idle samples; they do not validate behavior near the limit.

The controller policy now accepts an optional 80% up / 60% down RAM hysteresis
in its example config. High RAM can support scale-up only when there is also
nonzero consumable backlog; RAM alone cannot trigger it. Downscale holds if
RAM is high or the RAM probe is unavailable. These values are experimental.
Unit/adapter tests cover this decision path, but a real high-RAM live
scale-up/down has **not** been performed. The local controller config still
pins an older image digest, release evidence for the current image is not
configured, and the Docker daemon has no authorization plugin. The live
background controller and `--apply` remain OFF pending the restricted
Docker-manager actuator boundary and release-specific acceptance. Applying
resource limits is not the same as enabling autoscale.

## Live auto-enable request: preflight result

At 2026-10-14 16:05 UTC, a fresh read-only three-sample probe of
`funnelmetry-live-20261014_canonical-normalizer` reported one ready replica,
stable one-member group across two partitions, consumable lag `0`, valid
container identity, no unavailable probes, and RAM 6.89%/6.90%/6.86% of
the 516 MiB limit. The current Worker digest is `f61aa962...c901b9`;
the ignored local controller config still pins `a23a7597...faec93a`
and contains no current-image replay/drain evidence. The persisted controller
state is not pending but its last observation is `STALE`; its last reason is
`REPLICA_SAFETY_UNVERIFIED`. Docker reported an active manager with no
authorization plugin. All 45 focused tests passed.

No live `--apply` or background runner was started. A healthy idle probe is
not an automatic scale acceptance test, and it cannot produce a scale-up
signal. The requested live automatic 1-to-2-to-1 test remains blocked by
the exact-image evidence/state review and the least-privilege Docker-manager
actuator boundary required by DEC-129. Do not rewrite the ignored state,
invent evidence references, or give an unrestricted manager socket to the
controller to make the test pass.

## Read-only live preflight follow-up

The new `tools/swarm-controllers/live-preflight.mjs` checks manager status,
the live service's immutable image, persisted controller state, active runner
lease, readiness/group identity, partition/capacity ceiling, memory probe,
release evidence and Docker actuator isolation. It reads state but does not
write state, scale a service, start a runner, or attest authorization.

On this Docker Desktop live stack it reported `observedReplicas=1`,
`observedConsumableLag=0`, `controllerImageMatchesRuntime=false` and three
blockers: `IMAGE_DIGEST_MISMATCH`,
`RELEASE_REPLAY_DRAIN_EVIDENCE_MISSING`, and
`RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED`. The local controller must not be
pointed at an unrestricted Docker daemon just to clear these gates. A
restricted Windows broker or daemon authorization policy, exact-image
replay/drain review, and audited state migration remain separate work before
an automatic live 1-to-2-to-1 acceptance test.

## 2026-10-15 restricted-broker implementation candidate

Added a separate, default-off private Swarm stack containing a manager-side
scale broker and a socket-free controller. The broker accepts only bounded
read probes and one-step `canonical-normalizer` replica updates after
rechecking the exact stack/service/image, coherent group, readiness, release
attestation and capacity. Level-2 force-update is not exposed. A dedicated
token, no published port and an internal overlay are specified; the broker's
own Docker socket remains a privileged boundary requiring threat review.

The two local images built successfully on Docker Desktop; both imported in
isolated `--network none` containers. `docker stack config` accepted the new
manifest. Seventeen focused broker/controller tests passed, including denied
generic API methods, foreign tasks, missing token, unreviewed release, failed
Docker update confirmation and disabled recovery. These are implementation
tests, **not** a live security or in-flight replay acceptance.

The read-only live preflight still reports 1 replica, consumable lag 0 and
the same three blockers: `IMAGE_DIGEST_MISMATCH`,
`RELEASE_REPLAY_DRAIN_EVIDENCE_MISSING`,
`RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED`. No controller/broker service was
deployed, no live scale was issued and the existing controller state/config
were not rewritten. Next acceptance requires a reviewed exact-image replay
and drain test, audited migration of the existing controller state, negative
authorization tests from the isolated controller identity, immutable broker
image publication, then a bounded real-backlog automatic 1-to-2-to-1 live run.

## 2026-10-15 image/state synchronization and privilege test boundary

The ignored local controller config was changed from Worker digest
`a23a7597...faec93a` to the exact live normalizer digest
`f61aa962...c901b9`. A dedicated migration command verified the live Swarm
service and old state fingerprint, preserved the ten existing audit entries,
appended one migration audit entry, kept the pending action clear and reset
old-image observation samples. It did not invent release evidence or grant
`--apply`. The subsequent read-only live preflight showed
`controllerImageMatchesRuntime=true`, 1 replica, consumable lag 0, and only
`RELEASE_REPLAY_DRAIN_EVIDENCE_MISSING` and
`RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED` remaining.

A fresh broker token was generated into an ignored local credential file;
its value was never printed. Local broker/controller test images built. An
isolated internal Docker network was created for a negative authorization
smoke, but the attempted broker container was **rejected by the execution
approval gate** because mounting the live Docker socket confers
manager-equivalent privilege. No broker container or Swarm control stack was
started, no live service was scaled, and the empty temporary network was
removed. Do not substitute an indirect socket mount. Explicit approval of
that privileged test and a security review are still required.

After the user explicitly approved the exact temporary Docker-socket test,
the broker was started on an internal, unpublished Docker network and the
socket-free controller image ran `boundary-smoke.mjs`. The controller observed
no Docker socket or CLI. Broker HTTP rejected a generic Docker API path and a
missing token; authenticated `forceUpdate` and a scale request without release
evidence were rejected, while the allowlisted service read succeeded. The
broker audit recorded four denied/failed requests and one accepted read, with
no token in the log. The broker container and internal network were then
stopped and removed; live normalizer replicas remained unchanged. This is a
negative authorization smoke for the candidate broker, not permission to
leave a Docker-socket broker running unattended or to claim live replay/drain.

## 2026-10-15 exact-image live replay and manual replica drain

Evidence references for the local demo controller: `live-replay-20261015`
and `live-drain-20261015`. These refer only to the bounded observations below.

With the user's explicit approval, the local live stack
`funnelmetry-live-20261014` was tested against the **currently deployed**
normalizer image `ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:f61aa962eae67c8133c26d29bba68567abf001836b8d2bc19e48c4e691c901b9`.
The initial Medusa Source Connector cursor was 518; PostgreSQL held 503
`medusa-reference` canonical events, 503 normalized outcomes, 11 unsupported
outcomes and 4 quarantined outcomes. The normalizer was the only live service
scaled to 0/0; Source Connector, Kafka and PostgreSQL stayed up. While the user
generated real shop traffic, Kafka consumer-group lag rose to 5 and 9 on its
two Raw partitions. The normalizer was promptly restored to 1/1; the cursor
advanced to 534 and canonical/normalized counts to 519. A read-only probe
reported one ready, identity-verified group member and **zero consumable lag**;
the raw offset delta of 2 was a verified control-record-only tail.

The normalizer was then manually scaled 1 to 2 replicas. At 2/2, a read-only
probe reported two ready, identity-verified members, two partitions and zero
consumable lag. The user generated more real shop events; the cursor advanced
from 540 to 554 and canonical/normalized counts from 525 to 539, with no new
unsupported or quarantined outcomes. Only after the zero-lag check was the
service manually scaled back to 1/1. Final cursor was 555, canonical and
normalized counts 540, and 37 of 37 canonical rows added since the initial
baseline had distinct source event IDs. Final read-only probe showed 1/1,
ready, stable group, zero consumable lag and two verified control-only tails.

This proves bounded live Kafka backlog replay and a manual 1-to-2-to-1
rebalance/drain with real Source Feed traffic for this image. It does **not**
prove automatic scale triggering at the configured 100-record/60-second
threshold, an in-flight transaction specifically interrupted by scale-down,
production security certification, or multi-node behavior. The release
evidence and restricted-actuator preflight gates remain unset at this point;
the controller service is 0/0 and only the approved private broker is 1/1.

### Follow-up: local-demo controller enablement

After the replay/drain observations were reviewed, the ignored controller
config received the two evidence references above. The one-time
`attest-release.mjs` migration preserved prior state and cooldown, appended
an audit entry (12 total), and reset old observations only after a fresh
exact-image, ready, zero-consumable-lag check. Its state was copied to the
dedicated Swarm volume with a matching SHA-256. The separate broker stack was
redeployed with that config; an initial Docker overlay-removal race caused
the first redeploy attempt to fail, and the retry completed after network
cleanup. The application live stack was not removed.

The local-demo preflight then reported no blockers after verifying the actual
broker/controller service specs and an explicit local risk attestation. The
scale-only controller was enabled 1/1; the broker is 1/1. Its first live
observation reported one ready normalizer replica, zero consumable lag, and
`HOLD`/no scale action. This proves the controller is running and observing,
**not** that the automatic 100-record/60-second scale-up and subsequent
scale-down have occurred. Those require a separate bounded sustained-load
test. The broker still has privileged Docker-manager socket access; no
production security claim is made.
