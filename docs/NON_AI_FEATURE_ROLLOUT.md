# Non-AI UI rollout

User priority: complete usable non-AI capabilities before expanding AI tools/planner.
Master §23.10–23.12 governs domain exploration, catalogs, findings and reports.
Availability is not completion of all Master acceptance criteria.

| Capability | Current delivery | Remaining |
|---|---|---|
| Metrics | Read-only PostgreSQL catalog API and searchable metric/measure definitions | Broader governed definitions, explicit minimum-data/filter contracts |
| Analytical Assets | Read-only asset details and physical binding validation | Additional assets and governed relationship contracts |
| Analysis Runs | Owner-scoped list/detail UI of completed executions, filters, pagination and evidence links | Full lifecycle, plan/retry/model/latency are not yet recorded |
| Evidence Explorer | Owner-scoped API/UI, full stored provenance, numeric results, warnings and report-preview links | Broader evidence contracts |
| Data Workspace | Manual order summary with UTC scope selection, deterministic execution and persisted run/evidence links | Agent plan/recipes, additional operations and per-step lifecycle are still absent |
| Products | Canonical product-event observations: exact-ID filter, sorting, pagination, equal-length prior-period counts | Source-scoped name catalog, governed product asset/metrics, full event drilldown and Workspace product-context support |
| Traffic | Blocked on verified attribution dimensions in canonical data | Governed raw-to-canonical mapping, asset and exploration; do not infer Direct from absent UTM |
| Campaigns | Not implemented | Confirm campaign/source contract; no fabricated campaign attribution |
| Findings | Owner-scoped review history, type filter, pagination and Evidence/Run/Report links; NOTE/USEFUL/NEEDS_REVIEW/INACCURATE | Official machine findings, latest-review aggregation, independent publication |
| Reports | Owner-scoped evidence-derived preview, readable Markdown and JSON downloads, explicitly non-official | Independent persisted reports, human interpretation, findings linkage and publication workflow |
| Admin placeholders | Not included in first catalog delivery | Audit each item against current backend before enabling |

## First delivery

41-event recovery completed: bounded fingerprint-confirmed Kafka replay after DB
backup, no cursor reset. Manifest verification found 41/41 canonical records,
Journey links, KPI applications and latest normalized outcomes. Source latest
totals now 309 normalized, no unsupported group; cursor remains 358. Audit/backup
are in ignored runtime/backups. See UNSUPPORTED_REPLAY_PLAN_2026-09-29.md.

Unsupported dry-run follow-up: deployed normalizer accepted 41/41 retained browser
schema1 records with stable canonical IDs under medusa-browser-schema1-catalog-v2.
Original receipt IDs/timestamps checked; zero writes. See
`UNSUPPORTED_REPLAY_PLAN_2026-09-29.md` for evidence and remaining replay safeguards.

Unsupported diagnosis (2026-09-29): read-only retained Feed inspection matched all
41 persisted mapping_not_found/unmapped-v1 outcomes. All belong to medusa-reference,
browser_sdk, source schema 1.0: page_viewed 11, scroll_depth_reached 19,
banner_impression 2, product_viewed 5, checkout.started 4. Current mapping-registry
contains source-scoped browser schema1 compatibility selectors. This establishes
selector coverage only, NOT successful payload normalization or completed repair.
No cursor/history/replay changed. Next recovery step requires dry normalization,
versioned replay plan and downstream idempotency verification. The diagnostic
script passed syntax check and live read-only inspection; no mocked event inserted.

Admin quarantine view (2026-09-29): `/admin/quarantine` and GET
`/api/v2/admin/quarantine` expose latest canonicalization outcomes only, source
required, optional quarantined/unsupported status, offset bounded 0..10000,
25/page. Current live pipeline.monitor permission required. Raw payload/document
and raw-record locator are not returned. No replay/delete/migration. Changing live
data may shift offset pages; UI discloses this. This is not ingress rejection or
Kafka DLQ inventory. Build and three Admin HTTP tests passed; existing PG test
skipped. Read-only demo inspection found 268 normalized and 41 unsupported latest
outcomes for medusa-reference, no quarantined row group. API restarted; interactive
browser acceptance still pending. Data Trust skill guided the explicit separation
between unsupported and quarantined outcomes without claiming historical repair.

