# Funnel maturity scheduler foundation

This directory currently contains only the PostgreSQL maturity-evidence repository. It is not a
runnable scheduler yet and does not mutate `funnel_instances` or emit KPI handoffs.

The repository derives maturity with `@funnelmetry/time-semantics-contract`, verifies the immutable
profile deadline and entry-event time authority, records append-only revisioned evidence, and treats
a repeated `evaluation_id` as idempotent only when its immutable request matches.

Apply migrations `001` through `006` before using it. Runtime polling/coordination, transition to
`DROPPED`, late-conversion evidence and KPI publication remain separate implementation gates.
