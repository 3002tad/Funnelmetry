# Integration and AI activation — 2026-09-12

User-approved scope: proceed with Medusa connectivity and AI. Provider choice:
Alibaba Cloud Model Studio/DashScope directly, Singapore, Qwen Flash. No OpenRouter.
This supersedes the earlier local-model assumption, not the Master authorization,
evidence provenance or prohibition on free-text business-state mutations.

## Implemented in this stage

### Latest: Chat V2 HTTP orchestration

`POST /api/v2/chat` now connects the provider to bounded Overview V2 evidence;
disabled unless DASHBOARD_ENABLE_QWEN=true. Checks active versioned session and
capabilities before export and response, limits per-account requests and concurrency,
exports numeric allowlist only and returns server-side evidence. No-evidence skips
the model. Generated text explicitly remains non-official and unverified. UI, live
calls, history and comprehensive answer evaluation remain pending. See AI README
for the current contract; earlier stages below describe historical state.

### Later progress: private bootstrap and AI foundation

Private Tailscale enrollment and Gateway loopback health now work; Tailnet HTTPS
certificates still require owner action. See infra/PRIVATE_INGRESS.md for runtime evidence.

Added standalone DashScope transport and permission-checked V2 Overview evidence helper.
Seven offline tests pass: config, request bounds, sanitized errors, no retry, response
validation, timeout/concurrency/cancel and live-account capability checks. No new Chat
route, UI, model call or business data export yet. `DASHBOARD_ENABLE_QWEN` is distinct
from old `DASHBOARD_ENABLE_AI`. See apps/dashboard-api/src/lib/ai/README.md.

The original stage/gates below remain historical planning context; provider foundation
is now implemented but live activation and authenticated orchestration remain pending.

- Opt-in private-ingress overlay and Tailscale Serve configuration.
- Empty bootstrap credential registries; no inherited E2E write/signing keys.
- Loopback-only Gateway, no Gateway/Postgres host ports, persistent Tailscale state.
- Ignored local runtime env and configuration-only regression checks.
- See `infra/PRIVATE_INGRESS.md`; no real Tailnet enrollment or event tests yet.

## Remaining activation gates

1. Local Tailscale auth key, correct ACL/HTTPS/MagicDNS, Linux TUN support.
2. Private health verified from the Medusa host, including access-denial checks.
3. Coordinated Medusa URL/HMAC binding update and signed-event acceptance test.
4. Review and integrate existing Relay/SDK/installer branch without overwriting local
   dashboard changes. Browser Relay delivery remains a separate acceptance path.
5. Add a DashScope provider with bounded requests, timeouts, redacted errors and tests.
6. Connect only authorized V2 evidence tools to AI; legacy Chat currently uses V1
   queries/Ollama and must not simply be enabled and claimed to be V2 AI.

## Alibaba configuration discovery (not activated)

Official documentation checked 2026-09-12 shows the Singapore OpenAI-compatible
base URL as `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`.
Copy the exact API endpoint from the user's Singapore workspace console rather than
guessing the WorkspaceId or switching regions. Keep DASHSCOPE_API_KEY backend-only.
The documented Flash family includes `qwen-flash`; confirm model availability in the
actual workspace before a billed smoke call. No API request or business data has
been sent to Alibaba during this stage. No UI, provider transport or AI route changed.

Sources: [Alibaba Model Studio overview](https://www.alibabacloud.com/help/en/model-studio/what-is-model-studio),
[supported model families](https://www.alibabacloud.com/help/en/model-studio/context-cache).
