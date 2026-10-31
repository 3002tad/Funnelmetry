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
recommended before production use. The remaining-items list below is the
pre-deployment checkpoint; the dated follow-up records what was completed.

## Local-live deployment and overlay boundary check

After explicit user approval, the separate stack
`funnelmetry-scale-control-20261015` was deployed on the single-node Docker
Desktop Swarm. The broker runs 1/1 from immutable digest
`sha256:06b09a41783fa4bdd7d8662d9aa398a695d2ba7780f508d35f993e25614b5e3f`;
the controller image is pinned to digest
`sha256:a41d268ca8e98d7dd001c1bc78f45569845add41303cf18c1d670a955c2fffe5`
and was initially held at 0/0. The broker has one internal overlay and no
published port.

An ephemeral task using the actual controller image and overlay completed a
negative boundary smoke: its Docker socket and Docker CLI were absent; a
generic API request, unauthenticated request, Level-2 recovery request and
unreviewed scale request were denied; an allowlisted read succeeded. The
ephemeral task was removed. This verifies the tested network/API boundary,
not independent least-privilege enforcement on the broker's Docker socket.
The broker remains manager-equivalent if compromised, and production security
review remains open. The release evidence was added through an audited state
migration (12 audit entries; previous history preserved). The copied volume
state matched the host state SHA-256, and the local-demo preflight reported no
blockers. The controller was then enabled 1/1 with Level-2 recovery disabled.
Its first live log recorded `HOLD` at one replica, zero consumable lag and no
action. No automatic scale action has yet been observed on live.
