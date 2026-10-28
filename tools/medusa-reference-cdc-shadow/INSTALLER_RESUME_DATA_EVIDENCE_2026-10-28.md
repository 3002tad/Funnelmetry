# CDC reference installer: checkout after rollback and apply — 2026-10-28

## Scope

Tested the approved `reference.medusa.order_recorded_state.v1` profile on VPS `kltn` in a fresh, isolated Compose project `funnelmetry_cdc_shadow_resume1`. The installer files came from immutable Pipeline commit `cc9d9d863e1a7e3ec3f28584f0d3c9d6789f3f6f`; the non-secret Medusa-generated profile had SHA-256 `f1ae4d39379887f77a2514e49c85bcfaf71736d8a83741b4d52b9f561dfb1ec1`. PostgreSQL was cloned read-only from live Medusa. Only the clone accepted the CDC publication and slot.

## Test sequence

| Checkpoint | Projected orders / outbox facts | Kafka records / unique facts | Sink next offset / topic end offset | Active current count | Result |
|---|---:|---:|---:|---:|---|
| After first synthetic checkout, before rollback | 1 / 1 | 1 / 1 | 1 / 1 | 1 | Mapper and analytical verifiers PASS |
| After `rollback → apply → verify`, before new checkout | 1 / 1 | 1 / 1 | 1 / 1 | 1 | No repeated fact or offset advance; both verifiers PASS |
| After second synthetic checkout | 2 / 2 | 2 / 2 | 2 / 2 | 2 | Exactly one new fact; both verifiers PASS |

At the final checkpoint, mapper reported zero pending outbox rows, zero unprocessed transaction END records, zero duplicate deliveries and zero state mismatches with the cloned Medusa DB. The analytical verifier compared mapper state and fact payloads with the sink, confirmed `SHADOW_ONLY` metadata v1.0.0, and found sink offset equal to the Kafka fact-topic end offset. Both checkouts returned distinct synthetic order IDs.

`install-reference.py verify` passed immediately after reapplication. The test project's containers and named volumes were removed, then the exact test directory containing private env files was removed. The earlier `funnelmetry_cdc_shadow` experiment remained running. Live Medusa PostgreSQL still reported `wal_level=replica`.

## Conclusion and limits

The pinned installer resumed its retained slot/Kafka state and delivered a new checkout fact after rollback and reapplication in this single-project shadow test. This closes the **post-resume data** gap from the [initial installer rehearsal](INSTALLER_RUNTIME_EVIDENCE_2026-10-27.md). It does not establish long-outage recovery, slot-loss handling, lag/load/WAL budgets, production source permissions, or equivalence to native `order.placed`. The test used the existing locally built Medusa backend image; its image digest was not pinned by this rehearsal.
