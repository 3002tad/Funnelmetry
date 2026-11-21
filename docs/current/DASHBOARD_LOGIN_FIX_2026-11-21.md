# Dashboard login regression

The locally built policy UI omitted `VITE_DASHBOARD_API_URL`. The shared API module defaulted to `http://localhost:32000`, so users' browsers sent login requests to their own machines. This also invalidated the earlier browser acceptance attempts; they did not establish that saved credentials were wrong.

Changed the default to same-origin `/` and rebuilt with `VITE_DASHBOARD_API_URL=/`. Deployed only the web service using a local immutable image:

`funnelmetry-dashboard-web@sha256:dabcc27f298a5d44a41874d16285a4b1fd8fb62529a881ccca3ddf0914ca4645`

Validation: TypeScript/Vite build passed; Swarm rollout completed. Real Playwright login returned HTTP 200 from `https://analyst.entidi.io.vn/api/auth/login`, navigated to `/overview`, and made zero localhost API requests. No accounts, passwords, backend authentication rules or controller settings changed.

Future locally built artifacts must keep same-origin API routing and run a real browser login smoke test before declaring acceptance. Development against a separate API can use `DASHBOARD_DEV_API_TARGET` for the existing Vite proxy or an explicit `VITE_DASHBOARD_API_URL`.
