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

The route policy admits the existing ReAct and Knowledge Agent routes for both
roles. Backbone DEC-148 (2026-11-03) defines the KLTN scope: trusted development,
testing and demo users; prompts guide behavior; backend/API/tool permissions
and source credentials determine actual authority. Backend identity/two-role
checks, secret/configuration protection and read-only analytical PostgreSQL
remain baseline. Additional per-tool gates are optional if time permits, not
a requirement to review every tool before completing the KLTN integration.

Dedicated execution runtimes, sandbox/container runners, separate workers or
Unix sockets and per-job containers are OUT_OF_SCOPE for the entire thesis.
Their absence is not an Agent deployment blocker or mandatory later backlog.
Keep native DB-GPT tools, skills and workflows. The current skill runner copies
the application environment and the code interpreter defaults to local
execution: arbitrary-code containment, protection against all file/secret
access and isolation between users are not certified. Do not add Docker control
or system administration privileges to the Agent. The optional identity mode
is still disabled in the existing standalone deployment; this scope decision
does not certify session handoff or end-to-end integration.

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

KLTN integration acceptance verifies the session bridge, trusted identity,
Admin/Analyst restrictions on the used APIs, the read-only datasource and the
selected analytical workflow. Existing unimplemented features retain their
documented status; a full tool-by-tool execution-gate review and a dedicated
runtime are not prerequisites under DEC-148. Preserve DB-GPT's analytical tools
and user workflows, and report the actual tested coverage and limitations.
