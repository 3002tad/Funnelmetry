# DB-GPT: analytical metadata and vector integration

DEC-149 selects the vector store managed by DB-GPT for its Agent and Knowledge
Base. PostgreSQL and the Funnelmetry semantic catalog remain the authority for
analytical data, definitions, versions and quality; a KB document is a derived
retrieval copy. MySQL remains DB-GPT's internal operational database.

## Reference slice

The current integration exposes `funnelmetry_ai.reference_offer_metadata` and
the read-only, quality-aware catalog views in
[`tools/dbgpt-metadata-sync`](../../tools/dbgpt-metadata-sync/README.md).
Exploration views are separately marked `UNVERIFIED`. The sync publishes an
ACTIVE release and guide to a DB-GPT KB space named from its SHA-256 digest.
`--check` compares the current release with its document without publishing or
calling an embedding model. A valid Pipeline session token is required when
the DB-GPT identity boundary is enabled. The operator selects the matching KB
space; automatic selection, invalidation and refresh are not implemented.

The active demo semantic release is `demo-commerce-analysis@1.2.2`, definition
SHA-256 `10f54c5bde61a5d74edbaa94833794501143ed0c1d46ee98a63fda27bacec521`.
Derived guide revision `2026-11-21.1` is published as
`funnelmetry-demo-1-2-2-71b20bc7fff5`, document ID 16, indexed `FINISHED`.
Retrieval returned the matching release marker; the publisher's read-only
golden SQL check passed 15/15 on the VPS. Existing conversations retain their
selected KB; select this matching version for new Agent evaluations. Publication
does not certify a model answer or silently change a conversation's selection.

DB-GPT runs source commit `c14452ef1ae77b79f89510f1572509ab89be511c`, image
ID `sha256:fb1331669d280e42e89cdd9a44721b95abd4c61283e6326f9a16583e6f3f3c1e`.
Compose pins this same local image digest.
The manifest checks all 2,388 source/skill/suite files and 615 static UI files.
There were no UI source changes in this commit: the verified static export from
149d8782 is retained byte-for-byte, without another UI build. Only the DB-GPT
webserver was recreated; MySQL, chat and Chroma volumes were retained. Admin and
Analyst login/read API smoke tests, public HTTPS reads and anonymous denial
passed. This is deployment/API acceptance; a new browser/LLM analytical
evaluation remains separate.

The current image includes typed PostgreSQL discovery recovery, failed-batch
diagnostics, localized dashboard failures and persisted-result completion
checks. Offline dashboard/SQL/native regression passed 980 tests; five optional
MySQL/Redis integration tests were skipped. Post-deploy Admin/Analyst and public
HTTPS smoke passed, as did current-KB retrieval and 15/15 golden SQL checks.
Four older `funnelmetry-demo-*` spaces were removed at the operator's request;
the current space above is retained. Historical chat text is unchanged, but old
KB selections must be replaced with the retained space before further retrieval.

## Model management

Active chat models are managed by the Admin provider UI under **Funnelmetry
Qwen** (`custom/funnelmetry-qwen`), persisted in MySQL; model workers restore
from model storage. `/etc/funnelmetry/ai-agent/dbgpt.toml` has no static LLM
definitions. Its `default_llm` remains a preference, not a second model registry.
The embedding definition `text-embedding-v3` remains unchanged.

The provider and usable chat API both expose nine models: `qwen3.7-plus`,
`qwen3.6-plus`, `qwen3.6-flash`, `qwen3.8-27b`, `qwen3.5-flash`, `qwen3.6-27b`,
`qwen3.5-27b`, `qwen3.5-plus`, and `qwen3.8-flash`. The seven date-versioned
models and their former Versioned provider are removed from active configuration;
historical conversation/usage records are retained.

The worker manager initializes with the webserver binding even without static
LLMs, then attaches startup listeners. This fixes the previous empty-LLM startup
crash and avoids using an embedding worker's default port for dynamic LLMs.
Regression: 35 worker/startup tests pass. Checksums, Admin/Analyst HTTPS smoke
and a read-only post-restart comparison confirm nine provider/chat models, no
static LLMs and no return of retired date-versioned models. Worker registration
is asynchronous; an immediate post-start empty list is not a final readiness
result. Upstream advertises `qwen3.8-flash`; no analytical LLM call was used to
certify its reasoning, token quota or context window.

