# DB-GPT reference metadata sync

This operator-invoked integration publishes a derived, versioned KB snapshot of
the active `reference.medusa.current_offer.v1` definition. PostgreSQL remains
the metadata authority. The snapshot also contains a clearly labeled guide for
exploring current product counts. The guide is not a published metric or tool.

## Database read path

`analytical-views.sql` requires the Pipeline database owner and an existing
restricted role named `funnelmetry_ai_agent`. It exposes only:

- `funnelmetry_ai.current_products`: names from the quality-gated CDC view;
- `funnelmetry_ai.catalog_quality` and `current_product_summary`: runtime
  quality status and a count that is NULL when quality is blocked;
- `funnelmetry_ai.reference_offer_metadata`: the active, explicitly allowlisted
  metadata release and binding.

The role must not own these views or gain access to underlying tables. The
operator should also set a read-only default and a statement timeout. A SQL
client must check the status and validity on every query: an empty view is not
proof that there are no products. These views do not authorize price, revenue,
conversion or historical-order claims.

## Publish a snapshot

Run `sync.py` inside an environment with `psycopg2`, network access to the
restricted PostgreSQL role and DB-GPT's internal HTTP API. Configure standard
`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and optionally
`DBGPT_URL` (defaults to `http://127.0.0.1:5670`). Supply credentials through a
secret mechanism, never through Git or printed commands.

The operator must authorize sending the release definition and guide to the
configured embedding provider. The sync reads exactly one ACTIVE release,
verifies its identity, hashes its canonical definition and guide, and creates a
KB space/document named with that digest. It waits for indexing to finish.
Re-running the same snapshot reuses the existing finished document. Changed
metadata creates a new versioned space; old spaces are not automatically
removed or switched off, so consumers must select the intended version and
operators must retire stale versions before making one the default. This script
does not schedule refreshes or implement a production cutover.

For the KLTN VPS proof of concept, the SQL views were applied and the sync
script was copied to `/etc/funnelmetry/ai-agent/sync-metadata.py`. After explicit
authorization to use the configured external embedding provider, the active
release and integration guide were indexed in space
`funnelmetry-offer-1-0-0-da0c94e33295`; document 1 reached `FINISHED` and a
retrieval query returned the product-summary guidance. This is a manually
invoked, versioned snapshot, not a scheduled synchronization or an Agent
runtime integration. This DB-GPT fork's v2 document-list route returns the
wrong response shape; the sync uses the v1 document-list endpoint to check
status and avoid duplicate documents.

On 2026-11-01 the operator separately retrieved KB context, queried the
quality-gated summary through DB-GPT's SQL editor, and supplied both results
to `qwen3.6-flash` with explicit authorization. At that instant the SQL result
was 104 current product references with status `REFERENCE_CURRENT_ONLY`, and
the final answer reported the same count, source and scope. This validates a
manually orchestrated proof of concept, not automatic Agent routing, persisted
Evidence, or an official metric. The response included a lengthy thinking
section, so token and display optimization remain open. VPS SQL views must be
provisioned explicitly from `analytical-views.sql` after environment rebuild.

## Agent baseline assessment (2026-11-01)

- Edge UI with the versioned KB and an isolated synthetic PostgreSQL source
  failed before any Agent tool call: MySQL lacked `gpts_messages.trace_id`.
  A read-only comparison of 45 loaded ORM models found this one missing column
  and no missing tables. The MySQL schema needs a versioned migration before
  the UI Agent flow can be accepted.
- The separate `chat_data` API generated and ran a SELECT for a synthetic
  `REFERENCE_CURRENT_ONLY` row, returning 104, status and timestamp. It did
  not establish that the Agent automatically used the KB or recorded Evidence.
- With synthetic `BLOCKED_BY_QUALITY` and NULL count, `chat_data` returned the
  raw NULL/status table without a clear user-facing quality explanation. This
  is not an accepted quality-gated Agent response.
- An out-of-scope paid-revenue question against the synthetic datasource was
  rejected as insufficient schema. A separate `chat_knowledge` query used KB
  citations and said current product reference cannot establish paid revenue;
  it also mixed in current-offer price/inventory scope, which requires careful
  asset disambiguation.
- All four API responses reported zero prompt and completion tokens despite
  nonempty model responses; token/cost measurement is unverified. UI still
  displayed Chinese strings and Walmart examples. The isolated test datasource
  and PostgreSQL container were removed after testing.

### Follow-up: DB-GPT MySQL trace migration

The nullable `gpts_messages.trace_id` column and its index were added on the
VPS after a MySQL backup, using DB-GPT fork migration
`assets/schema/upgrade/funnelmetry/001_gpts_messages_trace_id.sql`. The fresh
schema and migration were exercised on isolated MySQL; running the migration
twice preserved a pre-existing row. The VPS Compose initialization manifest
now references the updated fresh schema and migration, but the source changes
still need to be committed and distributed.

With a disposable synthetic source and this KB selected, the UI ReAct Agent
completed a normal query and reported 104 with the source and quality status;
the tested conversation persisted ten messages with trace IDs. The API trace
showed `sql_query` and `terminate`, but no KB retrieval or final citations, so
governed metadata/evidence integration is not established. When the same
synthetic row was switched to `BLOCKED_BY_QUALITY` with a NULL count, the Agent
requeried it but incorrectly claimed no change and no valid products. This is
a failed quality-gate acceptance case; NULL is not evidence of zero products.
The synthetic datasource and database container were removed after the test.

## Verification

`python tools/dbgpt-metadata-sync/test_sync.py` runs isolated sync unit tests.
For SQL, run `test-fixture.sql`, `analytical-views.sql`, and
`test-assertions.sql`, in that order, on a disposable PostgreSQL database.
The fixture tests a fresh lease, an expired lease, an inactive metadata binding,
and the role's write privilege. Never run the fixture against live Pipeline.
