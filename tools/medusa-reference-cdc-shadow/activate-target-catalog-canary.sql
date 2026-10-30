-- CDC-12 Medusa reference catalog canary. Run only after the API candidate
-- image is healthy with PRODUCT_REFERENCE_PROVIDER still set to admin_api.
-- This transaction changes only the catalog CDC binding.
BEGIN;
DO $$
DECLARE
  quality catalog_cdc_quality_lease%ROWTYPE;
BEGIN
  SELECT * INTO quality FROM catalog_cdc_quality_lease
    WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_catalog_epoch1'
    FOR SHARE;
  IF NOT FOUND OR quality.status <> 'PASS' OR NOT quality.snapshot_complete
      OR quality.valid_until <= clock_timestamp()
      OR quality.source_digest IS NULL
      OR quality.source_digest <> quality.projection_digest
      OR quality.source_row_counts <> quality.projection_row_counts
      OR quality.topic_end_offsets <> quality.applied_offsets
      OR quality.slot_status NOT IN ('reserved','extended')
      OR NOT quality.connector_running THEN
    RAISE EXCEPTION 'catalog CDC quality lease is not ready for cutover';
  END IF;
  IF EXISTS(SELECT 1 FROM catalog_cdc_binding WHERE source_id='medusa-reference') THEN
    RAISE EXCEPTION 'catalog CDC binding already exists; review before changing it';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM catalog_cdc_products_current
      WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_catalog_epoch1'
        AND NOT soft_deleted) THEN
    RAISE EXCEPTION 'catalog CDC has no active products';
  END IF;
END $$;

INSERT INTO catalog_cdc_binding
  (source_id,coverage_epoch_id,state,activated_at,decision_ref)
VALUES ('medusa-reference','cdc11_catalog_epoch1','ACTIVE',clock_timestamp(),
        'CDC-12-CATALOG-CANARY-2026-10-30');

DO $$
DECLARE expected_count bigint;
DECLARE readable_count bigint;
BEGIN
  SELECT count(*) INTO expected_count FROM catalog_cdc_products_current
    WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_catalog_epoch1'
      AND NOT soft_deleted;
  SELECT count(*) INTO readable_count FROM current_product_reference_names_cdc
    WHERE source_id='medusa-reference';
  IF readable_count <> expected_count THEN
    RAISE EXCEPTION 'catalog CDC readable product count differs: % vs %',
      readable_count,expected_count;
  END IF;
END $$;
COMMIT;
