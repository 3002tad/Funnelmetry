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
