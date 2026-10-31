# Primary Medusa reference CDC operations

CDC-14 promotes the six CDC runtime services to stack `funnelmetry_cdc`.
Evidence and preserved physical names are in
[`docs/CDC14_RUNTIME_EXECUTION_2026-10-31.md`](../../docs/CDC14_RUNTIME_EXECUTION_2026-10-31.md).

On the VPS checkout `/srv/KLTN/Funnelmetry-cdc-profile`:

```sh
node runtime/cdc-live.mjs check runtime/cdc-live.env
node runtime/cdc-live.mjs deploy runtime/cdc-live.env
systemctl status funnelmetry-cdc-quality.service
python3 tools/cdc-operations/monitor-quality.py \
  --profile-dir /etc/funnelmetry/cdc/profiles
```

`runtime/cdc-live.env` is ignored and must pin image digests. The deploy
launcher rejects old CDC target services with nonzero desired replicas.
The mapper volume retains its old physical name to preserve durable state.
Do not rename slots, topics, groups or epochs as part of a service rollout.

`backup-runtime.sh` and `verify-backup-restore.sh` capture and rehearse
recovery before a stateful cutover. The `cleanup-cdc14*` scripts use the
dated inventory and are **one-time migration tools**, not recurring jobs.
The old verifier engine under `tools/medusa-reference-cdc-shadow/` remains
a compatibility dependency of `monitor-quality.py`; its fixture Compose
files do not define the live runtime.
