# Live autoscaling dashboard

The Auto Scaling page now reads the active VPS controller instead of the completed observation bundle.

## Deployment

- Host collector: `/srv/KLTN/policy-dashboard-20261120/collect-controller.mjs`.
- Timer: `funnelmetry-controller-collector.timer`, every 15 seconds after each collection.
- Snapshot: `/var/lib/funnelmetry-observability/funnelmetry_vps_live/controller-live.json`, published atomically through the existing read-only API mount.
- API environment: `DASHBOARD_CONTROLLER_LIVE_SNAPSHOT_PATH=/run/observability/controller-live.json`. Preserve this setting across redeploys. Do not use a variable ending in `_FILE`: the Swarm entrypoint reserves that suffix for approved secret inputs. The first rollout was automatically rolled back for that reason; the corrected rollout completed successfully.
- API image: `funnelmetry-dashboard-api@sha256:696b38c0d48127c01078c600f2b83807f1914cd37028ee58fb5a17ae397745f6`.
- Web image: `funnelmetry-dashboard-web@sha256:c41831d71f370a1b5b3036eb61a89402cc04b9de9f7baea0514c36176c83dd13`.
- Images remain local to the VPS. Controller settings, Docker privileges and normalizer replicas were not changed by this dashboard update.

## Behavior and validation

The API validates policy fingerprint, target scope, runtime image binding, observation times and bounded audit records. It reports ACTIVE, STOPPED, STALE, NEEDS_REVIEW or IMAGE_MISMATCH. Both collection time and decision time must be within 90 seconds for fresh live status. Failed collection leaves the prior snapshot to expire; it cannot perpetually report live health.

The UI polls every 15 seconds, labels live mode separately from completed observations, displays the latest decision timestamp, preserves actual audit outcomes, and distinguishes HOLD from scale-up/down proposals. An accepted Docker update is not relabeled as confirmed convergence.

Five API tests passed, including old observation compatibility, fresh/stale state, stopped controller, pending action, changed image, fingerprint mismatch and action-result preservation. TypeScript/Vite build passed. The deployed API reader returned ACTIVE / AUTO_SCALE / VPS_LIVE_CONTROLLER with a current HOLD decision, one replica and consumable lag 0. Both dashboard services converged. Authenticated browser acceptance was not completed because available saved admin credentials did not authenticate; no account/password was modified.

Subsequent login regression correction: the web build had defaulted to localhost API routing. The failed browser login attempts above were not evidence of bad credentials. See `DASHBOARD_LOGIN_FIX_2026-11-21.md` for the corrected web image and successful real login acceptance. Do not restore the affected web image.

Rollback of live policy API: restore the prior API image recorded on VPS in `previous-images.txt`, remove `DASHBOARD_CONTROLLER_LIVE_SNAPSHOT_PATH`, and stop/disable only `funnelmetry-controller-collector.timer` if reverting the collector. Preserve the login-fixed web build. This does not stop the autoscaler.
