# VPS autoscaling enablement

User requested automatic scaling on the real VPS pipeline. Target is only `funnelmetry_vps_live_canonical-normalizer`, min/max 1/2. Existing observation policy remains separate from live controller state.

## Completed checks

- Live preflight: manager, exact image, readiness, group identity, partitions and capacity passed. Initial blockers were missing image-specific replay/drain evidence and unverified restricted actuator.
- Exact worker image: `ghcr.io/3002tad/funnelmetry-cdc-workers@sha256:e8cb858342c339b97ab6bbf67973e13c63f343d8ff751cd7116dbd1cb69f2201`.
- Disposable `scaleaccept20261120` stack: separate Kafka/network, no Source Connector, no published ports. Used the image's `canonical-mappings.v1.json`; the older fixture default v2 path was absent from this image and initially prevented startup.
- Produced 10,000 synthetic records in fixture-only topics; scaled 1→2→1 and forced a worker replacement. Before and after restart, verifier found exactly 10,000 unique canonical IDs and matching outcome IDs, raw offsets committed, zero quarantine. Kafka transaction retries occurred during handoff; the final read-committed identity checks passed. This does not demonstrate a live policy-triggered scale.
- Fixture stack removed after verification. Evidence retained at `/srv/KLTN/Funnelmetry/runtime/autoscale-vps-20261120/fixture.json`.
- 28 targeted controller/broker/preflight tests passed, including a new explicitly named VPS operator attestation scope. No gate was removed; the VPS scope uses the same network, socket, token, immutable-image and stopped-controller checks as the existing local demo scope.
- Built broker/controller locally on the VPS. No external image publication succeeded.

## Deployment and authorization

Automatic approval review rejected GHCR publication; switched to locally stored immutable images. It then rejected persistent broker deployment because the broker owns the manager Docker socket. The user explicitly approved that privilege ("có nhé") after the specific risk explanation. The subsequent deployment was approved and completed.

Deployment scripts: `D:/KLTN/.tooling/stage-live-autoscaler.mjs` and `enable-live-autoscaler.mjs`. Negative tests passed: no socket/CLI in controller image, generic Docker API denied, unauthenticated calls denied, recovery denied, unattested scaling denied, scoped read allowed. Existing state was migrated with exact-image evidence, preserving audit. Final preflight returned no blockers, `applyAuthorized=true`, `authorizationScope=OPERATOR_VPS_SINGLE_NODE`. State copied to the named controller volume with SHA-256 verification before enablement.

Live services: `funnelmetry-vps-scale_swarm-scale-broker` and `funnelmetry-vps-scale_swarm-scale-controller`. Controller setting: `SWARM_CONTROLLER_APPLY=reviewed-live-autoscale`; interval 30 seconds. Policy min/max 1/2, up/down lag 100/5, up/down windows 60/180 seconds, cooldown 300 seconds. Recovery actuator remains disabled. Initial startup retried during broker rollout; subsequent persisted audit records show live ready, consumable lag 0 and HOLD at the minimum replica count.

Broker image: `funnelmetry-scale-broker@sha256:668bf218e2f786933be25d18e6019bf8a60c4c7191f21162966e02c8e7ae8224`.
Controller image: `funnelmetry-scale-controller@sha256:0bcf214f97aea288d9ce344c9568e0c932440e59e31324f44826e4b4c5e3e3e7`.
Images are local to this single VPS, not published externally. Preserve them; restoring onto a new node requires loading/rebuilding the approved images. Swarm persists the desired replica count across host restarts. The staged deployment script is an initialization workflow, not a safe repeat-deploy command; do not rerun it over enabled state.

Emergency stop: `docker service scale funnelmetry-vps-scale_swarm-scale-controller=0`; this stops automation without altering normalizer replicas. Preserve controller volume/state and inspect pending actions before resuming. No policy-triggered live 1→2→1 cycle has been demonstrated at current idle traffic.

Dashboard now reads live controller state through a separate bounded snapshot and read-only host collector. See `LIVE_POLICY_DASHBOARD_2026-11-20.md` for image pins, freshness rules and validation. The completed-observation reader remains compatible for deployments without the live snapshot setting.

The broker remains manager-equivalent if compromised. This boundary limits the controller's API; it is not independent production security certification.
