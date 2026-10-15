# Swarm Autoscaler and Level-2 Recovery Controller

DEC-129/130 host-side **canonical-normalizer vertical slice**. This is separate from
the legacy Compose autoscaler observer and Compose watchdog. The same persisted
single-writer controller coordinates both decisions so it never scales while
recovery is active. It runs only on a Swarm manager under an operator account;
API, Agent, browser and worker containers receive no Docker socket.

## Scope and safety

- Read-only by default. `--apply` is an explicit operator choice; no background
  task, service or scheduler is installed automatically.
- Exact stack namespace, service name, pinned worker image digest and replicated
  mode are rechecked before each Docker action. Only `canonical-normalizer` is
  currently actuated. No stateful service or Source Connector is eligible.
- Autoscale policy uses coherent Kafka offsets/group assignments, worker identity,
  readiness, single-node reservation capacity with configured CPU/RAM headroom,
  cooldown/window/hysteresis and partition ceiling. Effective topic partition count
  is read from Kafka, never inferred from a YAML variable. Multi-node capacity is
  deliberately unknown/blocked until a placement-aware collector is reviewed.
- The optional RAM signal samples each task with Docker stats and uses the highest
  memory percentage. With the example 80% up / 60% down hysteresis, high RAM may
  supplement an existing, nonzero consumable backlog; RAM alone never scales an
  idle worker. Scale-down requires a valid RAM sample below the down threshold.
  A missing probe fails closed for scale-down. These are experimental thresholds,
  not a promise that replica growth fixes leaks, cache pressure, or OOM.
- The continuous live workers reserve 256 MiB and are capped at 516 MiB per task
  in `infra/swarm-workers.yml`; the one-shot profile publisher keeps its own
  resource settings. A reservation is placement capacity, while a limit is a
  hard ceiling. Neither number enables a background autoscaler by itself.
- Scale-down additionally requires zero verified consumable Kafka lag at every
  accepted sample in its decision window. The observer reports the raw offset
  delta separately; it excludes only a complete, ordered `read_committed`
  control-record tail confirmed against the same partition's high watermark.
  Missing, partial, unsupported or inconsistent tail evidence retains raw lag.
  The action audit includes both `observedValue` (conservative consumable lag)
  and `rawOffsetLag`, plus the count of verified control-only partitions.
  Release-specific graceful-shutdown attestation alone does not prove the live
  group is drained; nonzero verified lag holds even below the down threshold.
  This does not replace a live in-flight/transaction drain check or disposable
  Swarm 1-to-N-to-1 acceptance.
- Release-specific replay/drain evidence is required as `evidence` with the exact
  image digest and reviewed test references. Without it, autoscaling holds. This is
  an operator-owned attestation, not independent runtime proof; do not populate it
  from an unreviewed test or reuse it after changing the image/contract.
- Recovery only considers a running single task with live `/healthz`, repeatedly
  failed `/readyz`, and a successful Kafka admin probe. Failed liveness, task loss,
  service update and dependency outage are left to Swarm or escalation. A Level-2
  action is `docker service update --force`, never `docker restart` on a Swarm task.
  Its acceptance is not called HEALTHY until a later observation. When more than
  one replica is healthy, Level-2 reports an out-of-scope hold; that is not an
  active recovery attempt and does not itself block safe scale-down.
- `infra/swarm-workers.yml` declares liveness-only `/healthz` checks for the seven
  continuous workers that implement the shared health server. `/readyz` is
  intentionally not a Swarm healthcheck because Kafka rebalance and dependency
  degradation must not cause a task-replacement loop. The normalizer check was
  deployed and fault-tested on the 2026-10-13 live stack; checks for the other
  six workers were deployed and observed healthy on the 2026-10-14 local live
  stack, but have not each had a fault-injection acceptance test.
  This does not expand the Level-2/autoscale allowlist beyond the normalizer.
- State, cooldown, circuit and a bounded sanitized audit are persisted with a lock
  and an action-intent latch. An uncertain Docker result stops the controller and
  requires operator review; do not delete state or lock files to bypass it.
