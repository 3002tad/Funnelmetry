# Admin user-flow verification — 2026-11-06

The Dashboard UI/API run locally. Real read flows use the existing VPS data
without changing its accounts or source cursors. Account mutations are
intercepted inside a separate Playwright context; they never reach the API.

## User-facing flows

Sixteen Playwright checks passed:

- Sources: open details, Escape, empty source filter, reset, Feed/Cursor tab,
  connector filter/clear, mapping search.
- Investigation: normalization status/text filters, Trace from an actual outcome
  row with event ID prefilled, lookup of a nonexistent ID, UTM evidence section.
- Accounts: real account list, cancel create dialog, disabled self-role edit.
- Audit: action filter, UUID input validation, clear filters, refresh, expand
  retained changes.
- Sources, Investigation, Accounts and Audit fit a 390px mobile viewport.
- Browser fixtures: reject a short initial password, create, change role,
  lock/unlock confirmations, failed-write message while retaining the dialog.

## Real Kafka and Event Feed

A separate local operator monitor runs read-only Kafka admin calls and reads
Source Connector's existing readiness snapshot over SSH. It writes local files
that the API reads through explicitly injected monitoring probes. No SSH/Docker
actuator is added to the HTTP routes. The default production probes are unchanged.

- Eight configured consumer group/topic pairs return `OBSERVED`, including
  `funnelmetry.journey.resolved.v1` for the funnel processor.
- Source Connector returns READY and a validated Feed lineage/cursor snapshot.
- Playwright verified all eight Kafka rows in Pipeline and the real Feed snapshot
  in Sources. These checks used actual API responses, without mocked data.
- This does not inject a new source event or demonstrate ingestion of new data:
  an empty last poll is a valid snapshot and is not proof that history is empty.

Evidence scripts/results are local under `.tooling/`; credentials are read into
memory only, never printed, bundled, saved in fixtures or committed.

Controller/Swarm fault-injection acceptance is recorded separately; policy unit
tests and browser tests alone do not prove live automatic scale/recovery.

## Controller trial outcome and cleanup

The isolated real Swarm trial verified manual handoff/drain of 600 synthetic
records with 600 unique canonical records, 600 unique outcomes and no quarantine.
Automatic scale-up 1→2 was observed with `SUSTAINED_BACKLOG`. Under the fixture's
experimental 0.05 CPU worker limit, a worker subsequently reported
`INVALID_PRODUCER_EPOCH`; two tasks had only one consumer member. The controller
held instead of scaling down with unverified readiness. Full automatic 1→2→1
acceptance was therefore not achieved.

Level-2 testing encountered fixture setup issues (unsupported tmpfs shorthand,
then uncommitted empty-partition offsets) and was stopped at the user's request.
No completed automatic recovery acceptance is claimed.

At the user's cleanup request, all disposable fixture stacks/volumes were
confirmed absent on the VPS. Local trial state/audit directories, scratch
browser tests/results/screenshots and fault-injection scripts were removed.
The completed-run observation path was removed from the local API launcher.
Existing database demo data, repository tests, application code and real
read-only monitoring used by the local UI were retained. No database delete,
truncate, migration or seed command was executed for cleanup.