Native `tool_choice=auto` can now deliver the current provider's completed
public text without a redundant terminate call. Private thinking, malformed
tool-call wrappers and explicit truncated/filtered responses are excluded;
ordinary final verification and pending-plan semantics remain in place.
Protocol retry errors carry a category and vi/en explanation. Skill 1.0.17,
shared interpretation guidance and the current derived KB clarify computed
ratios/complements, timezone, unequal hourly exposure and checkout starts versus
abandonment. These instructions do not certify LLM arithmetic. The deployed
image passed 62 backend tests; the guide passed seven offline tests. Saved-output
replay passed for both rejected public answers from the investigated chat.
No new analytical model evaluation was run for this deployment.

## Scope and schema corrections

The deployed DB-GPT revision adds a bounded prior-evidence inventory at the
start of conversational ReAct follow-ups. It uses the existing owner/session
catalog and a paginated `session_evidence` tool to inspect old results and read
saved scalars without querying PostgreSQL. Missing scope/grain/freshness remain
unknown, with definitions/quality retaining their original authority. This is
operational evidence reuse, not KB semantic knowledge; tool instructions remain
in DB-GPT runtime/skill documentation. The running container restored 14 captures
from the inspected chat and read seven saved values without source SQL or LLM
calls. Regression: 181 combined backend tests pass; the final scalar-label
extension passed 20 focused catalog/inventory tests. Model-level query/token
savings remain to be evaluated.

Published guide-only revision `2026-11-20.1` further clarifies descriptive
order/cart-session ratios, cohort conversion, partial calendar weeks and the
difference between half-month means and significance tests. It keeps the active
1.2.2 definition/SHA and fixture unchanged. The published space is identified
above; older conversations are not automatically rebound to it.

The deployed `demo-commerce-analysis@1.2.2` adds cart
`product_key`/`variant_key`, case-sensitive `ADD`/`DECREASE`/`DELETE`, product-view
JSON keys and dataset-scoped synthetic catalog relationships. Existing 1.2.1
bytes, fixtures and historical facts stay unchanged. `ADD` counts positive
quantity mutations, including increases; it does not count distinct carts or
purchased orders. Snapshot product titles are not historical names. Independent
stage counts do not establish sequential conversion.

The release publisher defaults to 1.2.2 and refuses KB publication until the
active PostgreSQL release ID and SHA match. Apply its generated transaction
after `demo-semantic-release.mjs check 1.2.2`, then publish and verify the derived
KB and explicitly select that space for evaluation. The VPS transaction and
publication have completed; existing fixture data and old semantic definitions
were retained.

The accompanying DB-GPT source keeps confirmed clarification answers in server
history snapshots and pins their chronological scope outside rolling memory.
Its `db-query@1.1.1` package includes compact English runtime SOP/skill variants
for vi/en prompts; public explanations follow the requested locale. The binder
records the projected prompt/document hashes separately from original source
hashes. The live registry confirms `db-query@1.1.1` enabled from
`/app/assets/suites/db-query`. Rendering its actual `/nl2sql` binding with locale
`vi` passes the no-CJK assertion and records projected-document hashes. Other
packages without locale sidecars retain their original fallback.

Regression: 67 container tests and 6 offline guide tests pass. The actual
`db-query /nl2sql` SOP/skill block renders 5,212 characters versus 33,283 in the
original projection (the live projection with the degradation watermark is
5,379 characters). This measures that block only, not total prompt tokens,
provider cost or answer quality. Native tool permissions and thinking remain
unchanged. A deployed model evaluation is still required to confirm corrected
period/top-N, enum handling and evidence-grounded conclusions.

On 2026-11-05, the Pipeline exploration views were updated to include current
source lease status and validity for catalog and inventory/price context while
retaining the separate exploratory `UNVERIFIED` label. Using the DB-GPT role,
104 catalog rows and 386 inventory/price context rows showed source status
`REFERENCE_CURRENT_ONLY`; 187 order-state rows showed `CURRENT_STATE_READY`
with `INCOMPLETE` historical coverage. These are time-scoped observations, not
historical certification. Agent prompt/skill guidance for provisional
descriptive analysis and the updated KB guide are source changes pending AI
deployment and KB publication; no paid model retest has been performed.

The order exploration schema also exposes `order_reference_coverage` for the
Agent: current readiness and historical gap are separate, with source/epoch,
profile activation and baseline/transition ingestion timestamps. On the VPS
the `cdc11_order_epoch1` profile was ACTIVE, baseline was complete and current
state ready; exact gap boundaries remain UNKNOWN. These fields do not prove
uninterrupted history or turn active order count into terminal journey count.

