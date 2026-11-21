# VPS policy observation connection

Connected the dashboard API to a bounded, completed observation on 2026-11-20. No pre-existing VPS controller policy was found. The policy was created from `tools/swarm-controllers/config.example.json`, scoped to `funnelmetry_vps_live`, and pinned to the actual normalizer image. Thresholds remain experimental; they are not benchmark-approved production settings.

- Host directory: `/var/lib/funnelmetry-observability/funnelmetry_vps_live/policy-observation-20261120`.
- API environment: `DASHBOARD_CONTROLLER_OBSERVATION_DIR=/run/observability/policy-observation-20261120`.
- Existing read-only observability mount used; no Docker access added to the API.
- Controller `init`, `once` (without `--apply`) and `status` produced real config/state/status files. No scheduler or actuator enabled.
- Policy: min/max 1/2, lag up/down 100/5, windows 60/180 seconds, cooldown 300 seconds, RAM 80/60%, CPU/RAM headroom 2 CPU/2 GiB.
- At 16:06:54 UTC: ready, consumable lag 0, raw offset lag 2, RAM 6.95%, HOLD at one replica because `REPLICA_SAFETY_UNVERIFIED`.
- Verified the deployed API reader returns `COMPLETED_OBSERVATION`, non-null policy and two audit entries. The sample becomes stale after 30 seconds; it is a completed observation, not continuous monitoring.

Only the API environment was updated; the image was unchanged and the service converged at 1/1. Preserve the environment setting on future redeploys. Rollback: remove `DASHBOARD_CONTROLLER_OBSERVATION_DIR` from that service. The existing API scope label `LOCAL_OBSERVATION_TEST` means observation-only; these samples were collected on the VPS, not a local simulation.
