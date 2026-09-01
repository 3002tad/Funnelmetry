# @funnelmetry/time-semantics-contract

Pure Time Semantics Contract v1 primitives. The package validates profile-owned time policy,
calculates `conversion_deadline`/`finalization_at`, and classifies maturity and canonical-event
arrival without mutating Funnel Instances.

The package deliberately has no default timeout values. A profile with `null` horizon/grace is
`UNCONFIGURED`; callers must not turn it into a final drop-off. `SUSPECTED_DROPOFF` is a live signal,
while `MATURED` is a cohort/finality dimension and is not a replacement for `outcome_status` or
`quality_status`.

See [`../../docs/TIME_SEMANTICS_CONTRACT_V1.md`](../../docs/TIME_SEMANTICS_CONTRACT_V1.md) for clock,
boundary and compatibility rules.
