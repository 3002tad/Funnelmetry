-- Restore PRODUCT_REFERENCE_PROVIDER=admin_api before running this transaction.
BEGIN;
DO $$ BEGIN
  UPDATE catalog_cdc_binding SET state='ROLLED_BACK'
    WHERE source_id='medusa-reference'
      AND coverage_epoch_id='cdc11_catalog_epoch1'
      AND state='ACTIVE'
      AND decision_ref='CDC-12-CATALOG-CANARY-2026-10-30';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog CDC canary binding was not active';
  END IF;
END $$;
COMMIT;
