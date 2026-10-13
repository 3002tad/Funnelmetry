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
- Release-specific replay/drain evidence is required as `evidence` with the exact
  image digest and reviewed test references. Without it, autoscaling holds. This is
  an operator-owned attestation, not independent runtime proof; do not populate it
  from an unreviewed test or reuse it after changing the image/contract.
- Recovery only considers a running single task with live `/healthz`, repeatedly
  failed `/readyz`, and a successful Kafka admin probe. Failed liveness, task loss,
  service update and dependency outage are left to Swarm or escalation. A Level-2
  action is `docker service update --force`, never `docker restart` on a Swarm task.
  Its acceptance is not called HEALTHY until a later observation.
- `infra/swarm-workers.yml` now declares a liveness-only `/healthz` check for this
  worker. `/readyz` is intentionally not a Swarm healthcheck because Kafka rebalance
  and dependency degradation must not cause a task-replacement loop. Existing
  stacks need a reviewed `deploy-app` for this change; the 2026-10-13 live stack
  received it and passed a controlled healthcheck fault test.
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
node tools/swarm-controllers/controller.mjs metrics runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json
node tools/swarm-controllers/controller.mjs run runtime/swarm-controllers/config.json runtime/swarm-controllers/state.json --interval-ms=30000
```

After reviewing release evidence and a disposable fault-injection run, `once` or
`run` can receive `--apply`. Do not start a second runner or manually update/scale
the same service concurrently. The runner holds a session directory; after an
unclean stop, inspect the process/action state before manually releasing the stale
session directory. State/audit is local evidence, not a durable incident archive or
an HA controller. `metrics` is Prometheus text, not yet wired into Prometheus.

For the current local live stack (2026-10-13), Raw has **one partition**, the
normalizer uses explicit rather than per-container transactional identity, and no
current-image replay/drain attestation is configured. Autoscale correctly holds at
one replica. Read-only controller observations show worker live/ready and no Level-2
action. The new liveness check was deployed: a stopped worker child produced three
failed probes, Swarm replaced the unhealthy task, and the replacement became ready.
An independent SIGKILL also caused task replacement. This verifies Swarm Level 1,
**not** a policy-triggered Level-2 `--apply` action. Live `--apply` was not run; its
authorization was blocked separately from the approved fault injection. Neither
live scale 1→N→1 nor live Level-2 recovery is accepted yet.