On 2026-11-04, the VPS release `asset.reference_medusa_current_offer@1.0.0`
was ACTIVE. Its digest was
`110b3588e9fa733c3fc4c98dd86b4140b08507d47cf5587d674436cadab2fa7e`;
the matching `funnelmetry-offer-1-0-0-110b3588e9fa` document reported
`FINISHED` in a Chroma space. The restricted PostgreSQL role read 104 current
product references with `REFERENCE_CURRENT_ONLY`. This is a point-in-time
reference count, not a revenue, order or conversion metric. This check did not
invoke an LLM or establish automatic KB selection or Agent evidence routing.

The DB-GPT fork adds `funnelmetry-ecommerce-analysis@1.0.0` to its native
skills. It provides analysis guidance and does not implement a new deterministic
metric tool. Other DB-GPT skills and tools remain available. The skill's
directory includes a small overlay Dockerfile for the existing DB-GPT image.

### Analyst UI test: qwen3.5-flash (2026-11-04)

After rebuilding the skill overlay and redeploying the AI webserver, one
Analyst session explicitly selected `funnelmetry_handoff`, the matching
`funnelmetry-offer-1-0-0-110b3588e9fa` KB and the Funnelmetry skill. The Agent
reported 104 current reference products and `REFERENCE_CURRENT_ONLY`; these
matched a read-only PostgreSQL query immediately before the run. The execution
panel showed that the skill was pre-loaded and a SQL result of 104. The KB was
selected, but no KB retrieval action was visible in the recorded steps, so
retrieval and citation are not established by this test.

The UI showed eight SQL action cards, two marked as errors; one exposed a
missing `sql` argument. The Agent nevertheless completed, but its answer
attributed the count to `reference_offer_metadata`, which is a metadata view,
and called the source ID a datasource. The view `current_product_summary` is
the independently verified count path. The UI trace tab returned 403 for the
Analyst and displayed no traces. A context indicator showed approximately 4k
of a 116k window; this is not verified provider token usage or cost. No second
model run was made. Conversation ID: `3ab50fad-7cb4-415d-8958-fbf61985122b`.

The subsequent DB-GPT change requests provider usage on the OpenAI-compatible
stream, records the final provider usage on the LLM span with the conversation
ID, and exposes per-conversation/model totals through the owned trace panel.
An incomplete provider response is shown as unavailable, not estimated from the
context window. The skill now distinguishes the count view from metadata and
requests retrieval of a selected relevant KB; an empty SQL argument returns a
specific correction to the Agent. Analyst trace access is scoped to the owned
conversation. Existing trace data needs an SQLite backup into the persistent
`/app/pilot/data/observability.db` path when deploying this change. Earlier runs
without provider usage cannot be reconstructed from a context-window estimate.
On 2026-11-04, one Analyst retest with `qwen3.5-flash` reported 104 and named
`funnelmetry_ai.current_product_summary` correctly. Three SQL actions were
visible: the first failed because the model invented nonexistent column names;
two subsequent actions succeeded. No KB retrieval action was visible despite
the selected space. The skill was subsequently updated with the actual view
columns; no additional model test has confirmed that change. The Analyst trace
and usage endpoints returned 200, and usage remained available after an AI
container restart. Provider-reported usage for conversation
`7317f249-701d-4d6d-b8f5-dad2ae93f745`: four model calls, 42,515 prompt,
920 completion and 43,435 total tokens. These values apply to recorded calls
linked to this conversation; calls without attribution cannot be included.

Follow-up inspection of the same run found the selected KB name and KB tool
descriptions in all four recorded model prompts. None contained the distinctive
`Current product reference for exploratory questions:` guide marker or the
guide's `source_id x product_id` text, and the UI recorded only SQL actions.
The selected KB is therefore confirmed as context/available tools, but actual
retrieval of its document is not evidenced. Source inspection shows selecting a
space constructs a retriever resource and lists tools; it does not itself fetch
the document. Missing KB context could have contributed to the nonexistent SQL
columns, but this evidence does not establish causation.

The selected published document was subsequently inspected in DB-GPT's
operational database: document 3 was FINISHED, contained the expected digest,
asset grain, product-summary guide and quality limitations, and had 12 stored
chunks. The guide does not list every column of every view.

