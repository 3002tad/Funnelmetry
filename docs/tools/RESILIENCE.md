# Resilience tools: autoscaler and watchdog

> Hai công cụ bên dưới là bằng chứng **legacy Compose**. Đường Swarm mới là [host-side Swarm controller](../../tools/swarm-controllers/README.md), hiện chỉ có vertical slice `canonical-normalizer` và live read-only observation; chưa bật tác động tự động trên stack live. Không cấp Docker control cho Dashboard/AI.

## Mục lục

- [Autoscaler](#autoscaler)
- [Resilience watchdog](#resilience-watchdog)


---

<a id="autoscaler"></a>

## Autoscaler

> Nguồn gốc trước khi gộp: `docs/tools/autoscaler/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# Single-host autoscaler — decision policy (2026-10-11)

> The `compose.handoff-pipeline.yml` findings below describe an older sandbox and are not deployment instructions. Swarm is the deployment baseline; see [Swarm migration](../SWARM_MIGRATION.md) and [feature status](../FEATURE_STATUS.md). The actuator is not automatically enabled.

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

## Historical findings before actuator implementation

The transactional-ID finding below describes the older per-instance runtime.
The current Swarm Normalizer candidate uses a stable ID derived from consumer
group and Raw partition and bounded Kafka transactions; see
[the 2026-10-14 validation](../SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).
The legacy Compose guidance is not the Swarm rollout path.

1. The retired Compose deployment assigned a fixed
   `CANONICAL_NORMALIZER_INSTANCE_ID=handoff-canonical-normalizer` by default. Worker runtime uses
   `${clientId}-${instanceId}` as Kafka transactional ID. Blindly scaling this Compose
   service would let concurrent replicas fence each other's producers. New opt-in
   `CANONICAL_NORMALIZER_INSTANCE_ID_MODE=container` appends the default Docker hostname
   to the base ID. Restart of the same container preserves it; recreation changes it.
   Sandbox verified distinct actual IDs. This historical guidance is not a
   Swarm Normalizer configuration; use the current Swarm preflight instead.
2. The unified topic initializer creates **one Raw partition by default**. For a new
   isolated Swarm stack, `SWARM_RAW_PARTITIONS=2` provisions two Raw partitions. It
   verifies the existing topic's partition count and fails on mismatch; it never
   automatically repartitions an existing topic. A single Raw partition does not gain
   consumer-group parallelism by adding replicas. Changing partition count on a live
   project requires a reviewed migration and replay plan.
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

The unified Compose now has an opt-in multi-partition/unique-identity prerequisite,
but it does **not** start an autoscaling controller. The observer still reports host
capacity, replay/drain attestation and recovery coordination as unknown. Do not
interpret a two-partition fresh install as permission to scale automatically. The
isolated fixture below is the only replica-scale acceptance evidence to date.

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


---

<a id="resilience-watchdog"></a>

## Resilience watchdog

> Nguồn gốc trước khi gộp: `docs/tools/resilience-watchdog/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# Resilience Watchdog — host-side opt-in controller

> **Lưu ý:** launcher `runtime/start-recovery-demo.ps1` của demo cũ đã bỏ. Watchdog vẫn là công cụ host-side opt-in, chưa tự tích hợp vào Compose thống nhất; không chạy ví dụ cũ trên project live.

Implementation evidence, 2026-10-10. Authority: Master §24.3, Core Implementation
Contracts §7–8 and DEC-111. Published `2fb6b91` handoff images remain unchanged.
**Opt-in demo runner available; not installed as a background service.** No Docker socket in UI/API/AI,
Compose change, database migration, cursor reset or source contract change.

## Scope and safety

- `policy.mjs`: explicit project + service allowlist, startup grace, consecutive failures,
  cooldown, windowed attempt budget and latched circuit breaker. Timings in
  `config.example.json` are EXPERIMENTAL illustrations, not SLA/approved defaults.
- `controller.mjs`: host-side single-cycle CLI using Docker CLI without a shell.
  Observe-only by default; `--apply` explicitly enables restart. The operator account
  already has Docker privileges; code restrictions are not an OS-level privilege sandbox.
- Only six allowlisted Kafka workers, singleton discovery. Ambiguous replicas, stopped,
  paused, restarting or one-off containers cannot be restarted. No postgres/Kafka/Qdrant,
  Source Connector, UI/API or automatic scaling.
- Probes execute fixed Node code inside the selected container against localhost only.
  `/healthz` and `/readyz` are distinct; dependency readiness cannot trigger restart.
  Local HTTP timeout/refused connection with successful Docker exec counts as liveness
  failure; Docker exec/daemon/invalid response errors remain unknown. Health port must
  be operator-verified: a wrongly configured closed port can look like failed liveness.
- Immediately rechecks ID/project/service/running/start time before restart. An operator
  stop racing *after* the last inspect cannot be atomically fenced by Docker restart;
  stop scheduling this controller before manual container maintenance.
- Lock directory prevents overlapping cycles. No stale-lock takeover. State and audit
  intent are written using fsync + atomic rename **before** actuator invocation.
  POSIX directory metadata is fsynced; Windows power-loss durability is not certified.
- Uncertain command/write result leaves `pending` latched across reload, never auto-retry.
  Corrupt/missing state or changed configuration stops execution; `init` cannot overwrite.
- Last 200 sanitized audit events are in state JSON. This is bounded local history,
  not a durable long-term incident archive. Metrics command emits read-only Prometheus
  text; no scrape endpoint/Grafana wiring or automatic reset is provided.

## Manual sandbox usage (Node 22+, Docker Linux containers)

Use a dedicated sandbox per DEC-125. Copy example into ignored
`runtime/watchdog/config.json`, choose the exact project/service and verify the private
worker health listener port. Review timing and graceful shutdown budget first.
Keep state/config in an operator-only directory outside frontend/API control.
Do not copy recovery state between projects or delete it to bypass a circuit breaker.

```powershell
node tools/resilience-watchdog/controller.mjs init runtime/watchdog/config.json runtime/watchdog/state.json
node tools/resilience-watchdog/controller.mjs once runtime/watchdog/config.json runtime/watchdog/state.json
# Only after validating observed target and liveness configuration:
node tools/resilience-watchdog/controller.mjs once runtime/watchdog/config.json runtime/watchdog/state.json --apply
node tools/resilience-watchdog/controller.mjs metrics runtime/watchdog/config.json runtime/watchdog/state.json
```

`WATCHDOG_DOCKER_EXE` may point to Docker Desktop's executable if not on PATH.
No OS daemon/task scheduler is installed; each `once` is a single observation cycle.
Subsequent cycles verify recovery; Docker accepting restart is not yet HEALTHY.
Observe-only advances observation history but does not consume restart attempts.

If blocked by lock/pending/circuit: stop all scheduled/manual cycles, preserve state,
inspect the exact container and latest audit, then have the operator review recovery.
No reset command is intentionally supplied yet. Do not delete state or automatically
reinitialize to continue. Changed configuration also requires reviewed migration.

## Tests and evidence

### Persistent foreground demo runner (2026-10-11)

From the Pipeline root, run `powershell -NoProfile -ExecutionPolicy Bypass -File runtime/start-recovery-demo.ps1`. It starts the existing
`funnelmetry-demo-new` demo through its standard launcher, then runs the host Watchdog
until Ctrl+C. Keep that window open. The demo UI remains at http://localhost:5180.
This is **normalizer recovery**, not an automatic replica-scaling demo or live Medusa
ingestion. No build, image publication, source/model call or data reset is performed.

`demo.config.json` scopes the runner to the existing normalizer health port 32110.
Three failed liveness samples, 60-second startup grace, 120-second cooldown and two
attempts per 15 minutes are EXPERIMENTAL demo configuration, not measured SLAs.
The restart timeout matches the worker's 45-second Compose shutdown budget.
`runtime/start-recovery-demo.ps1 -ObserveOnly` disables restarts; `-IntervalMs` sets
the delay after each completed cycle (default 10000). Cycles never overlap.

First use explicitly initializes missing `runtime/watchdog/demo-state.json`; later
runs reuse state. Existing corrupt/mismatched/pending state is never overwritten.
A session lease prevents duplicate runners for that state file. Apply startup requires
a successful matching liveness response, preventing an incorrect health port from
immediately driving restarts. This startup check cannot recover an already hung worker;
inspect/restore that worker before starting the foreground demo runner.

Ctrl+C requests shutdown after the current bounded cycle; containers keep running.
Then use `runtime/new-demo.ps1 -Action stop` to stop the demo. The normal demo script refuses
start/stop while the known recovery session lease exists. Forced process termination
may leave a stale lease; preserve state and verify that no runner is alive before
operator review. Do not run another controller against a different state file or
manually scale/restart containers during this demo. Cross-controller autoscaler
coordination is not implemented yet.

Unit coverage includes serial scheduling, cancellation, startup verification, duplicate
runner exclusion, uncertain-cycle stop and open-circuit stop. The foreground runner
stops on state/command uncertainty instead of continuously retrying a failed actuator.

Runtime evidence 2026-10-11: resumed the existing demo with its standard launcher
(UI HTTP 200, anonymous API denied). Four scheduled apply-mode observations on the
actual normalizer respected startup grace and reached `LIVE_AND_READY` / `HEALTHY`.
Scheduler cancellation released its session lease and preserved state; demo containers
remain running. No fault was injected and no restart was needed in this deployment
check. Automatic restart evidence is the isolated real-worker acceptance below,
not these healthy observations. Combined targeted suite: 61 PASS.

```powershell
node --test tools/resilience-watchdog/policy.test.mjs tools/resilience-watchdog/controller.test.mjs workers/shared/health-server.test.mjs
node tools/resilience-watchdog/docker-smoke.mjs <local-node-worker-image> --run-isolated
```

Docker smoke on 2026-10-10: `watchdog-smoke-c9371d62`, Node fixture using local workers
image ID `sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650`.
Network none, no host ports/volumes/secrets, read-only root, tmpfs fault markers.
PASS dependency readiness failure without restart; local liveness timeout with actual
Docker restart and healthy follow-up; persisted budget and circuit on repeated fault.
Container and temporary state were removed afterward; actual demo was untouched.
Initial fixture assertion was corrected: Docker clears tmpfs markers on restart, so
recovered status is HEALTHY rather than dependency-degraded.

Unit tests additionally cover observe-only, persisted-before-action, disk write failure,
changed target, uncertainty across reload, lock contention, corrupt/config-mismatched
state and read-only metrics. Local JSON roundtrip is not a host power-loss test.

## Real worker recovery acceptance — 2026-10-11

Use the existing isolated handoff runner with `-WithWatchdog -WithPipeline -WithAnalytics`.
`compose.test.yml` enables only the private normalizer health port and `init: true`
inside the disposable project. No deployed worker code change or live configuration
is needed. Pin the three handoff image arguments; `-SkipBuild` uses existing images.

```powershell
powershell -NoProfile -File tools/v2-e2e/run-handoff.ps1 -SkipBuild -WithPipeline -WithAnalytics -WithWatchdog -ApiImage ghcr.io/3002tad/funnelmetry/handoff-api:sha-2fb6b91f73f7abe9036d527cbb78217062e96d1e -WebImage ghcr.io/3002tad/funnelmetry/handoff-web:sha-2fb6b91f73f7abe9036d527cbb78217062e96d1e -WorkersImage ghcr.io/3002tad/funnelmetry/handoff-workers:sha-2fb6b91f73f7abe9036d527cbb78217062e96d1e
```

Project `funnelmetry-handoff-test-6d1c2e01d0da`: actual canonical-normalizer + Kafka +
PostgreSQL and downstream workers. Four initial synthetic events reached one converted
Journey/order fact. The test sends SIGSTOP to the worker child (not Docker pause),
verifies failed liveness, enqueues the same four event identities plus one new page-view,
then executes host-side Watchdog cycles with one reserved restart.

Recovery/catch-up result PASS: **26,989 ms** from first recovery observation to checked
outcome, one restart; exactly five canonical rows, the new identity exactly once, no
duplicate `(source_id, source_event_id)`, one Journey, one placed-order fact EUR 20.
Normalizer's committed raw partition offsets equal broker end offsets. This elapsed time
is a single synthetic run, not a production SLA or a benchmark under load.

The full sandbox stop/start also passed: five canonical events, unchanged EUR 20
placed-order summary through HTTP/evidence, raw consumer caught up and no duplicated
canonical identity. Unit/health suite: 20 PASS. No Qwen/provider or live Source call.

The first attempted fault on PID 1 did not freeze the listener and correctly failed;
test-only init makes worker child stoppable. An interrupted run from 10/10 without
final output is not counted as PASS. Current evidence tests a stopped event loop with
queued backlog, **not** crash at every transaction boundary or data loss on host failure.

## Remaining acceptance before enabling real deployments

- Additional worker failure modes, in-flight transaction crashes and sustained-load
  duplicate-effect/catch-up checks. Normalizer test is not proof for all six workers,
  Source Connector recovery, host loss or complete auto-healing.
- Audited operator reset/config migration, long-term recovery history and monitoring
  integration, verified scheduler lifecycle and operational timing benchmarks.
- Graceful timeout must match worker workload and shutdown behavior. No automatic HA,
  no autoscaling, no live deployment certification from this sandbox test.
