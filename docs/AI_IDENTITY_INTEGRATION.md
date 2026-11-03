# DB-GPT identity integration

The Pipeline API exposes `GET /api/auth/ai-identity` as a building block for
the DB-GPT integration. It accepts an existing Pipeline bearer session, checks
the current account status, role and session version against PostgreSQL, and
returns only `actor.id` and `actor.role` for `super_admin` or `analyst`.
Responses are not cacheable. Unsupported roles are rejected; revoked, inactive,
missing and invalid sessions fail closed. Database failure returns 503.

The endpoint alone does not authorize DB-GPT APIs, tools, datasources,
scheduled jobs or stored objects. The fork's legacy identity fallback remains
in use when integration mode is disabled. Do not treat a client-provided
`user-id`, Cloudflare Access, or this endpoint alone as end-to-end authorization.

The DB-GPT fork includes `PipelineIdentityVerifier` and an experimental
request boundary enabled only when `DBGPT_PIPELINE_IDENTITY_URL` is set.
It verifies live sessions, removes client-supplied identity headers and passes
the verified actor to DB-GPT. The in-progress policy grants reviewed shared
Dashboard, SQL editor, conversation, the existing ReAct/Knowledge Agent routes,
skill and reviewed Knowledge Base endpoints to both roles, with model,
datasource and connector administration reserved for Admin. Other unreviewed
operations remain denied. Do not
enable this experimental boundary in the existing deployment until the full
workflow and session handoff are verified. The current runtime continues using
its prior configuration.

The route policy no longer blocks the whole Agent. DB-GPT's skill script runner currently
starts a subprocess with a copy of the application environment, and its code
interpreter defaults to local execution. The existing Docker runtime requires
Docker daemon access; granting that access to the Agent would violate the
Funnelmetry tool boundary. The user chose to defer a separate constrained
execution environment for now. The Agent tool pack has not been changed by
this policy edit, so admitting the routes does not establish a safe execution
boundary for those tools. The optional identity mode remains disabled in the
existing standalone deployment. Do not represent this route change as a
completed end-to-end Agent integration or enable it with the current local
script runtime.

In integration mode `/images` is denied because that static mount has no
actor/owner check. An authenticated image route remains to be implemented.
See [component authorization inventory](AI_COMPONENT_AUTHORIZATION_INVENTORY.md)
for the reviewed boundaries and outstanding enforcement.

The experimental analytical-source policy is configured with
`DBGPT_PIPELINE_ANALYTICAL_SOURCE`, `DBGPT_PIPELINE_ANALYTICAL_DB_USER`,
`DBGPT_PIPELINE_ANALYTICAL_DB_HOST` and `DBGPT_PIPELINE_ANALYTICAL_DB_PORT`.
Agent database selection and Dashboard datasource checks reject missing or
mismatched configuration. The policy checks connection identity, not database
grants; the PostgreSQL role must separately be provisioned and verified as
read-only, and unreviewed SQL paths are not yet enabled.

The source now has an experimental browser session handoff: an optional
`VITE_DB_GPT_URL` entry sends the Pipeline bearer to the DB-GPT session
endpoint without putting it in a URL. DB-GPT validates it and issues a
host-only Secure/HttpOnly/SameSite=Strict cookie. The request boundary checks
the current Pipeline session for each API request, checks the configured
origin on cookie-authenticated mutations, and strips client identity headers.
Set `DBGPT_PIPELINE_UI_ORIGIN` and `DBGPT_PIPELINE_AI_ORIGIN` to the exact
HTTPS origins if enabling the boundary. Browser handoff through Cloudflare
Access, logout/session revocation and failure paths remain unverified.
The browser handoff rejects HTTP redirects. When Cloudflare Access requires an
initial login or its session has expired, the cross-origin handoff can fail
before reaching DB-GPT; the first-login and reauthentication flow must be
tested with the deployed Access policy before enabling the entry point.
Normal Pipeline logout clears the AI cookie on a best-effort basis; it does not
revoke an already copied bearer token. The separate Pipeline `logout-all`
operation revokes sessions through the account session version, and is exposed
as an explicit all-devices action in account settings. Do not describe normal
logout as server-side token revocation. Real-browser verification remains open.

Integration still requires end-to-end validation of the session bridge,
trusted identity propagation with direct access and spoofed headers blocked, enforcement for
admin and analyst at every execution path, object ownership/sharing, scoped
read-only datasource access, scheduled-job authority, audit and revocation
tests. Preserve DB-GPT's analytical tools and user workflows. Do not enable
or advertise integrated authorization until these paths have been tested.
