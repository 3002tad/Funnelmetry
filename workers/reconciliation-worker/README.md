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

Canonical events are not treated as a current Order/Payment/Revenue projection. The provider for that
projection and explicit correction records remain the next gate; this worker still performs no repair.

Apply migrations `001` through `011`, then run tests with:

```powershell
$env:TEST_DATABASE_URL = "postgresql://funnelmetry:funnelmetry-local@localhost:55433/funnelmetry"
npm test
```
