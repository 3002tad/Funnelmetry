import { STAGE2_TABLES } from './reference-cdc-offer.js';

// Recheck both quality leases after the read-only projection snapshot closes.
export const LEASE_RECHECK_SQL = `SELECT b.coverage_epoch_id AS catalog_epoch_id,
  c.verified_at AS catalog_verified_at, c.valid_until AS catalog_valid_until,
  s.coverage_epoch_id AS stage2_epoch_id,
  s.verified_at AS stage2_verified_at, s.valid_until AS stage2_valid_until,
  s.source_row_counts AS stage2_source_row_counts,
  b.state='ACTIVE' AND c.status='PASS' AND c.snapshot_complete
    AND c.valid_until>clock_timestamp() AND c.source_digest IS NOT NULL
    AND c.source_digest=c.projection_digest
    AND c.source_row_counts=c.projection_row_counts
    AND c.topic_end_offsets=c.applied_offsets
    AND c.slot_status IN ('reserved','extended') AND c.connector_running
    AND s.status='PASS' AND s.snapshot_complete
    AND s.valid_until>clock_timestamp() AND s.source_digest IS NOT NULL
    AND s.source_digest=s.projection_digest
    AND s.source_row_counts=s.projection_row_counts
    AND s.topic_end_offsets=s.applied_offsets
    AND s.slot_status IN ('reserved','extended') AND s.connector_running AS ready
  FROM catalog_cdc_binding b
  JOIN catalog_cdc_quality_lease c ON c.source_id=b.source_id
    AND c.coverage_epoch_id=b.coverage_epoch_id
  JOIN inventory_price_cdc_quality_lease s ON s.source_id=b.source_id
  WHERE b.source_id=$1`;

const instant = value => value == null ? NaN : new Date(value).getTime();
export function offerLeaseUnchanged(result, current) {
  return current?.ready === true &&
    current.stage2_source_row_counts != null &&
    STAGE2_TABLES.every(table => Object.hasOwn(current.stage2_source_row_counts, table)) &&
    current.catalog_epoch_id === result.catalog_epoch_id &&
    current.stage2_epoch_id === result.stage2_epoch_id &&
    ['catalog_verified_at', 'catalog_valid_until', 'stage2_verified_at', 'stage2_valid_until']
      .every(key => Number.isFinite(instant(result[key])) &&
        instant(result[key]) === instant(current[key]));
}