Connector readiness follow-up: Admin now probes the configured connector process
through GET `/api/v2/admin/connector-readiness`, protected by pipeline.monitor.
Fixed operator endpoint defaults to `http://source-connector:32100/readyz`; override
server-side with DASHBOARD_CONNECTOR_READINESS_URL for other deployments. No URL
query input, no redirects, 3-second probe timeout. Only allowlisted states, sanitized
last-success timestamp and error-present boolean are exposed, not raw errors.
UI is a manual point-in-time check, separate from persisted cursors; unreachable
means UNVERIFIED, not proof of a stopped worker. READY does not mean caught up or
canonical completion. No Docker privileges or cursor mutation. Three unit/HTTP
tests and build passed; one existing PG test skipped. Browser acceptance pending.

Admin Connector cursor delivery (2026-09-29): `/admin/connector` calls
`GET /api/v2/admin/connectors` with live pipeline.monitor permission. Exact
connector_id filter, bounded lexical keyset pagination (25), manual refresh and
error/empty states. Reads only connector_id/event_feed_id/after_seq/updated_at
from source_connector_cursors; sequence remains a string. No source URL/secrets,
Docker access, cursor mutation, replay or migration. Cursor is Kafka handoff
progress, not downstream processing-safe checkpoint, event count or lag.
Runtime readiness and lag remain UNVERIFIED per Recovery/Observability skill.
Production build and two Admin HTTP tests passed; PostgreSQL integration test
in that suite skipped without its test configuration. Interactive browser
acceptance remains outstanding. This is partial Master connector observability.

Admin audit UI (2026-09-29): `/admin/audit` now consumes the existing bounded
account-audit endpoint, with action/actor/target filters, keyset pagination and
refresh. Route/menu require audit.read. It displays only API-sanitized changes,
UTC saved timestamps, and distinguishes errors from empty history. The page is
explicitly account audit, NOT Docker recovery/replay/system configuration history.
No migration, API mutation or AI change. Production build passed; two audit/admin
unit/HTTP tests passed, one PostgreSQL integration test skipped (not configured).
UI route returned HTTP 200; interactive browser acceptance is not yet recorded.

2026-09-29 Findings: `/findings` now shows append-only DA annotations, not official
machine findings. `GET /api/v2/analytical-notes` filters by kind and owner-scoped
keyset cursor (25/page). The notes POST accepts optional review_kind; defaults NOTE
for old clients and rejects unsupported values. UUID retry equality includes kind.
The existing analyst-only notes-write permission applies. A new evaluation does not
overwrite prior review or alter evidence status/quality. Markdown/JSON exports retain
the review kind. The Findings list is history, not latest state per evidence.

Migration `analytics/sql/evidence-notes-v2.sql` adds review_kind with default NOTE
and a check constraint. Backup `runtime/backups/before-notes-v2-20260929.dump` was
created and archive list checked (restore not tested). Applied transactionally to
demo and restarted only Dashboard API; health reports PostgreSQL OK. Rollback code
while retaining additive column/history, never drop annotations. Build and isolated
HTTP/PostgreSQL/Chrome tests passed: classification, invalid kind, retry conflict,
list filtering and browser Findings navigation. Evidence and Provenance skill guided
the separation between human reviews and machine evidence. This does not complete
the other remaining capabilities in the table above.

2026-09-29 follow-up: Reports/Evidence/Analysis Runs list now supports exact
source_id and saved-date UTC filters. API `saved_from` is inclusive and `saved_to`
exclusive (YYYY-MM-DD); invalid calendar dates, duplicate/structured query values
and reversed ranges are rejected. This filters evidence.created_at, NOT the event
window in provenance. Parameters remain bound and owner scope is unchanged.
Applying/resetting filters returns to the first page. The selected detail is
independent of list filters, explicitly labeled. No schema or historical change.
Build, route tests and isolated Chrome/HTTP/PostgreSQL passed, including UTC
boundaries, missing source, UI empty/reset and retained detail.

`GET /api/v2/catalog` requires JWT, live session and `analytics.read` (current
runtime capability bundle, not an RBAC redesign). It reads only the pinned reviewed
PostgreSQL release and validates the actual binding in a read-only transaction.
Missing/mismatched catalog or schema returns a sanitized 503, not mock definitions.
No catalog mutations, AI calls, migrations or historical rewrites are introduced.