- Code-level allowlisting does **not** reduce the host operator's Docker-manager
  privilege. A dedicated OS identity / constrained Docker authorization boundary is
  still needed before unattended production enablement. Docker's default daemon
  authorization is all-or-nothing; a Docker-group membership, socket mount,
  client certificate, or code-level allowlist alone is not a restricted actuator.
  The current local engine reported no authorization plugin in the
  [sustained in-flight fixture](../../docs/SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).
  Exact thresholds are
  EXPERIMENTAL and belong in a reviewed config, not an architectural SLA.

## Operator use

### Docker Desktop Windows live actuator boundary

The current live manager uses Docker context `desktop-linux` over
`npipe:////./pipe/dockerDesktopLinuxEngine` (Linux Engine 29.8.1). Docker
reports zero authorization plugins. The normal Windows user that launched
Docker Desktop can issue unrestricted daemon commands through this pipe;
running the controller under that same identity is not least-privilege.

The implementation candidate (still requiring team security review and live
acceptance) is a small allowlisted broker on the manager. Only that broker may reach the Docker
socket; the controller uses
an isolated private channel with no published port and no Docker socket or
named pipe. The broker must independently re-inspect the exact stack,
service ID, immutable image, version and replica bounds before accepting a
single scale action. It must reject arbitrary Docker API paths and reject
updates of any other service, exec, container creation, secret/volume access,
and stack removal. Audit both accepted and denied actions. Its own Docker
socket access remains privileged and requires a separate threat review.

The candidate is implemented in `broker.mjs`, `broker-client.mjs` and
`broker-runner.mjs`; `infra/swarm-scale-controller.yml` defines a **separate**
private overlay stack. Both services default to zero replicas. The broker is
the sole service with `/var/run/docker.sock`; the controller image has no Docker
CLI and no socket mount. Requests use a dedicated Swarm secret, bounded RPC,
single-flight execution and sanitized accepted/denied logs. Only one-step
normalizer scale is exposed. Level-2 recovery is explicitly disabled in this
mode and continues to require its own authorization review. The broker's
socket mount is still manager-equivalent privilege if the broker is compromised;
an internal network and token do not change that fact.
The local-live risk boundary and negative container smoke are recorded in
[the broker risk review](../../docs/SWARM_SCALE_BROKER_RISK_2026-10-15.md).

Build the two images from their Dockerfiles, publish immutable digests to the
approved registry, and set `SWARM_SCALE_BROKER_IMAGE` and
`SWARM_SCALE_CONTROLLER_IMAGE`. The candidate manifest reads an operator-owned
controller config from ignored `runtime/swarm-controllers/config.json`, a new
independent token from ignored `runtime/credentials/swarm-scale-broker-token`,
and persisted state from the named `scale_controller_state` volume. Do not reuse
Medusa, Qwen, database, JWT or ingress keys for this token. Do not set
`SWARM_SCALE_*_REPLICAS=1` or `SWARM_CONTROLLER_APPLY=reviewed-live-autoscale`
until the security review, exact-image replay/drain, audited state migration
and negative access tests below are completed. A freshly empty volume is not
an acceptable replacement for a prior controller state; the runner refuses to
initialize it silently. On the 2026-10-15 local live demo, the broker and
controller are both deployed 1/1 with pinned images. This is **not** a
production security or automatic scale-trigger acceptance.

Do not substitute a generic Docker socket proxy or a CLI-side allowlist:
either would leave the controller with broad daemon authority. Before live
enablement, run negative authorization tests from the controller identity,
then perform exact-image drain/replay acceptance, review state migration, and
finally a bounded automatic live 1-to-2-to-1 test. The local-demo preflight
checks the actual broker/controller service specs, private overlay, token
mount, immutable images, controller socket absence and a separate operator
risk attestation. It cannot certify the broker's privileged socket or replace
an independent production security review. The mount check fails closed if
the controller has anything beyond its single state volume (including a broad
host bind such as `/var/run`); the broker is restricted to known Docker
Desktop/Linux socket source paths. This is a configuration check, not a sandbox
against a compromised broker image.

