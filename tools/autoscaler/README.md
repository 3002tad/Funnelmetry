# Single-host autoscaler — decision policy (2026-10-11)

Authority: Master §24.3.5 / DEC-122; Cookbook pipeline-recovery-observability.
**Decision policy + read-only observer + opt-in replica sandbox, not an enabled autoscaler.**
No scheduled Docker scaling, UI/API route or published handoff image change.
The acceptance runner explicitly scales only its randomized disposable project.

## Implemented

`policy.mjs` evaluates trusted host snapshots for `canonical-normalizer` only. This
candidate restriction is not certification that the current deployment is scale-safe.
All timing/threshold configuration is explicit and EXPERIMENTAL. Tests use synthetic
values, not operational defaults. Lag and thresholds use exact decimal strings.

- Sustained high lag recommends one additional replica after an observation window.
- Sustained low lag requires a longer window and verified graceful drain before reduction.
- Min replicas >= 1; ceiling is minimum of configured max, effective partitions and
  host capacity expressed as a maximum total replica count (not free slots).
- Unknown/stale/repeated samples, health failure, rebalance, active recovery and
  unverified replica identity/replay safety block scaling. No CPU-only decision.
- Scope is project + service + group. Changed configuration fails closed.
- Cooldown, sample-gap reset and pending-result latch prevent repeated requests.
- Decision audit contains signal/value, previous/desired replicas, reason and
  `DECISION_ONLY` result. No actual scale success is inferred.

Run from Pipeline root:

```powershell
node --test tools/autoscaler/policy.test.mjs
```

The snapshot flags are evidence requirements, **not user/Agent authorization toggles**.
Caller must verify coherent freshness for metrics, group members, capacity, identity
and recovery status. Current observer covers only the runtime subset below; there is
no persistent action reconciliation yet. A proposed scale sets `pending`
and must not be cleared blindly in production.

## Findings before actuator implementation

1. `infra/compose.handoff-pipeline.yml` assigns a fixed
   `CANONICAL_NORMALIZER_INSTANCE_ID=handoff-canonical-normalizer`. Worker runtime uses
   `${clientId}-${instanceId}` as Kafka transactional ID. Blindly scaling this Compose
   service would let concurrent replicas fence each other's producers. New opt-in
   `CANONICAL_NORMALIZER_INSTANCE_ID_MODE=container` appends the default Docker hostname
   to the base ID. Restart of the same container preserves it; recreation changes it.
   Sandbox verifies distinct actual IDs. Production/default Compose remains unchanged.
2. The handoff topic initializer creates **one partition**. A single raw-topic partition
   does not gain consumer-group parallelism by adding replicas. Do not repartition live
   data as an automatic optimization; test multi-partition semantics in an isolated setup.
3. Current Watchdog discovery is singleton-only and safely refuses ambiguous replicas.
   Multi-replica recovery needs coordinated target identity/budgets and must not race with
   scale-down. No claim of combined auto-healing/autoscaling yet.

## Replica sandbox usage

### Read-only runtime observer

```powershell
node tools/autoscaler/observe.mjs <compose-project>
```

Optional next arguments are exact consumer group and raw topic. `WATCHDOG_DOCKER_EXE`
can select the Docker Desktop executable. Host Node reads scoped Docker labels/state
and executes fixed Node probes in the target worker, without printing env/credentials.
There is no HTTP endpoint or Docker access from the Agent/UI. No restart/scale calls.

Report includes exact decimal-string lag, partitions, replica/member counts, readiness
and local transactional-identity uniqueness. Topic/group must match worker runtime.
Docker topology/start times are rechecked after probing; group member/assignment
fingerprints are compared before/after Kafka offsets. Changed topology, rebalancing,
missing commits (-1), retention gaps or malformed offsets must not imply zero lag.
This brackets observations but is not an atomic snapshot of Docker and Kafka.

Timestamp is observation start, with elapsed time returned; consumers must enforce
freshness. Inspection is bounded to 32 replicas and 25 seconds per subprocess.
The Kafka probe also exits inside the container after 20 seconds, so a timed-out
host `docker exec` cannot leave that probe running indefinitely. Coordinator lookup
allows two bounded retries (100 ms initial, 1 second retry-delay cap); zero retries
prevented cold KafkaJS broker metadata discovery in the isolated runtime check.
Unknown/error data has a fixed sanitized reason; CLI returns exit code 2 when no usable
offset observation is obtained. A report is not permission to execute scaling.

