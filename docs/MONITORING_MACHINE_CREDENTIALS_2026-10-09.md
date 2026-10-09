# Metrics-only machine credentials and local monitoring

Implements user-approved separate monitoring credentials under Master §24.3.4 /
DEC-103 and Cookbook security / pipeline-recovery-observability boundaries.

## Security contract

- `GET /api/monitoring/metrics`: opaque Bearer key only, not an Admin JWT.
  Other methods 405; query parameters 400; absent/invalid/expired/revoked keys 401.
- Random 256-bit secret, UUID identifier, SHA-256 hash stored in PostgreSQL.
  Token returned once on issuance; list/audit never contain the token or its hash.
- Fixed `metrics.read` scope. Cannot log in, manage credentials, query analytics,
  use chat, control Docker or access other Admin APIs. Existing Admin metrics
  endpoint keeps its session-based authentication unchanged.
- Every scrape checks DB expiry/revocation and active Admin issuer before and
  after bounded probes. No credential authorization cache. Database failure 503,
  generic error, no partial metrics. Issuer deactivation/demotion denies keys;
  reactivation may re-enable unexpired keys, so explicitly revoke when removing
  access permanently. Session logout is not machine-key revocation.
- Admin issuance/revocation requires live `user.manage` + `pipeline.monitor`,
  then checks current Admin role/session under a row lock in the transaction.
  Issuance/revocation and audit insert commit together; revoke is idempotent.
- TTL is explicitly supplied. Demo policy defaults to a maximum 604800 seconds
  (7 days); configurable through `MONITORING_CREDENTIAL_MAX_TTL_SECONDS`
  (60..31536000). No perpetual credentials or automatic extension.
- Credential listings return the latest 200 records. Audit is retained in
  `monitoring_credential_audit`; no audit-management UI added in this change.

## Migration / compatibility

Explicitly apply `infra/postgres/011_monitoring_credentials.sql` AFTER dashboard
account schema. It creates only `monitoring_credentials` and its audit table in
one transaction. Existing event, cursor and offset state is unchanged.

This optional migration is **not** inserted into the frozen clean-handoff
bootstrap digest. For an existing installation or a fresh handoff, apply it as
an explicit follow-up before provisioning monitoring credentials. Without it,
the new endpoints fail closed with 503; normal existing endpoints keep working.
Do not modify the handoff bootstrap digest manually to bypass compatibility.

Rollback: stop monitoring services, revert API image if needed; leave the additive
tables/audit intact. No down-migration or data deletion is required.

## Local demo runbook

1. Build/deploy the API containing the new routes; apply the migration above.
2. `node runtime/prepare-monitoring.mjs`: logs into the loopback demo using the
   existing ignored demo env, issues a 7-day metrics key, verifies it, generates
   a Grafana password and renders the dashboard with the provisioned datasource
   UID. Admin JWT stays in process memory. Script refuses to overwrite existing
   artifacts; failure attempts to revoke the new key, never prints secrets.
3. Copy `runtime/monitoring.env.example` to ignored `runtime/monitoring.env` and
   obtain the pinned images. Start the demo with `start-new-demo.cmd`; the launcher
   includes `infra/compose.observability.yml` only when this env file exists.
4. Open `http://localhost:5182`, user `monitoring-admin`. Password is in ignored
   `runtime/monitoring/grafana-password`. Open **Pipeline / Funnelmetry — Pipeline
   observations**. Pipeline UI remains at localhost:5180.
5. `node runtime/check-monitoring.mjs`: checks Grafana health, dashboard provision,
   Prometheus scrape UP and six worker observation series, without printing secrets.
6. `stop-new-demo.cmd` stops monitoring too and preserves all named volumes.

Prometheus is internal only, no published host port; Grafana binds loopback and
requires login, anonymous/signup disabled. Neither container has Docker socket.
Prometheus retention is demo configuration: 7 days / 1GB. This is not a production
capacity benchmark. Secrets are separate read-only Compose file mounts, not in
image/env/Git. On Windows, file modes do not replace NTFS ACL: restrict the local
runtime directory to the operator; do not share it or include it in handoff zips.
Grafana password file seeds a new Grafana DB only; edit-file is not password reset
for an existing Grafana volume. Use Grafana account controls to change it.

## Issue, rotate, revoke

### Local operator commands

From `Streaming_Pipeline`, with Docker Desktop and the demo running:

