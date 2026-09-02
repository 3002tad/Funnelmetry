# Time Semantics Contract v1

Status: **runtime contract candidate**. The mechanism follows approved Backbone decisions
DEC-045–DEC-048. Numeric values remain profile-owned and experimental until benchmarked; this file
does not promote them to an architecture default.

## Scope

This contract defines deterministic time calculations shared by a future maturity scheduler,
Funnel Processor, KPI Projector and Data Health. It does not start a scheduler, mutate a Funnel
Instance, choose timeout values or claim reconciliation.

## Clocks

- `occurred_at`: business/event ordering clock. It is authoritative only when
  `quality.time_basis=source_occurred`.
- `ingested_at`: arrival at Funnelmetry durable ingress and the clock used to classify late arrival.
- `observed_at`: explicit scheduler/evaluation wall-clock supplied by the caller; functions never
  read the machine clock implicitly.
- `entry_at`: authoritative occurrence time of the entry event and the origin of a Funnel Instance
  time window.
- `conversion_deadline = entry_at + conversion_horizon_seconds`.
- `finalization_at = conversion_deadline + late_arrival_grace_seconds`.

`normalized_at`, `persisted_at` and `processed_at` remain operational latency clocks. They must not
replace `occurred_at` for funnel ordering or `ingested_at` for ingress lateness.

## Policy activation

`conversion_horizon_seconds` and `late_arrival_grace_seconds` are configured together. When both are
`null`, time finality is `UNCONFIGURED`: the runtime may continue live projection but must not infer
`DROPPED` or publish a final conversion/drop-off denominator.

Session inactivity closes a behavior visit, not a journey. Transition timeouts are keyed by the next
step ID and may produce `SUSPECTED_DROPOFF`; they do not close the Funnel Instance.

## Boundary rules

| Condition | Classification |
| --- | --- |
| `observed_at <= finalization_at` | `PENDING`, unless a configured transition timeout has elapsed |
| transition timeout elapsed before finalization | `SUSPECTED_DROPOFF` |
| `observed_at > finalization_at` | `MATURED` |
| authoritative event occurred within horizon and ingested by deadline | `ON_TIME` |
| authoritative event occurred within horizon and ingested after deadline but by finalization | `LATE_ARRIVAL_WITHIN_GRACE` |
| authoritative event occurred within horizon but ingested after finalization | `TOO_LATE_FOR_FINAL_COHORT` |
| authoritative event occurred after deadline | `AFTER_HORIZON` |
| fallback/source-produced time | `NON_AUTHORITATIVE_TIME` |
| `ingested_at < occurred_at` | `CLOCK_SKEW_UNRESOLVED` until a skew policy is approved |

Deadline and finalization comparisons are inclusive for event admission: occurrence exactly at the
conversion deadline is within horizon and ingestion exactly at finalization is within grace. To
avoid racing that boundary, maturity begins only after finalization.

## Orthogonal states

Maturity is not stored in `outcome_status` or `quality_status` by this contract:

```text
outcome:  IN_PROGRESS | CONVERTED | DROPPED | TERMINATED | INVALID
quality:  PROVISIONAL | RECONCILING | RECONCILED | DEGRADED
maturity: UNCONFIGURED | PENDING | SUSPECTED_DROPOFF | MATURED
```

A future scheduler may change `IN_PROGRESS` to `DROPPED` only after `MATURED`, after verifying
eligibility and authoritative-time requirements. Reconciliation remains a separate quality/control
path. Late conversion must preserve the original horizon-bound KPI instead of rewriting it.

## Compatibility and next gate

The existing `funnel_profiles` columns represent horizon and grace. Migration `006` adds immutable
transition timeout policy and append-only maturity evidence; reference profiles still keep horizon
and grace `null`, so no current projection is finalized. Before runtime activation, the next gate
must define polling/coordination, atomic outcome/KPI handoff and late-conversion evidence.
