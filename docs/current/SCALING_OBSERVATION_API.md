# Auto Scaling observation API (local implementation)

## Deployment configuration

See `apps/dashboard-api/monitoring.env.example` for API environment settings.
The file is not loaded automatically: propagate reviewed values into the Swarm
API service. Verify group/topic names for that deployment before enabling Kafka
lag. The existing Kafka probe runs directly over the API's private network;
the existing Source Connector readiness URL also works there without SSH.

For replica/RAM, run the separate collector on the manager and mount only its
output file/directory read-only into the API. Set the snapshot path as seen from
inside the API container and refresh the file within 60 seconds. Do not mount the
Docker socket in the API. Collector scheduling and mount wiring are explicit
operator deployment steps, not performed by pushing this branch.

The local `.tooling` SSH monitors and temporary test evidence are not part of
this release. Production probes use the service configuration described above.

`GET /api/v2/admin/scaling` requires a live session and `pipeline.monitor`.
No query parameters or mutation methods are supported. Responses use `no-store`.
The Admin Auto Scaling page calls this endpoint on entry and when refreshing.

## Data sources

- Readiness uses the existing fixed worker probe (`DASHBOARD_WORKER_HEALTH_ENABLED=true`).
- Raw Kafka lag uses the existing Kafka probe and its configured targets
  (`DASHBOARD_KAFKA_LAG_ENABLED`, `DASHBOARD_KAFKA_LAG_BROKERS`,
  `DASHBOARD_KAFKA_LAG_TARGETS_JSON`). The selected group/topic must match
  `DASHBOARD_SCALING_GROUP_ID` / `DASHBOARD_SCALING_TOPIC`; defaults are
  `funnelmetry-canonical-normalizer-v1` / `funnelmetry.raw.v1`.
- Replica and memory observations come from `DASHBOARD_SCALING_SNAPSHOT_FILE`.
  Set `DASHBOARD_SCALING_STACK` to the expected Swarm stack name. A sample must
  match that stack and service and be at most 60 seconds old.

The HTTP process has no Docker command/socket access. A separate operator-run
collector performs read-only Docker inspection on a Swarm manager:

```sh
node apps/dashboard-api/scripts/collect-scaling.mjs STACK /absolute/path/scaling.json
```

Use `--stdout` instead of an output path for an SSH stdin collector without
writing a remote file. The collector also observes each allowlisted worker's
readiness and the normalizer group's raw Kafka offset lag via bounded,
read-only Kafka admin calls inside the normalizer task. It does not join groups
or resolve/reset/commit offsets. Worker readiness is only projected for an
observed single-replica task; ambiguous/multiple replicas remain unverified.
Snapshot-backed readiness is also available from the existing worker-readiness
endpoint when direct health probing is disabled. Both snapshot and individual
worker timestamps expire after 60 seconds. No controller policy is synthesized.

Run it again to refresh the sample; no scheduler is installed automatically.
For a remote runtime, transfer its resulting JSON to the configured local path
atomically. The API itself never SSHs to a host. Configure the API environment
and restart the local API to load the settings. Do not use fabricated snapshots.
RAM is the highest Docker memory percentage among running service tasks, only
when single-node coverage can be established; otherwise it is null.

## Limits

Raw offset lag is not consumable lag or event count. Desired replicas and running
replicas are separate; neither proves readiness or that autoscaling is enabled.
Set `DASHBOARD_CONTROLLER_OBSERVATION_DIR` to a completed local observation run
directory containing `config.json`, `state.json`, and final `status.json`.
The reader validates the actual controller policy, state fingerprint, scope,
absence of pending actions and exclusively `OBSERVE_ONLY` audit results. It
returns allowlisted policy values, decisions and chronological chart samples;
filesystem paths, image references and arbitrary audit fields are not exposed.
Missing/invalid runs remain unavailable. Historic samples are retained with
`COMPLETED_OBSERVATION` and `stale`, never presented as a background/live
controller. Configured CPU/RAM headroom is a test policy setting, not free host
capacity. The UI separates the latest runtime cards from completed-run charts
and labels every history entry as an observation rather than an applied scale.
An unavailable runtime file does not prevent independent Kafka/readiness results.
No DB migration, VPS deployment, controller activation or scaling is performed.
