# Reconciliation Worker

Current foundation persists validated `reconciliation-manifest.v1` snapshots into PostgreSQL.

- snapshot metadata, normalized records and currency control totals are committed atomically;
- retry with the same `(source_id, snapshot_id)` and semantic manifest is idempotent;
- reuse of that identity with different content is rejected;
- evidence tables are append-only;
- raw source transport and credentials remain outside this worker.

This batch does not compare analytics state or repair projections yet. Those operations must consume only
closed, complete, record-level snapshots whose persisted capability allows record comparison/repair.

Apply migrations `001` through `010`, then run tests with:

```powershell
$env:TEST_DATABASE_URL = "postgresql://funnelmetry:funnelmetry-local@localhost:55433/funnelmetry"
npm test
```
