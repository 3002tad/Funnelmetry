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