For a bounded, read-only live baseline without touching the persisted
controller state, use `measure.mjs`. If the local controller config still pins
an older image, pass the **exact current service digest** explicitly. This
override is valid only for observation; it drops any old release attestation
in memory and reports `configuredImageMatchesRuntime=false`. It never calls
the Swarm actuator or changes the config/state files.

To check live enablement gates without modifying the service or persisted
controller state, run `live-preflight.mjs` against the ignored local config and
state **before enabling the controller**. It reports only bounded diagnostic
fields and exits nonzero while any gate is unverified. An optional ignored
`local-demo-attestation.json` enables the narrow local-demo gate only after
the operator accepts the residual broker-socket risk and negative boundary
smoke has been performed. Copy
`tools/swarm-controllers/local-demo-attestation.example.json` into the ignored
runtime path and fill the actual stack and immutable digests only after those
checks; its default `riskAccepted=false` deliberately fails closed. Without
that file, the actuator gate stays closed.
Do not interpret `applyAuthorized=true` as production approval. Once the
container controller is running, inspect its mounted state/logs instead of
the stale host-side state copy.

```powershell
node tools/swarm-controllers/live-preflight.mjs runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/live-preflight.mjs runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json runtime/swarm-controllers/local-demo-attestation.json
```

When an already-deployed normalizer changes immutable image, do not simply
reset controller state. The one-time `migrate-image.mjs` command checks the
old state's config fingerprint, absence of pending actions/session, the new
digest against the actual Swarm service, and writes an audit record. It keeps
the previous audit/circuit/cooldown, but resets old-image observation samples.
The reviewed new config must be edited first; the command requires the exact
**old** digest as its last argument. It never adds release evidence or starts
the controller. `generate-broker-token.mjs` creates a separate ignored token
once without printing or replacing it.

```powershell
node tools/swarm-controllers/migrate-image.mjs runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:<old-digest>
node tools/swarm-controllers/generate-broker-token.mjs
```

After reviewing exact-image replay and manual drain evidence, add the two
references and image digest to the ignored config, then migrate the **existing**
state with `attest-release.mjs`. It rejects changed policy, active runner,
pending action, nonzero consumable lag, unready identity or wrong image, and
preserves audit/cooldown while resetting prior observations. The 2026-10-15
local demo used `live-replay-20261015` and `live-drain-20261015` from
[the validation record](../../docs/SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).

```powershell
node tools/swarm-controllers/attest-release.mjs runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
```

The local demo state was copied byte-for-byte into the named controller volume
and its SHA-256 was checked before the controller was enabled. Swarm retains
the desired 1/1 service across an ordinary Docker Desktop restart. If the
control stack is removed, do not initialize a fresh state volume or silently
reuse an old attestation; inspect the preserved volume, live worker digest,
config fingerprint and pending-action latch first. Automatic live 1-to-2-to-1
has **not** yet been demonstrated because current real traffic has not kept
the 100-record lag threshold above the 60-second up-window.

For a bounded live trigger test, use the existing Source Ingress bot in
`behavior` mode on the Medusa side, with that side's dedicated Source Ingress
URL, Source Key ID and Browser Write Key supplied through its private
environment. Do not use the Pipeline's Event Feed token as a write key, do
not pass credentials on the command line, and do not use
`fixtures/kafka-scale-smoke.mjs` against a live Kafka topic. Start with at most
150 journeys (300 synthetic-labeled behavior events), inspect acceptance and
Kafka/controller logs, and stop if the Source Ingress rejects/rate-limits or
quality counters rise. This initial batch may drain too fast to cross the
60-second up-window; do not report automatic scaling unless the controller
audit and Swarm replicas actually show 1-to-2-to-1.

For the local-machine option, fill the five `FUNNELMETRY_*`/`SWARM_LIVE_LOAD_ACK`
entries in the **ignored** `runtime/deploy.env`. The Source Ingress URL must
be HTTPS, `FUNNELMETRY_SOURCE_ID` must be `medusa-reference`, and the Browser
Write Key must be the source-side write credential, not the Pipeline's
`SWARM_FEED_URL`/token. The wrapper checks `/readyz` and requires its
`event_feed_id` to match the configured `SWARM_FEED_ID` before any write.
`check` sends zero events; `run` is behavior-only and capped at 150 journeys
(at most 300 synthetic events), with no commerce orders. Run one journey first
to verify acceptance, then the bounded batch. Do not paste the key into a
terminal command, chat or Git.

