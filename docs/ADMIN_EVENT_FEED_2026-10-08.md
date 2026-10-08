# Admin Event Feed — 08/10/2026

Scope: read-only observation under Master §5.3 and deployment/security rules.
This does not implement provisional SourceConnection YAML, source-side retention
controls, source log browsing, recovery actions or downstream processing lag.

## Implementation

- Source Connector keeps `feed_observation` in process memory, populated only after
  whole-batch feed validation. Fields: observed time, feed ID, request cursor,
  retention floor, latest advertised sequence, returned record count.
- Observation occurs BEFORE publishing. A Kafka failure may leave a valid source
  observation while Connector is DEGRADED/BLOCKED. It is not a successful handoff,
  processing checkpoint, current persisted cursor or proof of end-to-end delivery.
- Existing `/readyz` exposes this metadata plus connector identity. No new request
  to Source, token propagation, raw event payload, DB migration or cursor reset.
  Observation is lost on process restart and remains old across poll errors.
- Dashboard's operator-configured monitoring target remains
  `DASHBOARD_CONNECTOR_READINESS_URL` (default `http://source-connector:32100/readyz`).
  It is an INTERNAL connector endpoint, not the public Medusa feed URL. Keep it
  on a trusted internal network; do not expose unauthenticated worker health ports publicly.
- `GET /api/v2/admin/event-feed` requires a current session and `pipeline.monitor`,
  rechecks both after the bounded probe, rejects query parameters (including URLs),
  returns no-store and allowlisted metadata only. Analyst/staff cannot read it.
- `/admin/event-feed` now has a real page, refresh/loading/error/absent observation
  states, process status, observation timestamps and retention boundary fields.

Sequence values are serialized as strings after safe-integer validation. Sequence
gaps are allowed: subtraction is NOT an event count or Kafka lag. Retention floor
is a sequence boundary, not retention days or a complete historical coverage claim.
Empty returned batch does not mean empty source history. READY does not prove all
records processed. Failed monitoring access means UNVERIFIED, not Source offline.
No freshness SLA is invented; the UI displays explicit observation/check times.

## Compatibility / rollout

New API with old Connector shows no observation (upgrade needed), not fake zeros.
Existing connector-readiness clients can ignore the additive field. Published
`a725fad` images do NOT contain this change. Rebuild worker/API/UI into new image
references, then recreate the relevant services in the selected deployment using
its existing env/volumes. Do not reset database/cursor or overwrite release digests.
Custom deployments must route the API monitoring URL to the correct connector;
this page does not infer a multi-connector inventory from persisted cursor rows.

## Verification

- Source Connector suite: 34 PASS, including unchanged publish/ACK/save ordering,
  invalid feed rejection, empty poll, snapshot before failed Kafka publication.
- Dashboard API suite: 144 PASS, 4 PostgreSQL-dependent tests SKIP (no test DB).
  Tests cover auth, session/role revocation during probe, query rejection, redaction,
  unsafe sequence rejection, unavailable/legacy responses and stale snapshots.
- Navigation suite: 5 PASS. Updated stale expectations for existing real pages
  (Products/Findings/Workspace and registry pages); no new permissions granted.
- TypeScript/Vite production build PASS; `git diff --check` PASS.
- No live source, live database, browser E2E or deployed-container acceptance in this
  change. Need to verify actual feed metadata and page after rebuilding runtime.

Next: processing-stage observability should use genuine stage/Kafka evidence, not
infer backlog from these feed sequence differences. Keep source payload and business
results out of the technical Admin monitoring surface.
