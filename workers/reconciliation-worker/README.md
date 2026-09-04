# Reconciliation Worker

Current foundation persists validated `reconciliation-manifest.v1` snapshots into PostgreSQL.

- snapshot metadata, normalized records and currency control totals are committed atomically;
- retry with the same `(source_id, snapshot_id)` and semantic manifest is idempotent;
- reuse of that identity with different content is rejected;
- evidence tables are append-only;
- raw source transport and credentials remain outside this worker.

The repository also compares a caller-supplied, identically scoped analytics current projection and stores
revisioned `missing`, `phantom`, `state mismatch` and `amount mismatch` evidence. Count rates preserve empty
denominators; currency totals use exact decimal arithmetic. Aggregate-only/incomplete snapshots remain
`DEGRADED` and never expose record-level metrics or repair capability.

Canonical events are not treated as a current Order/Payment/Revenue projection. `recordCurrentProjection`
records an explicitly supplied read model as an immutable revision and advances one head per exact
source/entity/coverage scope. `recordComparison` may then load that head instead of receiving an ad-hoc
projection.

`repairComparison` is allowed only for a current, mismatching, closed/complete record-level comparison.
It rejects stale, reconciled and degraded evidence, writes one append-only correction record per affected
entity, creates a new authoritative projection revision and advances the head atomically. Current-snapshot
repair never creates a historical CanonicalEvent or rewrites funnel history.

Projection heads cannot move to an older `as_of`. For an existing entity whose source/analytics versions
differ, repair additionally requires comparable `updated_at` values and rejects an older authoritative
record; an undeclared version ordering is not guessed.

After a later comparison, `verifyRepair` stores denominator-safe `repair_success_rate` and whether the
whole current projection converged. Verification is evidence, not an invented quality threshold.

Apply migrations `001` through `012`, then run tests with:

```powershell
$env:TEST_DATABASE_URL = "postgresql://funnelmetry:funnelmetry-local@localhost:55433/funnelmetry"
npm test
```