```powershell
node runtime/live-autoscale-load.mjs check
node runtime/live-autoscale-load.mjs run --journeys=1
node runtime/live-autoscale-load.mjs run --journeys=150
```

Do not replace the pinned digest, add release evidence, or reset the old state
merely to clear a preflight blocker. Review the exact-image replay/drain
evidence and migrate the controller state with an audit trail first. A live
scale-up test also needs sustained real backlog; an idle probe cannot force a
valid policy decision.

```powershell
node tools/swarm-controllers/measure.mjs runtime/swarm-controllers/config.json --image=ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:<current-digest> --samples=3 --interval-ms=5000
```

Idle samples are not a throughput benchmark or approval for `--apply`.
Measure representative backlog, processing rate, errors and recovery under a
separate synthetic fixture before reviewing experimental thresholds.

Create `runtime/swarm-controllers/config.json` from the example, set an exact
`stack` and immutable image digest, and keep state in this ignored, operator-only
directory. Do not include tokens or private keys. A changed config fingerprint
fails closed; migrate/review state rather than reinitializing to clear a circuit.

```powershell
node tools/swarm-controllers/controller.mjs init runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/controller.mjs once runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/controller.mjs status runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/controller.mjs metrics runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/controller.mjs run runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json --interval-ms=30000
```

`status` reads persisted controller state only: `liveProbe=false` and an old
observation is `STALE`, never a live health assertion. It can expose an uncertain
pending action for operator review without changing the latch. It requires an
initialized state file and does not replace `once` or Docker/Kafka inspection.

After reviewing release evidence and a disposable fault-injection run, `once` or
`run` can receive `--apply`. Do not start a second runner or manually update/scale
the same service concurrently. The runner holds a session directory; after an
unclean stop, inspect the process/action state before manually releasing the stale
session directory. State/audit is local evidence, not a durable incident archive or
an HA controller. `metrics` is Prometheus text, not yet wired into Prometheus.

An isolated adapter fixture exercises 1-to-2-to-1 controller decisions, including
holding while tasks/group have not converged and while backlog is nonzero. This
is a deterministic code test, **not** a Docker/Kafka acceptance result.
The separate [2026-10-14 disposable Swarm fixture validation](../../docs/SWARM_AUTOSCALE_FIXTURE_VALIDATION_2026-10-14.md)
records an actual single-node synthetic Raw→canonical 1-to-2-to-1 run. Its
release evidence and thresholds apply only to that isolated stack/image.
The [current-image rerun](../../docs/SWARM_AUTOSCALE_CURRENT_IMAGE_VALIDATION_2026-10-14.md)
confirms manual 1-to-2-to-1 with the newer Worker digest, but it is not a
live `--apply` or in-flight drain acceptance. A separate read-only Fetch probe
confirmed the then-current live Raw group's two-offset tail was two control
records. The controller now verifies each tail before discounting it, never
subtracts a presumed fixed marker count, and retains the zero-backlog guard.
The updated controller probe still needs a live read-only acceptance run before
any live actuator authorization.

For the historical 2026-10-13 local live stack, Raw had **one partition**, the
normalizer used explicit rather than per-container transactional identity, and no
current-image replay/drain attestation was configured. Autoscale correctly held at
one replica. Read-only controller observations showed worker live/ready and no Level-2
action. The new liveness check was deployed: a stopped worker child produced three
failed probes, Swarm replaced the unhealthy task, and the replacement became ready.
An independent SIGKILL also caused task replacement. This verifies Swarm Level 1,
**not** a policy-triggered Level-2 `--apply` action. Live `--apply` was not run; its
authorization was blocked separately from the approved fault injection. Neither
live scale 1→N→1 nor live Level-2 recovery is accepted yet. The later local
two-partition live stack and isolated current-image tests are documented in
[the 2026-10-14 follow-up](../../docs/SWARM_AUTOSCALE_AND_HEALTH_VALIDATION_2026-10-14.md).
