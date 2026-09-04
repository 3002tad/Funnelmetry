# Reconciliation Manifest Contract

Transport-independent internal contract for source-owned reconciliation snapshots.

The validator preserves the approved claim boundary:

- a closed, complete, record-level snapshot may enter record comparison and repair;
- a closed aggregate-only or incomplete snapshot may expose discrepancy evidence but is `DEGRADED`;
- an open snapshot remains `PROVISIONAL`;
- the contract does not recreate historical business events and does not define numeric quality thresholds.

`record_level_repair_allowed` only describes manifest capability. A later reconciliation worker must still
compare authoritative versions/watermarks and write explicit correction evidence before changing a current
projection.

`compareReconciliationEvidence` accepts an analytics current projection with the exact same
source/entity/coverage boundary. It computes missing, phantom, state and amount mismatch separately,
reports null rates for empty denominators and calculates currency deviation with decimal-safe arithmetic.
It never derives current state from the last canonical event.

`validateReconciliationAnalyticsProjection`, `hashReconciliationAnalyticsProjection` and
`hashReconciliationCoverage` provide the normalized identity used by the revisioned current-projection
provider. The coverage hash excludes records and `as_of`, so revisions of the same declared scope share
one serialized head.

Run:

```powershell
npm test
```
