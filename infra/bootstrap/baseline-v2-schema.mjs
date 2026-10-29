// Pinned fresh-database baseline. CDC candidate migrations are applied by
// cdc-candidate-migrations.mjs to an existing DB after separate review.
export const baselineV2SchemaNames = Object.freeze([
  '001_canonical_ledger.sql',
  '002_journey_projection.sql',
  '003_funnel_projection.sql',
  '004_kpi_projection.sql',
  '005_ingress_telemetry.sql',
  '006_funnel_maturity.sql',
  '007_maturity_finalization.sql',
  '008_late_conversion.sql',
  '009_matured_conversion.sql',
  '010_reconciliation_evidence.sql',
  '011_reconciliation_comparison.sql',
  '012_reconciliation_current_projection.sql',
  '013_ingress_coordination.sql',
  '014_ingress_send_guard.sql',
  '015_ingress_send_attempts.sql',
  '016_ingress_producer_generations.sql',
  '017_ingress_claim_recovery.sql',
  '018_kpi_handoff_evidence.sql',
  '019_source_connector_cursors.sql',
  '020_product_reference.sql',
])

export function baselineV2SchemaFiles(root = '/workspace') {
  return baselineV2SchemaNames.map(name => `${root}/infra/postgres/v2/${name}`)
}