After adding bounded automatic retrieval from the selected KB, one Analyst
test (`bc8e86f5-74f7-474d-9dc9-9855b3afe7d5`) recorded three retrieved
chunks from that document in `knowledge.prefetch`, including the product-summary
guidance. The first model prompt contained the guide. The Agent observed 104
reference products but continued repeating SQL calls and the test was
interrupted without an accepted final answer. Six provider-reported calls
totalled 67,672 input and 558 output tokens; three other recorded calls had
unavailable usage, so 68,230 is only a partial total. A fallback to another
configured model was also recorded. This validates retrieval, not successful
end-to-end analysis or complete token accounting.

The test used the new code in a temporary overlay image built from working
files. Afterwards DB-GPT commit `ce9ce5e59099cedfda8accd7acf17d1e7ce4eb40`
was pushed and its source and frontend were rebuilt on the VPS into
`funnelmetry-db-gpt:ce9ce5e5-kb`, using the prior image for runtime dependencies.
The rebuilt frontend passed TypeScript, the focused retrieval tests passed and
the service responded HTTP 200. No additional paid model test was run against
the rebuilt image; the previous test is not a test of that exact image.

### Agent execution failure analysis (2026-11-04)

Read-only inspection of the saved trace for
`bc8e86f5-74f7-474d-9dc9-9855b3afe7d5` established the following sequence:

- The selected KB returned three chunks. The first model prompt contained the
  product-summary guide. Two SQL actions succeeded: the first returned 104
  products and `REFERENCE_CURRENT_ONLY`; the second read catalog quality.
  No nonexistent-column SQL error was observed in this run.
- Three later `sql_query` actions failed because the model expressed an action
  without a nonempty `sql` argument. The validation returned a correction, but
  the Agent repeated the same intended metadata query. A subsequent reply had
  neither a valid ReAct step nor a native tool call.
- The next three model attempts failed with `The content are empty` before
  provider usage could be reported. Inspection of the recorded request shows
  an empty assistant message at position 9 in each failed attempt. Earlier
  successful requests did not contain such an empty message. The native Agent
  persisted a blank reply after the invalid action, and the model request
  converter rejects blank message content.
- The native function-calling path allows three model attempts and selects a
  different advertised model when the chosen priority model fails. One failed
  attempt therefore selected `qwen3.5-27b` despite the test requesting
  `qwen3.5-flash`.
- The Agent configuration permits 60 rounds and 900 seconds. Six successful
  provider calls each sent roughly 10–11.6k prompt tokens; the aggregate
  68,230 tokens is incomplete because three failed attempts had no usage.

The next code change should preserve native DB-GPT tools while preventing a
blank assistant reply from entering model history, recover from a missing SQL
argument with valid feedback, and keep an explicitly selected model fixed for
the evaluation run. A bounded task/usage budget should stop repeating invalid
actions and report the partial analytical evidence. Validate those paths with
the saved trace and focused tests before another paid model run.

The follow-up DB-GPT code change filters empty assistant messages from native
model requests, gives a concise correction after an invalid action, and stops
after two consecutive malformed calls while leaving earlier SQL artifacts in
the conversation. An explicitly selected model stays pinned on retries and
fails visibly if unavailable. The provider's Qwen documentation says
`tool_choice=required` is unsupported in thinking mode; the repair keeps
`tool_choice=auto`. Focused container tests cover these paths.

The subsequent Analyst run on deployed commit `7624337a` completed successfully
with `qwen3.5-flash`: conversation `567d9d57-ac28-45b3-9213-d9204e1c5900`.
It retrieved three chunks from document 3, executed two valid SQL queries
(`current_product_summary` and `catalog_quality`), and returned 104 current
reference products with the correct source view and `REFERENCE_CURRENT_ONLY`.
The two provider calls reported 22,721 input and 572 output tokens (23,293 total).
There were no malformed actions, empty-message errors or model fallback in this
run; recovery branches were covered by focused tests, not triggered live here.
The answer also said "fresh PASS lease", which was not a status directly
returned by these queries. A KB requirement must not be presented as independent
runtime evidence that the requirement has passed.

### Prompt cost and explanation optimization

Inspection of that successful trace found approximately 16,000 characters of
messages and 26,000 characters of native tool schemas in the first model request.
The skill workflow repeated tool descriptions/parameters already sent in those
schemas, plus task-list and report instructions. Local changes consolidate that
workflow guidance while retaining registered tools, schemas, skill content,
database/file/KB context and the report evidence policy. Rendered static skill
instructions shrink from 6,952 to 1,801 characters; including added shared
evidence guidance, the net reduction is 4,486 characters per request, before
the changed skill text. This is a character measurement, not a tokenizer or
provider cost measurement. Tool schemas still constitute substantial context.

