# Reference order v2 quality gate candidate — 2026-10-29

**Scope:** isolated CDC-10 clone on `kltn`; no live PostgreSQL, Pipeline binding,
funnel profile or Gateway change. This is a fail-closed probe for the new
mapper→sink chain, not production readiness or a CDC-12 cutover approval.

The reusable pure decision module compares source/mapper/sink order states,
baseline marker and digest, historical gap disclosure, connector/slot state,
finite WAL headroom, Kafka topic ends, mapper offsets and sink offset. The CLI
samples twice and can write a short quality lease only in a shadow Compose
project. The sink and verifier serialize on the sink offset row; a new sink fact
also invalidates the lease. The lease cannot prove zero delay between a source
commit and its arrival in Kafka, so continuous target-topology lag monitoring
and a production freshness budget are still required.

## Checks performed

- Local `python -m unittest ...test_reference_order_v2_quality.py`: 6 PASS,
  covering a reconciled prefix, lost slot, Kafka ahead of sink, source
  correction ahead of projection, hard-delete tombstone, and malformed
  duplicate/missing marker.
- Local `py_compile` for both new Python modules and `git diff --check`: PASS.
- Clone `funnelmetry_cdc_shadow_cdc10` started with
  `compose.cdc10-recovery-drill.yml`, because the preserved clone DB needs four
  replication slots. The base Compose limit of two caused an initial expected
  PostgreSQL startup failure; using the documented drill overlay restored
  clone startup. No live DB setting changed.
- `verify-reference-order-v2-quality.py` with epoch `cdc10-epoch2`, source ID
  `medusa-reference-shadow`, slot `funnelmetry_cdc10_epoch2`, connector
  `cdc-shadow-medusa-rebaseline-cdc10-epoch2`, prefix
  `cdc_shadow_medusa_epoch2` and fact topic
  `cdc_shadow_reference.order_recorded_state.v2.governed_probe` returned
  **`BLOCKED_BY_QUALITY`**. Mapper and sink digests matched at fact offset 712;
  the current source had 409 orders while both projections had 408. Slot was
  unusable, safe WAL size was null and connector was not running. A source
  mismatch was therefore visible instead of being silently treated as success.
- Re-run with `--write-quality` persisted
  `cdc10-epoch2|BLOCKED_BY_QUALITY|RECONCILIATION_FAILED`; the guarded
  `reference_cdc_v2_order_current_state_readable` view returned **0** rows.
- The clone services started for this probe were stopped; Docker volumes,
  Kafka topics, offsets and audit rows were retained.

## Remaining gate

This old epoch cannot receive `CURRENT_STATE_READY`: its slot is lost and the
source has advanced. A fresh epoch with a usable slot must pass the same checks
on the target network, with sustained source→read lag/WAL budget, correction,
cart/journey and profile conformance before CDC-11/12 can proceed. The CLI
currently targets the isolated Compose service names and is not a live quality
service. Its one-shot lease must not be used as a production monitor.
