# Swarm scale broker: local-live risk review (2026-10-15)

Scope: one-node Docker Desktop Swarm manager, `funnelmetry-live-20261014`,
`canonical-normalizer` only. This is a demo/live operational review, **not**
independent production security certification.

## Boundary and residual privilege

- The controller image has no Docker CLI or socket mount. A negative container
  smoke confirmed both were absent. It contacts the broker only on an internal
  unpublished Docker network with an independent Swarm-secret token.
- The broker has `/var/run/docker.sock`, so compromise of that process grants
  manager-equivalent Docker control. The read-only root filesystem, dropped
  capabilities, private network and token reduce exposure but **do not**
  reduce the socket's authority. This residual risk was disclosed and the user
  explicitly approved an always-on broker for the local live demo.
- The broker accepts a fixed RPC allowlist. It never passes caller-supplied
  commands to a shell. Before a one-step scale it rechecks stack, service,
  immutable image, version, tasks, worker health/identity, Kafka group/lag,
  partition ceiling, capacity and release evidence. A failed or uncertain
  Docker update remains an operator-review condition. Level-2 force-update is
  not exposed in this mode.
- The request body is bounded; the server accepts one active request and has a
  read timeout. It logs sanitized method/result, never the token or raw event
  payload. The token must be rotated if exposed; network isolation alone is
  not authentication.

## Evidence and go/no-go

Unit/fixture tests cover arbitrary Docker method denial, foreign tasks,
missing token, image mismatch, failed Docker confirmation, and 1→2→1 policy.
An isolated container test using the actual live manager socket confirmed
generic API, no-token, `forceUpdate` and unreviewed-scale denial, while the
allowlisted read succeeded. The temporary broker/network were removed after
the test. No live replica changed.

Remaining before **automatic live apply**: exact-current-image live
in-flight replay/drain acceptance; immutable broker/controller image
publication; persisted state mounted into the controller volume; explicit
acknowledgement in the deployment configuration; and an observed, bounded
automatic 1→2→1 test. Multi-node, production and node-level HA are not
covered by this review. A separate independent security review is still
recommended before production use.
