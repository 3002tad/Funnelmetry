# Admin API review — 2026-11-06

Scope: local Dashboard API and Admin UI. No deployment, migration, restart or
scale action was performed on the VPS. Runtime observations use read-only SSH;
controller history is from the completed local three-sample observation run.

## API and UI wiring

| Endpoint | UI / consumer | Local result |
| --- | --- | --- |
| `GET /api/v2/admin/scaling` (new) | Auto Scaling, Health & Recovery | Current replica/RAM, normalizer Kafka lag/readiness, completed-run policy and six audit records |
| `GET /api/v2/admin/worker-readiness` (existing, snapshot reader added) | Pipeline, Health & Recovery | Seven workers; six ready, ledger writer degraded at verification |
| `GET /api/v2/admin/kafka-lag` (existing) | Pipeline Kafka tab | `NOT_CONFIGURED`; independent direct Kafka probe is not configured locally |
| `GET /api/v2/admin/metrics` (existing) | Monitoring | Prometheus exposition available; unavailable signals retain their availability semantics |
| `GET /api/v2/admin/pipeline?source_id=medusa-reference` | Pipeline | Retained PostgreSQL counts available |
| `GET /api/v2/admin/processing?source_id=medusa-reference` | Pipeline | Retained processing counts available |
| `GET /api/v2/admin/event-feed` | Sources / Event Feed | `UNVERIFIED`; no configured live feed observation |
| `GET /api/v2/admin/connectors` | Sources / Connector | Endpoint available; persisted cursors do not prove live health |
| `GET /api/v2/admin/sources` | Sources | Endpoint available |
| `GET /api/v2/admin/quarantine?source_id=medusa-reference` | Event investigation | Endpoint available |

All ten endpoints were verified with real local HTTP calls: Admin 200,
unauthenticated 401, Analyst 403. A 200 does not imply a configured measurement:
Kafka and Event Feed explicitly report missing/unverified observations.

## Corrections made during review

- Removed the API reader's import of the manager controller toolchain. The
  dashboard Docker image does not copy those tools, so the former static import
  would fail at startup. Added an isolated-module test without the tools tree.
- Snapshot fallback readiness on Auto Scaling now validates each worker's
  timestamp, identity, uniqueness and ready/status consistency through the same
  reader used by worker-readiness. A fresh enclosing snapshot cannot revive an
  expired worker observation.
- Validate controller completion timestamp; order chart/history entries by their
  actual audit timestamp.
- Changed the Recovery controller card from ambiguous “Đã quan sát” to
  “Đợt thử đã kết thúc”. Historical HEALTHY is scoped to the normalizer trial.

## Verification

- Targeted API tests: 24 passed, one PostgreSQL integration test skipped.
- React production build passed.
- Playwright with actual local API responses passed: runtime cards, policy
  dialog, two charts, six controller audit rows, three recovery observations,
  refresh, mobile overflow and failed-refresh handling. The failure case alone
  deliberately returns a browser-intercepted 503.

## Remaining boundaries

- The controller reader currently accepts completed `OBSERVE_ONLY` runs. It does
  not provide live process heartbeat, continuous observe/apply mode or executed
  scale/recovery history. Those must not be inferred from the present status.
- Headroom/cooldown values displayed are trial policy settings, not current free
  capacity or remaining cooldown measurements.
- Direct liveness and per-worker processing progress are not wired into Health &
  Recovery. Its Recovery policy tab describes baseline behavior, not a deployed
  runtime recovery policy.
- Pipeline Kafka uses the separate kafka-lag endpoint. The normalizer-only lag
  in scaling must not be relabeled as coverage of every consumer group.
- Changes remain local; no GitHub push or VPS rollout is included in this review.

Subsequent read-only VPS verification found Event Feed READY with a real
snapshot and worker readiness enabled for seven workers. Kafka lag returned
NOT_CONFIGURED and the new scaling endpoint returned 404 before deployment.
The Admin UI/monitoring changes are now prepared on a separate GitHub branch;
the review itself did not deploy them or enable automatic actuation.
