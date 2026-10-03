# Qwen foundation — 2026-09-12

Optional bounded Polars chat prototype: [POLARS_CHAT.md](POLARS_CHAT.md).
The overview-only descriptions below apply when `DASHBOARD_ENABLE_POLARS=false`.

User-approved provider: Qwen Flash, Alibaba Cloud Model Studio/DashScope directly,
Singapore. This supersedes the provisional local model candidate in Master §16.4,
not §16/§17 evidence, language or authorization rules.

## Implemented, disabled by default

`createDashScopeClient(env, fetchImpl)` is an independent server-side transport.
The V2 Chat router creates one client per app. `DASHBOARD_ENABLE_QWEN=false` by default;
disabled mode needs no API key, no DB, no Qdrant and makes no network requests.
It is separate from `DASHBOARD_ENABLE_AI`, which still enables the old V1/Ollama Chat.
Do not turn on that old switch to use this provider.

Template: `runtime/qwen.env.example`; the real `runtime/qwen.env` is ignored by Git.
This file is not auto-loaded by npm start. When wiring the provider, explicitly load
its environment into the backend process, never the frontend build.

- Model fixed to `qwen-flash`; no silent model/provider fallback.
- Base URL required when enabled. Only HTTPS Singapore endpoints accepted:
  `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` or
  `https://<workspace-id>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`.
  Official docs recommend the workspace-specific URL and state the old domain still works.
- POST chat/completions, text-only, no stream, no tools, non-thinking mode,
  temperature 0.2, max_tokens 1024. API key is closure-private, not in returned client metadata.
- Timeout default 15s (100–60000ms), includes body reading; caller cancellation supported.
- At most 16 messages/64KiB request, 256KiB response, two concurrent calls per client
  instance. Reuse one client in the backend; not a distributed rate limit/budget control.
- No retry, redirects rejected. Sanitized error codes only; upstream bodies and raw
  exceptions are not returned/logged. Truncated/tool-call/malformed responses fail closed.
- Successful result: `{text, model, provider, region}`. Text remains untrusted model
  output; future UI must render safely. Transport does not enforce business truth.

`loadOverviewEvidence` rechecks active account/session version and chat.use +
analytics.read in PostgreSQL before calling the existing V2 getOverview repository.
Accepts only source_id/from/to, an explicit cohort of at most 90 days, and caps serialized
evidence at 32KiB. Admin/legacy viewer denied; Analyst/Staff permitted by current bundles.
No SQL, tool name, role or mutation comes from the model. No network call is made here.
The future route must supply the authenticated actor and production DB/repository;
this helper is not a substitute for JWT verification at the HTTP boundary.

## Chat V2 HTTP contract

`POST /api/v2/chat`, authenticated bearer token, active/versioned session and
chat.use + analytics.read. Analyst/Staff allowed; Admin denied by default. Separate
from `/api/chat` and its legacy AI feature switch. Request example:

```json
{"message":"Giải thích các số liệu này","source_id":"medusa-reference","from":"2026-09-01T00:00:00Z","to":"2026-09-02T00:00:00Z"}
```

Only these four fields are accepted, no query params, message <=2000 characters,
explicit ordered cohort <=90 days. No client system prompt, history, tool or SQL.
Only the existing Overview V2 repository is available. Export to Alibaba consists
of the user question, cohort, synthetic profile-N references and allowlisted numeric
fields; profile labels, account identifiers and raw events are not exported. The user
question is sent as entered and can contain personal data: live use needs appropriate
user notice and an explicit decision about sensitive content; no PII detector exists.

Empty overview returns `{status:"no_evidence", answer:null, official:false, evidence:[...]}`
without a model call. Successful generation returns answer/model, status generated,
official false, answer_verification NOT_VERIFIED and server-provided evidence with
retrieval time, scope, data and limitations. Evidence is the data used, **not** proof
that every generated claim is correct. References in generated prose are not verified.
Do not render model text as raw HTML. UI not connected in this change.

Session/JWT expiry and live capabilities are checked at entry, immediately before
model egress and before response. Revocation cannot recall data already sent externally.
Disconnected HTTP clients abort the model request. Default 20 valid attempts/account/minute
(configurable via `DASHBOARD_CHAT_REQUESTS_PER_MINUTE`, integer 1..120, shared by chat and structured order summary)
and two active Chat requests per app; state is in memory, reset on restart and not
shared across replicas. Failed/no-evidence attempts count. This is not a billing cap.
Responses use Cache-Control no-store. Codes: 400 invalid request, 401 session failure,
403 forbidden, 429 rate limit/busy, 503 disabled/unavailable, 504 provider timeout.
Database read errors fail closed; DB operations themselves rely on the database/pool
timeout policy, not the provider timeout. No chat history or prompt/response audit is saved.

## Remaining before live activation

Do not equate raw output with official insight/recommendation or allow free-text
state changes. Offline tests cover HTTP authorization, evidence label injection not
exported, quotas, revocation before/after egress and sanitized failures. They do not
prove resistance to every prompt injection or response correctness. Next add UI,
review data-export consent and evaluate output quality, then an explicitly approved,
bounded live smoke call using the user's Singapore key. No live call made in this stage.
RAG retrieval, conversation persistence, recommendation-linked chat, UI and evaluation
benchmarks are not implemented by this foundation.

Verification: `node --test test/dashscope.test.js test/ai-evidence.test.js test/chat-v2.test.js`, eight tests,
mock fetch and mock evidence, container network disabled; not a live-provider benchmark.

Official reference checked 2026-09-12:
[DashScope Chat API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions).
