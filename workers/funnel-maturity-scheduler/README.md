# Funnel maturity scheduler

This worker polls PostgreSQL for due `IN_PROGRESS` and `CONVERTED` Funnel Instances and records maturity evidence.
Only one replica polls at a time through a session-scoped PostgreSQL advisory lock; standby replicas
retry leadership on every interval.

The repository derives maturity with `@funnelmetry/time-semantics-contract`, verifies the immutable
profile deadline and entry-event time authority, records append-only revisioned evidence, and treats
a repeated `evaluation_id` as idempotent only when its immutable request matches.

Apply migrations `001` through `010` before using it. Migration `007` and the repository provide an
atomic `IN_PROGRESS -> DROPPED` plus KPI snapshot transition, guarded by latest eligible maturity
evidence and a caught-up KPI projection.

The poller considers configured transition timeouts and `conversion horizon + late-arrival grace`,
uses bounded batches, and re-evaluates each candidate under the Funnel Instance row lock. Reference
profiles have no numeric finality policy, so the local runtime remains idle until a versioned profile
publishes explicit values.

Converted instances become eligible matured conversions only after horizon + grace when both entry
and representative conversion-event times are authoritative. Non-authoritative conversions retain
their observed status but are excluded from the final conversion/drop-off denominator.

Finalization is additionally gated by `MATURITY_SCHEDULER_FINALIZATION_ENABLED`. Migration `008` and
Funnel Processor preserve the finalized `DROPPED` projection and record qualifying strong-business-key
events separately as append-only late-conversion evidence.
