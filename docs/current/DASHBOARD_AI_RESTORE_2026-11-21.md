# Restore AI frontend integration

The policy/login UI rebuild omitted the existing public build argument `VITE_DB_GPT_URL=https://ai.entidi.io.vn`. The AI page therefore showed its missing-configuration fallback. This was a frontend deployment regression, not evidence that the model provider or user setup was absent.

Rebuilt with both `VITE_DASHBOARD_API_URL=/` and `VITE_DB_GPT_URL=https://ai.entidi.io.vn`. Deployed web image:

`funnelmetry-dashboard-web@sha256:16cf96a4e7431803b418374e3c3ed7adeda09eaab066ee75eab3a3e28285753c`

TypeScript/Vite build passed and rollout completed. Playwright verified dashboard login, iframe authentication handoff `/api/auth/funnelmetry/session` HTTP 303, AI root HTTP 200, missing-configuration message absent, and two chat editor controls available. The first check used a fixed loading delay and checked too early; a subsequent check observed the loaded controls. No prompt was submitted, so model response quality/tool execution is not part of this acceptance. Credentials, providers and authorization were unchanged.

Keep both public build variables in future production builds. Deployment artifacts are retained on VPS at `/srv/KLTN/dashboard-ai-restore-20261121`; local verification is `.tooling/ai-restore-result.json`.
