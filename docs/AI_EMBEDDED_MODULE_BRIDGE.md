# AI workspace bridge

The Pipeline shell owns the AI entry, theme and login. DB-GPT keeps its
existing Next.js screens, sidebar navigation, browser state, Agent APIs, tools
and MySQL data. Because these are separate frontend applications, the narrow
bridge still uses an iframe as its transport. On `/ai`, Pipeline hides its own
sidebar and offers a return link; DB-GPT's sidebar navigates all AI modules.
DB-GPT hides only its duplicate home header and hero branding when embedded.
This is a visual and navigation integration, not a claim that the two frontend
bundles have become one React application.

The existing Pipeline session handoff creates a host-only DB-GPT cookie. The
embedded page sends a `funnelmetry:ai-ready` message to the Pipeline origin.
Pipeline validates the sender window and AI origin before sharing its theme.
Theme messages are accepted only from the configured Pipeline origin.
Messages contain no token or provider key. DB-GPT continues to verify the
Pipeline session and Admin/Analyst role on API requests.

Set `NEXT_PUBLIC_FUNNELMETRY_IDENTITY=1` and
`NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN=https://analyst.entidi.io.vn` when building
the DB-GPT static UI. A direct visit to the AI hostname retains the standalone
DB-GPT layout. Pipeline Dashboard Web still needs `VITE_DB_GPT_URL`.

The old Pipeline AI Chat item is removed and `/chat` redirects to `/ai` for
bookmarks. This retires its browser route only; other Pipeline pages still use
the shared evidence components under `features/chat` and some backend chat
endpoints. Those consumers need separate inspection before any backend removal.
