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
  still needed before unattended production enablement. Exact thresholds are
  EXPERIMENTAL and belong in a reviewed config, not an architectural SLA.

## Operator use

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
