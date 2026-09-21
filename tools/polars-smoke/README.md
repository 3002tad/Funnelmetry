# Polars event-count smoke test

Operator-only prototype; not registered with AI chat. Does not change pipeline services,
database schemas, events, offsets or catalog. Requires running private-demo PostgreSQL
and Docker. First run downloads a Python image and pinned Polars dependency.

From Streaming_Pipeline, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/polars-smoke/run.ps1
```

Reads `medusa-reference` canonical rows in the last 24 hours by `occurred_at`,
bounded to 10,000 rows (overflow fails, never silently reports a partial success).
Only event-type strings leave PostgreSQL, in memory. No secrets or raw payloads are
exported. SQL and Polars aggregate the same statement snapshot, so new concurrent
events cannot create a false mismatch. Transaction is READ ONLY with a 10s timeout.
The Polars container has no network, a read-only filesystem and bounded resources.

Output reports per-type SQL/Polars counts, scope, grain and dependency version.
`PASS` means counts agree with nonempty input; `NO_DATA`, mismatch and overflow fail.
Stored canonical rows are not necessarily unique source events across mapping versions.
This is not proof of full pipeline health, delivery completeness, revenue or AI capability.
No automatic persisted evidence store or semantic/tool registry is implemented here.

Polars API: https://docs.pola.rs/api/python/stable/reference/dataframe/group_by.html
