# DB-GPT component authorization inventory

Scope: integration under Pipeline's `super_admin` and `analyst` roles.
The optional identity boundary remains disabled in the live deployment. This
inventory describes source inspection, not an end-to-end security claim.

Backbone DEC-148 (2026-11-03) limits KLTN acceptance to trusted development/demo
users and the used application workflows. Prompts guide behavior; backend and
source credentials determine authority. Additional per-tool execution gates
are optional if time permits. A dedicated runtime/sandbox/container runner,
separate worker/Unix socket or per-job containers are OUT_OF_SCOPE for the
entire thesis and are not deployment blockers or mandatory later tasks.

| Component | Current evidence and remaining work |
| --- | --- |
| Session and HTTP boundary | Pipeline validates the bearer against current account and session version. Source includes cookie handoff and frontend identity bootstrap; Cloudflare Access and real-browser logout/revocation are not yet verified end-to-end. |
| Dashboard | Both roles can list, read, create, edit, validate, preview, refresh, copy, archive, restore and export dashboards, and manage personal folders. The existing service checks actor access and the configured datasource. Publication, shares, covers, schedules and collaboration remain closed. |
| Model/provider | Admin model/provider routes are admitted; the common boundary records actor, action group and response status without bodies, query strings or secrets. Analyst can list usable model names. |
| Skills | Analyst list/detail are admitted in the common workspace; unsafe external symlink traversal is rejected. Upload, import and execution need further review. |
| Chat, conversations and Agent | Conversation list, query, history, clear and delete use the verified actor; clear/delete check ownership before mutation. Reopening another actor's Agent conversation is rejected. ReAct and Knowledge Agent POST routes are admitted for both roles, retaining the existing Agent tool pack. The skill runner copies the application environment and executes as the DB-GPT process user; previous VPS inspection found root with sensitive environment variables. Under DEC-148 this is a recorded limitation for trusted-user KLTN use, not a dedicated-runtime deployment blocker. Arbitrary-code containment is not certified. |
| Datasources, SQL and editor | Analyst sees only the configured analytical source, without credentials; Admin datasource APIs are role gated and redact secret parameters in integration mode. Editor query and Dashboard use the configured PostgreSQL identity and are subject to the database account's grants. On the VPS the role has no table write privileges and `EXPLAIN INSERT` is denied after setting the transaction to read-write. Agent source selection uses the same policy; ReAct and Knowledge Agent routes are admitted for both roles. This does not certify all analytical paths end-to-end. |
| Knowledge Base | Both roles can create spaces, list/query them, add/sync TEXT documents, upload/sync DOCUMENT files, edit document names/questions and chunks, and delete named documents in a common workspace. Sync checks the document's space and type; files must belong to the knowledge bucket and have matching stored space metadata. URL and other document sources and remaining mutation routes still require review; there is no claim of per-user knowledge-space isolation. |
| Connectors and model credentials | Connector management routes are admitted for Admin and audited by the HTTP boundary. Analyst can list active connector identities for the picker; the response omits connector configuration and ownership fields. Agent-side invocation still needs separate verification before enabling Agent execution. |
| Scheduled tasks and AWEL | In Pipeline identity mode the shared scheduled-task runner rejects scheduled and manual replay until execution authority is implemented. Existing jobs cannot silently inherit global Admin. |
| Files and images | Session-file upload, list, preview, download and delete use the verified Pipeline actor and owner/session-scoped registry; the client-supplied owner is ignored in integration mode. The public `/images` static mount lacks such a check and is denied in integration mode. Other generated artifact paths still need review. |
| Dashboard sharing and public routes | Define explicit public-link semantics and prevent private data, datasource access or editing via a share token. The experimental boundary currently denies these routes. |
| Other serves and endpoints | Inventory mounted routes including model, evaluation, app, file and legacy routes; unknown routes remain denied until reviewed. Check WebSocket and SSE paths, not just HTTP calls. |

Before claiming KLTN integration complete, verify browser session handoff,
the Admin/Analyst API restrictions and the read-only source in the selected
analytical workflow. Report actual coverage; do not turn every remaining
inventory item into a prerequisite. Additional execution gates remain optional
and dedicated execution infrastructure is excluded by DEC-148.
