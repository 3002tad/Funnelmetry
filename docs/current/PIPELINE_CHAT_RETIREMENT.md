# Pipeline chat retirement

The Dashboard uses `/ai` (DB-GPT). `/chat` redirects there; `/workspace`
redirects to the analytics overview. The unused ChatPage and WorkspacePage
components have been removed.

Authenticated requests to `/api/chat` and `/api/v2/chat`, including their
subpaths, now return HTTP 410 with `pipeline_chat_retired` and replacement
`/ai`. Authentication and live-session validation still run first. Old AI,
Qwen and staging flags cannot reactivate these routes. The old routers are
no longer imported or mounted by the production app.

DB-GPT handoff and `/api/auth/ai-identity` remain unchanged. No accounts,
conversation history, vector data or database schema are deleted.

This is the endpoint-retirement phase, not a blanket deletion of analytical
libraries. Retained tool implementations/tests still reference `chat.use`;
legacy role definitions and shared analysis libraries remain for separate
dependency review. Do not interpret that capability as access to DB-GPT.

Rollback: deploy the previous API/UI images. No data migration is required.
