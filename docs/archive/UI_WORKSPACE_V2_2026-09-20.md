# Workspace V2 — navigation foundation

> ARCHIVE — implementation snapshot on 2026-09-20, not the current UI capability list. See [documentation index](../README.md) for later work. Code paths below are relative to the repository root.

Scope: Master v0.3.12 §23. First migration increment, not full UI acceptance.

- Grouped Data Analyst and Admin navigation; only explicitly granted existing permissions show screens. Combined permissions can show both bundles.
- Existing live Overview, Funnels, Journeys, Events, Data Health, Chat, System Health, Sources and Users routes retained. Existing page implementations are not upgraded by renaming navigation.
- Planned modules have explicit unavailable screens with no fetch, model calls, metrics, or mutations. `pipeline.monitor` only grants viewing these admin placeholders, not future governance/write permissions.
- Products no longer serves mock analytics. `/insights` redirects to unavailable Findings. Original preview components remain in source but are not routed.
- Chat remains a separate current tool, not an implemented Analysis Run / Evidence workflow. Evaluate capabilities remain absent.
- Removed the non-functional global search input. Existing page-local search is unchanged.

Not implemented in this increment: complete vi/en via react-i18next, per-account Light/Dark/System, Data Workspace execution, persisted runs/evidence/reports, metric/asset catalogs, expanded admin APIs, auto-healing controls or end-to-end UI acceptance. Existing pages still require migration.

Verification: `npm run build`; Node 22.6+ `node --experimental-strip-types --test test/navigation.test.mjs` in `apps/dashboard-web`. Tests cover menu capability filtering and module availability; they do not replace backend RBAC or browser interaction tests.
