# DB-GPT: complex analysis evaluation, 2026-11-04

## Run

- Analyst UI, deployed DB-GPT image `8a5f7939`; model `qwen3.5-flash`.
- Conversation: `496f0fa7-4d9b-431b-bc16-89d4ce600ce9`.
- Selected: `funnelmetry_handoff`, skill `funnelmetry-ecommerce-analysis`, and KB `funnelmetry-offer-1-0-0-110b3588e9fa`.
- Task: explore 30 days of search, product views and cart activity; compare with order state and the current catalog; report evidence, limits and at most three priorities. Explicitly distinguish order state from successful orders, payments and revenue.
- Recorded execution snapshots run from 14:44:09 to 14:44:51 UTC; this is the recorded step span, not a precise end-to-end latency measurement.

## Usage and execution

The authenticated `/api/v1/observability/usage` response reports provider usage for this conversation as complete: **20 calls, 248,056 prompt tokens, 5,330 completion tokens, 253,386 total**. Provider billing and any other concurrent usage were not independently reconciled. The user reported 483,038 tokens available before the run; subtracting this run gives an illustrative 229,652, not a verified remaining balance. No second model run was made.

The saved execution snapshots include 13 SQL-query steps. Repeated work includes the catalog summary (steps 002, 009, 019), behavior schema (005, 016, 017), order schema (007, 014) and overlapping behavioral summaries (006, 008, 010, 018). These observations suggest duplicate exploration contributed to cost; no per-cause token attribution or before/after saving is established. No KB retrieval step was visible among the saved execution snapshots; selecting a KB does not establish retrieval. Trace completeness and any automatic retrieval outside these snapshots remain unverified.

## Answer assessment

The answer gave sources and quality caveats, avoided a computed conversion rate, and correctly stated that `order_recorded_state` does not itself prove order success or payment. Snapshot 019 returned 104 products with `REFERENCE_CURRENT_ONLY`. Snapshot 018 returned 2 search events, 4 `cart.item_added` events and 186 historical `order.placed` events, all `UNVERIFIED`; those are event counts and must not be presented as 186 verified completed orders. Snapshot 015 returned 187 rows grouped under `CURRENT_STATE_READY` and `historical_gap_status=INCOMPLETE`; that gap describes coverage and does not establish that each of 187 orders has an individual gap. The answer's wording about “187 orders with a historical gap” and labeling 186 events as orders is therefore misleading.

The recommendation to link events using `canonical_event_id` was not justified: an event identifier is not by itself a cross-event customer or journey correlation key. The answer also made broad claims that no actual price/inventory data exists and that behavioral metrics cannot support any decisions; the displayed evidence does not establish those general claims. Verify available assets, scope and quality before making them. The answer did not supply a meaningful trend or three evidence-backed business opportunities, so this run does not pass complex-analysis quality acceptance. SQL result values above were compared with saved tool snapshots, not independently rerun against the database.

## Follow-up

Inspect the trace and prompt/tool orchestration offline for repeated schema and summary queries, effective result reuse, task-progress/termination behavior and unnecessary model calls. Inspect whether and when the selected KB was actually retrieved. Improve evidence-to-claim grounding and time/grain/correlation semantics while preserving the Agent's ability to choose tools and write analytical SQL. A later paid comparison should use the same task and conditions, track complete provider usage and verify numerical and explanatory quality. Do not claim savings against the earlier simple product-count run: its task differs.
