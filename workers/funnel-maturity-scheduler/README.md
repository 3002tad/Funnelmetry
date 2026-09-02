# Funnel maturity scheduler

This worker polls PostgreSQL for due `IN_PROGRESS` Funnel Instances and records maturity evidence.
Only one replica polls at a time through a session-scoped PostgreSQL advisory lock; standby replicas
retry leadership on every interval.

The repository derives maturity with `@funnelmetry/time-semantics-contract`, verifies the immutable
profile deadline and entry-event time authority, records append-only revisioned evidence, and treats
a repeated `evaluation_id` as idempotent only when its immutable request matches.

Apply migrations `001` through `006` before using it. Transition to `DROPPED`, late-conversion
evidence and KPI publication remain separate implementation gates.

The poller considers configured transition timeouts and `conversion horizon + late-arrival grace`,
uses bounded batches, and re-evaluates each candidate under the Funnel Instance row lock. Reference
profiles have no numeric finality policy, so the local runtime remains idle until a versioned profile
publishes explicit values.