Capacity remains `null`, replay/drain attestations remain false, recovery coordination
remains unknown. Those gates are not inferred from a healthy worker or a historical
sandbox result. Identity verification means locally observed container mode + distinct
transactional IDs, not proof against every external producer on the broker.

### Explicit scale test

Build workers locally from current source; do not use published `2fb6b91` workers for
this test because that image does not include the opt-in identity implementation.

```powershell
docker build -f infra/docker/pipeline-workers.Dockerfile -t funnelmetry/scale-workers:20261011 .
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -SkipBuild -WithPipeline -WithAnalytics -WithScale -ApiImage ghcr.io/3002tad/funnelmetry/handoff-api:sha-2fb6b91f73f7abe9036d527cbb78217062e96d1e -WebImage ghcr.io/3002tad/funnelmetry/handoff-web:sha-2fb6b91f73f7abe9036d527cbb78217062e96d1e -WorkersImage funnelmetry/scale-workers:20261011
```

The runner provisions DB/Kafka under a new randomized project, verifies synthetic test
accounts, expands only that raw topic to two partitions and scales only the normalizer.
Other topics/workers are not scaled. Four duplicate identities plus a new page view are
explicitly assigned across two raw partitions for this fixture. This is not a production
partition-key recommendation or certification of all cross-partition source ordering.
Membership checks require Stable group state with complete/non-overlapping assignments.
Scale-down checks removed-container exit code via Docker events, then repeats events
with one consumer and rechecks committed offsets and unchanged order value.
`-WithScale` and `-WithWatchdog` are intentionally separate runs until controllers can
coordinate; neither switches on autoscaling/healing in the actual demo.

## Remaining integration

Evidence 2026-10-11, sandbox `funnelmetry-handoff-test-6e0b04077e57`:

- Local worker image `funnelmetry/scale-workers:20261011`, image ID
  `sha256:20f3631629722e005f6bd42ad0065295d1ef52788ffe35369099199927daa613`;
  built from uncommitted workspace changes, not a published release.
- Actual distinct transactional instance IDs, Stable group with two members, both
  partitions assigned exactly once: PASS.
- Explicit Compose 2→1, removed replica exit 0 (not forced kill), survivor assigned
  both partitions: PASS.
- Duplicate replay at two replicas and again at one replica: five canonical events,
  no duplicate identities, one Journey, one EUR 20 placed-order fact, raw committed
  offsets caught up on both partitions: PASS.
- Unit suite covering normalizer/health/Watchdog/autoscaler policy: 50 PASS.
- Full sandbox stop/start after scaling: persisted five events, one EUR 20 order
  summary through HTTP/evidence and both raw partition offsets caught up: PASS.

Earlier run stopped on a PowerShell quoting bug in Docker event formatting; direct
read confirmed exit 0, then the full test was rerun with corrected formatting.
This is small-fixture functional evidence, not a throughput benchmark or in-flight
scale-down proof. Test scale-down occurs after the two-replica backlog is drained.

Observer integration evidence 2026-10-11, sandbox
`funnelmetry-handoff-test-ddc3c8d51257` (same local worker image above):

- Read-only Docker/Kafka observation: two replicas, two partitions, lag `0`, Stable
  group, distinct transactional identities and ready workers: PASS.
- Capacity/replay/drain/recovery authorization was not inferred from that observation.
- Full explicit 1→2→1 cycle, duplicate replay, graceful exit 0 and stack stop/start
  preserved five canonical identities and one EUR 20 placed-order summary: PASS.
- Targeted normalizer/shared-health/Watchdog/autoscaler suite: 57 tests PASS.
- Initial observer runs failed closed at Kafka coordinator description with retries
  disabled. Bounded retry restored observation; no scale authorization was bypassed.

Still required:

- Further sustained-load/in-flight scale-down and container-recreation transactional
  timeout/fencing tests beyond the small sandbox fixture.
- Trusted observation collector and durable single-writer action journal; revalidate
  current project/replicas, capacity and health immediately before Docker action.
- Restricted host-side Compose actuator, coordinated with Watchdog, with graceful
  scale-down and explicit pending/uncertain-action reconciliation.
- Connect lag policy to a durable actuator only after benchmarked capacity/timing and
  lifecycle reconciliation. The sandbox uses explicit scale commands, not policy-triggered scaling.

No stateful infrastructure scaling, no Source changes, no multi-host HA or Swarm.