```powershell
node runtime/manage-monitoring-key.mjs status
node runtime/manage-monitoring-key.mjs rotate
# Emergency revoke: deliberately stops successful scraping.
node runtime/manage-monitoring-key.mjs revoke
```

Alternatively double-click `rotate-monitoring-key.cmd`. Status reads local receipt,
not authoritative server revocation state. Rotation logs in through the existing
Admin API, writes a pending journal before installing the replacement, recreates
only Prometheus and waits for a successful target scrape newer than that restart.
Only then does it revoke the previous key and commit the replacement receipt.
It does not trust an old UP sample from before rotation.

On failure, keep `runtime/monitoring/rotation-pending.json` and rerun `rotate` to
resume without issuing another key. Old key is not revoked before scrape evidence.
Pending journal contains the replacement secret: keep the directory private/ignored.
A local exclusive lock blocks overlapping invocations. After a process crash,
first confirm no key operation is running; remove only the stale
`runtime/monitoring/key-operation.lock`, then retry. Do not delete pending state.
Revoke refuses to run while a rotation is pending. Interrupted HTTP issuance before
the response/journal is saved remains an uncertain outcome: inspect Admin listings
and revoke any unused issued key instead of blindly retrying issuance.

Four rotation workflow tests pass (including restart/scrape failure, journal failure,
and resume after revoke). The initial live attempt was blocked by a stopped Docker
engine; no replacement was issued then. Live acceptance subsequently passed on
2026-10-10 (see below). No automatic scheduled renewal is added.

### Underlying API / manual recovery

Use an authenticated Admin request (never the machine key) over loopback or HTTPS:

- `POST /api/v2/admin/monitoring-credentials`
  body `{"label":"prometheus-replacement","ttl_seconds":604800}`.
- `GET /api/v2/admin/monitoring-credentials` lists public metadata.
- `DELETE /api/v2/admin/monitoring-credentials/{id}` revokes (204, repeat safe).

For rotation, issue a replacement, verify its machine metrics request returns 200,
securely replace `runtime/monitoring/metrics-token`, and recreate **only Prometheus**
with the same Compose files and envs (`up -d --no-deps --force-recreate prometheus`).
Verify the scrape with `check-monitoring.mjs`, then revoke the previous ID and
update `runtime/monitoring/credential.json` with the new ID/expiry. Keep credentials
out of shell history and logs; use a trusted client/server-side script with values
in memory. If replacement fails, keep the previous still-valid key until repaired.
Expiry is intentional: without timely rotation, scrape becomes DOWN, not silently
authorized. No unattended secret-manager rotation or expiry alert is implemented.

## Evidence (2026-10-09)

- API suite 165 PASS, 4 optional integration cases SKIP.
- Live isolated demo: machine metrics 200; anonymous/Admin JWT rejected on machine
  endpoint; machine key rejected by `/api/auth/me`, credential management and Admin
  Processing. Revoke followed by metrics returns 401; repeat revoke returns 204.
- Actual PostgreSQL transaction verifies expired key denied, valid key accepted,
  disabled issuer denied. All fixture inserts/account changes rolled back.
- API image `funnelmetry/demo-api:20261009-monitoring-auth`; only API recreated.
  Grafana/Prometheus added with separate volumes; all original data volumes retained.
- Grafana dashboard API confirms 8 panels; datasource proxy query confirms UP=1
  and 6 worker series. No browser screenshot or full visual acceptance claimed.
- One test credential is retained revoked, with issued/revoked audit for provenance.
  Active demo key expiry lives in ignored `runtime/monitoring/credential.json`.
- No source/model activation, event injection, cursor reset, alerting or autoscaling.

Provisioning references: [Grafana file provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
and [Docker secret-file configuration](https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/).

## Rotation runtime acceptance — 2026-10-10

- Demo launcher completed successfully, including startup jobs; host UI 200 and
  anonymous API access denied. No reset, source activation or model activation.
- `manage-monitoring-key.mjs rotate` exit 0: replacement verified, only Prometheus
  recreated during rotation, a fresh successful scrape observed before old-key
  revocation, and local receipt committed. No pending rotation remains.
- `check-monitoring.mjs` exit 0: dashboard provisioned with 8 panels, scrape UP=1,
  six worker observation series. This is not end-to-end event acceptance.
- New key expiry: 2026-10-16 17:03:08 UTC / 2026-10-17 00:03:08 Asia/Saigon.
  Token/password never printed; current key ID/expiry stored in ignored runtime
  receipt. Revoked old key remains in the database with its audit trail.
