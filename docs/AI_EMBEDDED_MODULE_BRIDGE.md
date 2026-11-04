# AI workspace bridge

The Pipeline shell owns the AI entry, navigation, theme and login. DB-GPT keeps
its existing Next.js screens, browser state, Agent APIs, tools and MySQL data.
Because these are separate frontend applications, the narrow bridge still uses
an iframe as its transport. The user sees one workspace: DB-GPT hides its
sidebar and home header when embedded, and Pipeline shows the AI module links.
This is a visual and navigation integration, not a claim that the two frontend
bundles have become one React application.

The existing Pipeline session handoff creates a host-only DB-GPT cookie. The
embedded page sends a `funnelmetry:ai-ready` message with its route to the
Pipeline origin. Pipeline validates the sender window and AI origin before
showing navigation. Theme and route messages from Pipeline are accepted only
from the configured Pipeline origin; the route must be in the DB-GPT allowlist.
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