`/metrics` and `/assets` expose definitions and policies, not numeric totals. They
display DRAFT/VALIDATED_STAGING and distinguish verified bindings from data quality.
Unspecified minimum-data rules and relationships are visibly unspecified; viewing
them does not publish the catalog. Existing legacy capability bundles are retained.

Verification: catalog HTTP authorization/failure tests; frontend production build;
combined isolated PostgreSQL/browser runner covers catalog API and both pages.
Record actual execution/deployment results before considering a delivery activated.

First delivery activated: catalog HTTP test passed; frontend build passed; Chrome
with isolated real HTTP/PostgreSQL passed both catalog pages. Test container/network
were removed. Demo API restarted and health returned 200. Read-only inspection of
the demo catalog returned verified binding, two measures, one metric and
`asset.fact_order`. No AI functionality changed. This does not complete the remaining
rows of the rollout table or all Master catalog requirements.

Second delivery: `/analysis-runs` and `/evidence` read completed execution records
from `analytical_execution_evidence`. GET `/api/v2/evidence` accepts a status filter
and owner-scoped keyset cursor; detail is GET `/api/v2/evidence/:id`. Both enforce
JWT, current session and analytics permission, and return only the actor's records.
No mutation, model call or schema migration is needed. The UI exposes the stored
JSON without rounding, indicates snapshot limitations, and does not invent query,
plan, latency or retry records. These fields remain visibly unavailable.

Verification: HTTP permission/owner/input/error tests and frontend build passed;
isolated PostgreSQL/browser acceptance passed listing runs and opening persisted
evidence. A full run lifecycle is still pending, so this is not full §23.8 completion.

Third delivery: `/workspace` now exposes the existing structured order-summary API
without an LLM call. Users explicitly select UTC start-inclusive/end-exclusive
dates (maximum 90 days); currency-separated gross order value, order count and AOV
are returned with persisted evidence. It retains the current API's analytics.read
and chat.use requirements; no role migration is implied. Input changes clear the
old result, duplicate submits are guarded, errors are not shown as zero, and reload
does not rerun. If navigation aborts a request, server-side computation/persistence
may still finish; look in Analysis Runs rather than assuming it was rolled back.

Build and isolated Chrome/API/PostgreSQL acceptance passed, including a direct
Workspace execution, stored evidence equality and no automatic execution on F5.
No database migration or model/provider/planner change was needed. The existing
dev UI serves the new page. This is a manual single-tool surface, not completion
of the full Agent-driven Data Workspace described by Master §23.7.

Products delivery: GET `/api/v2/products` reads only canonical product views and
authoritative cart-item-added event counts grouped by source/product. Explicit
occurred_at windows are start-inclusive/end-exclusive; comparison is the preceding
equal-length window. Count values remain decimal integer strings. Maximum current
window is 90 days, page size 50, sort keys allowlisted, filters parameterized, query
read-only with the existing transaction timeout. Scope/permission/session checks
are mandatory. This is a versioned observation contract, not a published semantic
catalog asset or per-product monetary metric. No item allocation or raw identity
fields are exposed. Missing/non-string product IDs are excluded with a limitation.

Demo inventory showed no source-scoped product catalog table. UI therefore uses
product IDs and explicitly says names are unavailable; the seeded legacy catalog
is not used. Click an ID to filter observations for that product. There is no claim
of purchase conversion, customer counts, units, revenue or full Master §23.10
completion. Changing source/time resets pagination. Live data may change between
pages; this endpoint is not a frozen analysis snapshot.

Reports delivery: `/reports` reuses the owner-scoped evidence API, filters and
pagination. A selected snapshot renders observed results, evidence provenance,
an explicit absence of interpretation, limitations and generic verification steps.
JSON export preserves exact decimal strings and the original provisional evidence;
non-PROVISIONAL results are suppressed. Export marks `official: false` and
`persisted_report: false`. It does not generate findings, infer causes, publish a
report, mutate evidence or call an LLM. This is not full Master report completion.

Verification on 2026-09-28: frontend production build and the isolated
Chrome/HTTP/PostgreSQL acceptance runner passed, including report navigation,
JSON download content, original evidence equality and monetary warning retention.
The runner removed its isolated database container and network. No migration or
API restart is needed for this frontend-only delivery.

