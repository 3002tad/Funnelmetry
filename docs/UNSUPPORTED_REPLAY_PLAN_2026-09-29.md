# Unsupported browser events: dry-run and replay plan

## Execution completed (2026-09-29 local)

Bounded operator replay committed exactly 41 original raw messages in one Kafka
transaction with a separate transactional producer. Confirmed input fingerprint:
`38c7862a65dc4988e753c3b3eb66555d987b1043aff018b16cbc4a3d8f9cf3b5`.
Preflight found cursor 358 and no maturity finalizations. PostgreSQL backup
`runtime/backups/before-browser-replay-20260929.dump` has a readable custom archive
index (restore not tested). Private identity audit stored at
`runtime/backups/browser-replay-manifest-20260929.json` (Git-ignored; no raw payload).

Exact manifest-ID SQL verification after commit:
- expected 41, canonical 41, journey applications 41, KPI applications 41;
- latest normalized outcomes matching expected canonical IDs: 41;
- medusa-reference latest outcome totals: 309 normalized, no unsupported group;
- connector cursor remains 358; old outcome rows were not deleted.

This closes the 41-event recovery, not all system functionality or proof of every
historical KPI semantic. UI interaction was not tested in this recovery operation.
The script defaults to dry-run, requires the exact fingerprint for writes and uses
an exclusive audit-file creation guard. After ambiguous errors inspect broker/DB
and audit before retry; do not remove the guard file to blindly resend.

The remaining sections retain the pre-execution plan and validation history.

## Verified evidence

Read-only inspection matched all 41 latest `unsupported / mapping_not_found /
unmapped-v1` outcomes to retained Medusa Feed records with schema 1.0 and producer
browser_sdk. Each original ingress receipt was found; reconstructed ingestion ID
matched the persisted receipt and original received_at was retained.

The deployed canonical normalizer dry-run accepted all 41 using
`medusa-browser-schema1-catalog-v2`:

| Canonical event | Count |
|---|---:|
| behavior.page_viewed | 11 |
| behavior.scroll_depth_reached | 19 |
| promotion.banner_impression | 2 |
| behavior.product_viewed | 5 |
| checkout.started | 4 |

Two normalizations produced identical canonical IDs. No Kafka/DB writes, cursor
change or historical repair has been performed. This is not proof of downstream
idempotency or maturity/finalization behavior for these late events.

## Tools and safe usage

`workers/source-connector/src/inspect-unsupported.mjs` defaults to metadata-only.
`--normalizer-input` emits sensitive raw records **only for direct piping** to
`workers/canonical-normalizer/src/dry-normalize-stdin.mjs`; never redirect to logs,
chat or committed files. The consumer emits aggregates only and uses deployed
mapping configuration. Producer requires complete bounded Feed scan and original
receipts; consumer rejects wrong schema, more than 10000 messages or input >32 MiB.
Both paths preserve Feed lineage; retention gaps fail closed.

## Required before actual replay

Downstream verification update: the isolated PostgreSQL suite now includes a
separate schema1 browser journey (product/cart/order/delayed checkout). It reaches
four steps and CONVERTED. Re-normalizing and applying all events in reverse order
returns duplicate ledger/journey statuses, unchanged canonical/journey/funnel/KPI
application counts and byte-equivalent KPI rows. This is synthetic DB integration,
not a Kafka transactional replay test or proof for every real journey topology.
Twelve funnel evaluator/late-conversion unit tests also passed. Read-only demo
inspection found zero maturity-finalization and zero late-conversion records at
inspection time; recheck immediately before replay. The 41 real events remain
unreplayed. No changes to source configuration, AI or business history.

1. Snapshot exact candidate identities/old outcomes and approved mapping version;
   abort if candidates or feed lineage changed. Keep manifest in ignored private
   runtime storage; no raw payload in repository.
2. Back up PostgreSQL and record current cursor/checkpoint and projection counts.
3. Verify canonical ledger, Journey, Funnel and KPI duplicate/late-arrival behavior
   using the same mapping; inspect maturity/finalization consequences explicitly.
4. Use a dedicated bounded operator replay path and producer identity, not cursor
   reset or normal connector transactional producer. Preserve original receipts,
   source event IDs, event times and raw ingestion IDs. Do not delete old outcomes.
5. Publish only pinned candidates and track each broker acknowledgement. On
   interruption, inspect acknowledged IDs before retry; never mark complete based
   only on producer success.
6. Verify all candidates have new normalized outcomes, one intended canonical
   identity per event/mapping and downstream projection applications. Re-run the
   same bounded replay to prove no double-counted effects in an isolated test first.

Rollback is not deletion of canonical rows: pause replay and preserve audit, then
use the reviewed snapshot/rebuild procedure if semantic/projection errors appear.
No automatic replay button is authorized by this diagnostic report.
