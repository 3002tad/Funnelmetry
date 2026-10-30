BEGIN;
INSERT INTO reference_current_offer_metadata_releases
  (asset_id, asset_version, contract_id, definition)
VALUES ('asset.reference_medusa_current_offer','1.0.0',
  'reference.medusa.current_offer.v1','{}'::jsonb);
INSERT INTO reference_current_offer_metadata_bindings
  (source_id,asset_id,asset_version,catalog_epoch_id,stage2_epoch_id,state,decision_ref)
VALUES ('medusa-reference','asset.reference_medusa_current_offer','1.0.0',
  'catalog_epoch','stage2_epoch','SHADOW','DEC-140');
UPDATE reference_current_offer_metadata_bindings
  SET state='ACTIVE',activated_at=clock_timestamp()
WHERE source_id='medusa-reference' AND asset_id='asset.reference_medusa_current_offer';
DO $$
BEGIN
  IF (SELECT count(*) FROM reference_current_offer_metadata_binding_audit
    WHERE source_id='medusa-reference') <> 2 THEN
    RAISE EXCEPTION 'metadata binding audit is incomplete';
  END IF;
  BEGIN
    UPDATE reference_current_offer_metadata_releases SET definition='{"changed":true}'::jsonb;
    RAISE EXCEPTION 'immutable release accepted update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'immutable release accepted update' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'REFERENCE_OFFER_METADATA_GUARD_PASS';
END;
$$;
ROLLBACK;