Markdown export follow-up: Reports now downloads a readable `.md` document with
separate observation, evidence/definitions, interpretation, limitations and next
verification sections. Exact decimals are never converted to JavaScript numbers.
Metadata is escaped as Markdown text (including HTML and table delimiters), warnings
are retained, and non-PROVISIONAL statuses never render attached numeric results.
Missing grain/version details are explicitly referred to the original JSON rather
than fabricated. Five frontend tests, production build and the isolated real
HTTP/PostgreSQL/Chrome suite passed, including the Markdown download button.
No backend/schema/provider change; this remains an export, not server-side report
persistence or publication. Analytical Reporting skill guided the separated sections
and evidence/monetary wording.

Traffic inspection on 2026-09-28: demo had 268 canonical events and none of their
canonical documents contained `utm_source`. Master SDK input includes raw
`source_metadata.utm_source`, but canonical preservation was not verified. Raw
availability alone is not an attribution contract. Campaign/medium dimensions,
attribution policy and safe handling of missing source remain unresolved; empty
fields must not become fabricated Direct/Organic/Campaign classifications.
## Human notes (2026-09-28)

Master sections 17.4/18/23.12: new `analytics.notes.write` is granted only to the
analyst bundle, not legacy staff/viewer or admin. Existing read capabilities remain.
GET/POST `/api/v2/evidence/:id/notes` require JWT/live session/live permission and
own evidence. POST accepts only client UUID and bounded plain text (4000 characters).
Identical retries use the same UUID; changed payload conflicts rather than overwrites.
Author, timestamp and HUMAN_NOTE provenance are server-set in an append-only table.
List is keyset-paged (25). UI renders text, never HTML; notes survive reload. Drafts
not saved do not survive navigation. Notes are separate from immutable evidence
and do not become official findings. Reports can optionally include the latest 25
saved notes in JSON/Markdown, with author/time/evidence IDs and HUMAN_NOTE labeling.
Exports disclose omitted older notes using the returned cursor; they never imply
complete history when truncated. A fresh owner-scoped API read is performed on
download. Failed reads produce an error, not a partial file. Unsaved drafts are not
exported; no notes is different from choosing not to include notes. No migration
or API restart is needed for this export extension.

Migration: apply `analytics/sql/evidence-notes-v1.sql` after `evidence-v1.sql`, in
one transaction. It adds only a table/index/immutability trigger; no old data changes.
Rollback: restore previous API/UI code and leave the additive table intact to preserve
notes; do not drop data. Backup demo DB before activation. Missing migration fails
closed with sanitized 503. Restart API; refresh/login for updated capabilities.

Verification: frontend build and isolated Chrome/HTTP/PostgreSQL passed including
save, retry dedup, payload conflict, validation, immutable storage, session revocation,
viewer write denial and F5 restoration of escaped human text. No LLM calls.

Demo activation: backup `runtime/backups/notes-20260928.dump` (Git-ignored),
custom archive list verified; restore has not been tested. Additive migration
committed successfully and only `funnelmetry-private-dashboard-qwen` restarted.

## Product reference names (2026-09-29, opt-in, not live-activated)

Master §4.6 / DEC-117: `workers/catalog-sync` reads the Medusa Admin product list
at startup and periodically with a separately provisioned server-side secret key.
Only product ID/title/source update time are projected; no prices, arbitrary
metadata, source writes or events. `020_product_reference.sql` adds versioned
source-scoped snapshots and a one-row-per-product current reference view.
Products and Events business details now support the title + snapshot/time/provider
reference. Missing migration/name preserves ID display. Historical event amounts,
quantities and canonical documents are untouched; legacy seeded catalog is unused.

Cookbook Semantic Metadata Authoring / Analytical Asset Modeling guided explicit
source/product grain, one-to-one lookup and separation from historical facts.
Catalog offset pagination cannot prove point-in-time completeness; freshness and
completeness remain UNVERIFIED. This is product-name stage 1, not full variant/SKU/
category dimensions or a published semantic catalog.

Verification: 5 worker tests, 13 targeted API/repository tests, frontend build,
isolated PostgreSQL migration-rerun/source-isolation/history/no-fanout/rollback
test and downstream regression passed. No live Medusa request or demo migration
was run. Activation requires ignored `runtime/catalog-sync.env`, authorized
Medusa Admin origin/key, migration 020 and opt-in Compose worker deployment.
See `workers/catalog-sync/README.md`; Event Feed credentials must not be reused.
