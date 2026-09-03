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

Run:

```powershell
npm test
```
