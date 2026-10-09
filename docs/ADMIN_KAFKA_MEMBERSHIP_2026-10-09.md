# Kafka consumer-group membership observation — 2026-10-09

Master §23.14 / Cookbook pipeline-recovery-observability: add broker group
membership evidence beside offset lag, without a Docker control or recovery path.

## Additive API/UI contract

Existing authenticated `/api/v2/admin/kafka-lag` now includes `membership` on each
group/topic row. Fields are `status`, `state`, `member_count` only. `status` is
OBSERVED or UNVERIFIED; unverified values are null, never substituted with zero.
No change to offset lag status/meaning. UI is compatible with older API responses
that omit membership. Existing session/RBAC checks and operator target allowlist
remain unchanged.

Read-only KafkaJS `admin.describeGroups([groupId])`, once per unique configured
group in each snapshot. Telemetry's two topic rows share the same group evidence.
Reference: https://kafka.js.org/docs/admin#describe-groups

- Allowlisted states: Stable, PreparingRebalance, CompletingRebalance, Empty, Dead.
- Unknown states, errors, missing/duplicate responses or malformed/contradictory
  descriptions stay UNVERIFIED; descriptions above 1,000 members are rejected.
- Broker member identities, client addresses, assignment and metadata are omitted.
- Description failures do not convert successful offset reads into zero/unknown;
  offset failures can still return a valid membership observation.
- Uses existing bounded probe timeout/cache/coalescing; does not join groups,
  commit/reset offsets, send events, create topics, stop or scale workers.

## Interpretation

Member count applies to the whole group, not containers, hosts, or a specific
topic. Stable is broker membership state, not proof of successful processing,
DB availability, complete partition coverage or end-to-end freshness. Broker
session timeout may delay removal after a consumer disconnects. No new health
SLA or automatic recovery policy is invented. State and offsets are sampled
separately and are not an atomic snapshot.

## Verification and rollout

- API suite: 154 PASS, 4 optional PostgreSQL integration tests SKIP.
- TypeScript/Vite build PASS.
- Unit tests cover states, redaction, unknown/error/contradictory results,
  deduplication across topics, description and offset failures independently.
- Docker HTTP smoke: login 200, lag API 200, anonymous 401, SPA route 200.
  Broker returned 6 distinct groups, all Stable with 1 member, across 7 topic rows.
  This verifies the running case; Empty/rebalance/Dead tested as fixtures only.
  No worker-kill test or browser automation performed.
- API/UI rebuilt as local `20261009-membership`, only these services recreated.
  Workers, volumes, events and cursors unchanged; source/Qwen still disabled.
- No schema migration, new dependency, Git push or registry publication.

Still missing: direct stage readiness/error telemetry, live-workload validation,
Prometheus exporter/alerts and governed recovery controls.
