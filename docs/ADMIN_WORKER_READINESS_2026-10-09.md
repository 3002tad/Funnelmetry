# Worker runtime observation — 2026-10-09

Master §23.14 / Cookbook pipeline-recovery-observability. Read-only process
observation, distinct from Kafka membership, offset lag and PostgreSQL counts.

## Worker endpoints

Six workers share `workers/shared/health-server.mjs`. `WORKER_HEALTH_PORT` is
opt-in (unset disables listener); handoff monitoring overlay sets 32110.
The generic node-service and handoff worker Dockerfiles copy this shared module.

- GET /healthz: HTTP event loop responds 200; not dependency readiness.
- GET /readyz: READY/200 only after startup returns and runtime.isHealthy() is
  true. STARTING, DEGRADED and STOPPING return 503. Unknown path/method is 404.
- Scope explicitly `local_kafka_runtime_flag`: existing Kafka runtime flag,
  NOT a fresh DB query, group membership check, processing checkpoint or SLA.
- Shutdown closes listener before stopping runtime/pool; startup failure closes
  listener. Existing ACK/idempotency/transaction and event semantics unchanged.
- Listener binds internal 0.0.0.0. No host port published by Compose. These
  unauthenticated endpoints must stay on trusted private container networks;
  do not enable/publicly expose them directly on an untrusted host.

## Dashboard

GET /api/v2/admin/worker-readiness requires live session + pipeline.monitor,
rechecked after probe. Query parameters and state-changing methods rejected.
Fixed six worker DNS targets on port 32110; no client-selected address. Enabled
only by DASHBOARD_WORKER_HEALTH_ENABLED=true (handoff monitoring overlay).

Parallel GETs, 3s timeout each, 4KiB response cap, redirects rejected, strict
identity/status/scope matching; 5s cache and single in-flight probe per API
process. Outputs worker ID, checked_at, status, ready, scope only. HTTP/body
errors, old images, mismatches or inaccessible endpoints become UNVERIFIED/null,
not STOPPED or READY. Raw error strings are never exposed.

Processing page shows worker cards separately from broker lag/membership.
Checks one service endpoint per worker type, not inventory of all replicas.
No restart/scale/reset controls and no automatic restart policy changes.

## Verification / runtime

- API: 158 PASS, 4 optional integration tests SKIP.
- Web TypeScript/Vite build PASS.
- Worker + shared health suites in isolated Docker container: 85 PASS, 6 optional
  integration tests SKIP. Initial host run had three import failures due to a
  missing local input-contract dependency; clean image dependency install and
  container tests resolved that verification gap without changing lockfiles.
- Tests cover startup/ready/degraded/stopping, liveness distinction, disabled
  listener/invalid port, response bounds/redaction, cache, authorization and
  revoked permissions during probe. No real dependency-outage fault injection.
- Deployed local API/UI/workers images `20261009-health`, recreated six workers
  and API/UI. Kept DB/Kafka/volumes and offsets; no bootstrap/reset/event injection.
- Actual demo: all six /readyz READY, all /healthz 200, anonymous API 401,
  target override 400. This is runtime smoke, not browser E2E or live-source
  acceptance. Medusa/Qwen still disabled; no migration, Git commit or image push.

Open: continuous dependency checks, per-stage processing error counters,
multi-replica observation, Prometheus export, alerts and governed recovery.