The shared prompt and Funnelmetry skill now distinguish observed SQL status from
KB quality requirements, preserve `REFERENCE_CURRENT_ONLY`/`UNVERIFIED`, and
avoid inferring PASS or historical completeness from timestamps. Retrieved KB
excerpts may be reused when sufficient; additional retrieval is for missing or
ambiguous definitions. Short questions request a concise sourced answer rather
than an unrequested report. Existing model settings and tool capabilities are
retained. Two offline rendering/policy checks pass, Python compilation passes,
and AST comparison confirms identical tool-pack assignments. These prompt changes
are local and have not yet been deployed or measured in another paid model run.

Before that run, the selected-skill path was checked against the integration
plan. Its prompt mentioned optional KB lookups but its registered tool pack did
not include the selected KB tools. Both skill analysis and knowledge modes now
include those tools. The requested model temperature is preserved when set to
zero instead of silently changing to 0.2. The general path without a selected
skill also drops duplicated tool signatures: its static workflow prompt shrinks
from 8,889 to 1,372 characters in a placeholder render while retaining skill,
KB, database, file and report context. For batched tool calls, identical content
and observation are carried once in model history; a distinct full observation
is retained when content is only a stored-output preview. Five local prompt
rendering and configuration checks and four container-native recovery/batch
checks pass. The complete tool schema remains available and was not shortened;
the 26k-character tool-schema component observed in the baseline still needs
separate measured optimization. The 60-round/900-second ceiling has not been
reinterpreted as a token budget or changed for this prompt work.

## Vector migration status

The VPS DB-GPT configuration reports `Chroma`; its data is under the persistent
`ai-agent_ai-agent-data` volume. The inspected Swarm service and container lists
had no Qdrant service on 2026-11-04. This does not establish a complete
retrieval/rebuild acceptance for every knowledge source.

Source code still contains the optional `infra/swarm-knowledge.yml`, the old
Chat V2 metadata index in `apps/dashboard-api/src/lib/ai/metadata-vector.js`,
and legacy chat/system consumers of Qdrant. `/chat` in the current Pipeline UI
redirects to DB-GPT, but API/shared consumers remain in source. Do not remove
their code or storage based only on the absence of a running Qdrant service;
inventory retained data and migrate or retire each consumer as part of the
separate runtime cutover. No vector data was deleted by this integration.


## Agent efficiency and streaming UI changes (deployed 2026-11-24)

Source changes following the cancelled qwen3.8-flash run replace the static
initial evidence inventory with a bounded metadata-only task/evidence index
refreshed before each native model call. Captured results remain in their
owner/conversation-scoped catalog; omitted artifacts and full SQL/values remain
available through session_evidence. Unknown scope and capture time do not certify
freshness. The index is advisory/fail-open, with no extra model request, forced
termination, business-query cache or tool restriction. The analysis skill now
separates required evidence from optional extra investigations and future files.

SQL failures for PostgreSQL multi-column COUNT receive a structured composite
DISTINCT hint; the tool does not rewrite or retry SQL automatically. Native
batches containing both SQL and todowrite project the actual task list, keeping
live progress aligned with saved state.

The UI coalesces execution updates over 40 ms, flushes pending terminal updates,
caches artifact projections by immutable output/step identity and answer, and
follows scrolling only while the reader is near the bottom. Step duration has
an explanatory tooltip: it includes orchestration/transport, not only SQL time.

Validation on a separate source copy: 29 backend tests (plus 10 subtests),
36 UI tests and full web TypeScript check passed. No paid model calls or live
service changes were made for this verification. These results do not measure
browser responsiveness, token savings or model answer quality after deployment.
The deployed source/image described above is unchanged until a separate deploy.


## Chat, Dashboard and AWEL lifecycle fixes (deployed 2026-11-24)

The source rejects failed HTTP/JSON chat responses instead of reporting success,
accepts SSE content types with charset, and reports ReAct closure without a
terminal event as incomplete. Dashboard callbacks/uploads are scoped to the active
controller; optional browser model preferences cannot block execution and removed
models are excluded from effective selection.

Taskflow generation errors preserve HTTP/application codes. Missing sessions may
be recreated; denied sessions are not. Polling stops for permanent errors and
backs off transient failures without resubmitting model work. Scope/epoch guards
ignore old flow responses. Restore/save apply snapshots only if local canvas
edits have not changed while awaiting a response; browser pointer storage is
optional. Debug runs consume the final event without requiring a trailing newline
and cannot submit after the drawer closes during preparation.

