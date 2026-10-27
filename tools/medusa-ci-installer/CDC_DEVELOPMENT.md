# Medusa CDC installer profile — development contract

Status: **IN DEVELOPMENT / SHADOW ONLY** under DEC-135. Branch: `feature/cdc-medusa-v1` in both Streaming Pipeline and Medusa Reference. This document defines the intended installer behavior; no CDC runtime or CDC manifest schema is implemented yet.

## Ownership and inputs

- Extend the existing `medusa-ci-installer` and its `funnelmetry.integration.yaml` input with a versioned business-acquisition profile. The current manifest/subscriber profile remains the default until conformance and cutover are approved.
- Keep browser SDK, consent, and storefront server search/cart hooks installed in every profile. The backend order subscriber is the only source-code binding eligible for later CDC replacement.
- Inputs must identify the exact supported Medusa version/schema, approved source table/column set, Pipeline endpoint/network topology, secret references, snapshot policy, source owner, and rollback target. The manifest contains no DB password or replication token.
- Source-side artifacts and Pipeline-side artifacts have separate owners: source PostgreSQL settings/role/publication and optional Compose overlay versus Kafka Connect/slot ownership, raw topics, mapper, offsets, monitoring, and shadow projection.

## Required installer flow

1. `plan` validates the manifest and source version, inventories generated files and DB preconditions, and reports source footprint and rollback actions without changing runtime.
2. `apply` works only on a pre-created non-main integration branch. It generates/reconciles only installer-owned files, remains idempotent, and refuses partial/stale files it does not own. Privileged SQL and runtime deployment remain separately reviewed operator actions.
3. `verify` checks generated patch integrity, browser/server hook preservation, source/connector configuration, schema contract, and dry-run rollback. Later conformance must prove CDC transaction → business fact equivalence against native `order.placed`.
4. `rollback` reverses only installer-owned files. It must not drop a live replication slot, publication, raw topic, or credential until checkpoint/retention ownership and cutover policy authorize those changes.

## Acquisition stages

| Stage | Order fact authority | CDC output |
|---|---|---|
| Current/default | Native Medusa `order.placed` subscriber → `medusa.order_placed` | None |
| Shadow candidate | Native subscriber remains authoritative | Separate raw topics/projection; no canonical live conversion write |
| CDC primary candidate | CDC mapper after explicit conformance and cutover decision | Versioned source mapping, effect identity, rollback checkpoint |

The CDC mapper must distinguish snapshot `READ` records from new business occurrences and preserve raw change identity separately from the stable order-placement effect identity. If no database transition proves equivalence to the native event, the subscriber remains the order fact authority while CDC may supply entity state.

## First implementation gate

Before adding manifest fields or installer code, record Medusa 2.19.x schema/workflow evidence for `order`, `order_cart`, `order_item`, `order_line_item`, and `order_summary`; compare successful, failed, retry, and rollback checkout cases with the native subscriber and Query Graph total. Select a shadow environment and source DB permissions explicitly. The current VPS reference has PostgreSQL 15.19 with `wal_level=replica` and no replication slot; no change to that live database is implied by this document.
