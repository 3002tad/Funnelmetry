# Bounded event-count tool (prototype)

Enable explicitly with `DASHBOARD_ENABLE_POLARS=true` in the Dashboard API process.
Default false preserves overview-only chat. Qwen must also be enabled separately.
Runtime requires `python3` + `polars==1.34.0`; private demo image:
`apps/dashboard-api/Dockerfile.polars` (workspace and existing node_modules mounted
read-only at `/workspace`, same env files as the existing private API).
No Docker socket or model-generated SQL/code is used by the API.

Metadata: `event-count-tool.js`, `eventCountMetadata` (id/version/grain/measure/time
basis/limits/permissions). This is a code-owned registry seed, not a database-backed
semantic catalog or Admin metadata editor.

Execution: authenticated request → current capability check → Qwen JSON selection
(`event_counts`, `overview`, `unsupported`) → strict validation → one read-only
operation → capability recheck → Qwen explanation → capability recheck → evidence UI.
This uses the existing text-provider interface with strictly validated JSON planning,
not DashScope native function calling. At most two provider calls per request, no loop.
Planner can narrow the UI window with last_hours (1..2160), never expand it or change
source. An explicit window outside the UI scope fails with 400. No free-form filters.

Event-count query is parameterized and READ ONLY, timeout 10s/lock 2s, max 10,000 rows.
Overflow fails with 422, never silently samples. Child Python gets only event-type
strings, no DB or Qwen credentials, fixed script, 10s timeout and 64KiB output cap.
The fixed Polars script is trusted local code, not a sandbox for arbitrary Python.
Node independently verifies each returned group count. No raw payload or identity
is sent to the provider. Event types, aggregate counts, source, time window and the
user question are sent to Alibaba for explanation; existing UI notice applies.

Grain is stored canonical rows, not deduplicated source events or customers. Includes
fallback event times, does not establish source completeness, revenue or payment
success. Evidence is deterministic; model prose is NOT_VERIFIED and not official.
No persisted analysis-run ledger, native tool-call API, RAG or general agent loop yet.
Old overview-only descriptions in README apply when this feature flag is false.

Offline verification:
`node --test test/event-count-tool.test.js test/chat-v2.test.js test/dashscope.test.js test/ai-evidence.test.js`

Demo question: “24 giờ qua có bao nhiêu event, chia theo loại?”
Expand the evidence panel to see actual source/window and the Polars count table.