Offline verification covers 54 tests; full web TypeScript is checked separately.
These changes have no schema migration or permission/semantic contract change.
They remain pending deployment and browser/LLM acceptance, including the previous
Agent efficiency/UI changes above. Live service configuration is unchanged.


## Query, execution and artifact delivery fixes (deployed 2026-11-24)

Query transport serializes non-finite values as explicit display text while
preserving typed SQL captures for computation. Wide result payloads disclose
column truncation separately from row truncation. Python syntax failures no
longer trigger silent execution of a trimmed prefix. Shell tools expose failed
execution/timeout status and publish only observed changed images from successful
runs. Both tools offload workspace hashing/image publication from the event loop.
Published image names are bounded and unique per publication, preventing two
owners' identical images from sharing an exclusive owner URL. Existing owned
image URLs/history remain supported. Browser export defers blob URL cleanup.

Validation: 61 backend tests passed (3 optional Docker cases skipped), 36 UI tests
passed, full web TypeScript passed. No paid model calls or live service changes.

Live read-only inspection identified an operational gap: /app/pilot/tmp, used
by the conversation Python/shell workspace and raw generated-file paths, is not
mounted as a persistent volume. /app/pilot/data and /app/pilot/message are mounted
and hold separate durable captures/published images. The DB-GPT overlay and
migration guide in docker/compose_examples prepare persistence at the existing
tmp path. Back up and copy current contents into the volume before recreation;
this runtime change has not been applied. Do not claim historical file paths
or Python variables are preserved by the presence of the artifact store alone.


## Deployment acceptance — 2026-11-24

The three source-change groups above are now deployed from DB-GPT commit
`870801391cfa825b5ed312ae61ab9e1b85338606`, replacing the previous c14452ef runtime.
Image ID pinned in VPS Compose:
`sha256:6b1474aca56da34457f6c5ae3922d7ed4e85d6f84ad01a0f9d2e3ddb7c97c33a`.
The rebuilt static UI and source manifest verified 3,006 files with zero
mismatches. Full TypeScript and static export (70 pages) passed. Build used a
2-CPU quota, 8 GiB memory maximum and up to 6 GiB swap; no new LLM calls.

VPS Compose now mounts external named volume `ai-agent_agent-workspaces` at
`/app/pilot/tmp`. The previous container had no tmp workspace files at the final
stopped-container backup: manifest and tar record zero files. No historical
working files were claimed as recovered. Existing data/message/MySQL volumes
were retained. The new volume's verification file kept its SHA-256 checksum
across the final webserver recreation. Backup/configuration baseline remains
server-side in `/etc/funnelmetry/ai-agent/backups/stability-87080139/`.

Only DB-GPT webserver was recreated. Container status running/restart count 0;
Admin/Analyst login and read smoke for chat, semantic, AWEL and scheduled tasks
passed. Public HTTPS provider/semantic reads and anonymous denial passed. This
supersedes the earlier awaiting-deployment and missing-tmp-mount statements;
browser rendering and paid model analytical acceptance remain separate. No KB
publication is required because business/semantic definitions did not change.

## Python result reuse and CSV provenance — source update 2026-11-24

The live two-prompt evaluation on `87080139` produced valid September CSV
aggregates and one rendered chart, but the analysis was stopped after repeated
post-plan work. Provider usage reported at least 766,023 tokens (one call lacked
usage); efficient Agent completion has not passed acceptance.

The pending DB-GPT source change returns bounded captured `REPORT_RESULT`
previews directly and through `session_evidence`, including labels/dates. The
progress index identifies artifact type, result availability and parents.
`pd.read_csv` reuse of a captured conversation CSV records an exact file/hash
parent instead of asking for a new SQL calculation. Unread/changed/foreign files
do not inherit previous provenance. Files/schema inspection alone does not
require a structured analytical result. Pagination bounds are published in the
tool schema; malformed Python and typed-date errors have specific repair hints.
Workspace exports through `output_path` avoid unnecessary approval cards;
external effects retain the existing approval rules. Skill guidance covers
result reuse, automatic PNG publishing and collision-free NULL representation.

These are orchestration/tool changes, not new semantic definitions or a new KB
release. No hard step limit, tool restriction, migration or live redeployment is
part of this fix. Offline regressions establish tool behavior; they cannot prove
that a paid model will always stop promptly or quantify the new token savings.
Targeted offline verification: 200 passed, 3 optional Docker tests skipped.
