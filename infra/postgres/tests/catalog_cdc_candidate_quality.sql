-- Run only against an isolated DB after migration 021; leaves no fixture data.
BEGIN;
INSERT INTO catalog_cdc_products_current
  (source_id,coverage_epoch_id,product_id,title,soft_deleted,last_topic_offset)
VALUES ('source-test','epoch-test','product-test','CDC title',false,0);
INSERT INTO catalog_cdc_quality_lease
  (source_id,coverage_epoch_id,status,snapshot_complete,source_row_counts,
   projection_row_counts,source_digest,projection_digest,topic_end_offsets,
   applied_offsets,slot_status,connector_running,verified_at,valid_until,evidence_ref)
VALUES ('source-test','epoch-test','PASS',true,'{"product":1}'::jsonb,
        '{"product":1}'::jsonb,'digest','digest','{"product":1}'::jsonb,
        '{"product":1}'::jsonb,'reserved',true,clock_timestamp(),
        clock_timestamp() + interval '1 hour','isolated-sql-test');
INSERT INTO catalog_cdc_binding
  (source_id,coverage_epoch_id,state,decision_ref)
VALUES ('source-test','epoch-test','SHADOW','isolated-sql-test');
DO $$ BEGIN
  IF (SELECT count(*) FROM current_product_reference_names_cdc
      WHERE source_id='source-test') <> 0 THEN
    RAISE EXCEPTION 'shadow binding leaked CDC names';
  END IF;
END $$;
UPDATE catalog_cdc_binding SET state='ACTIVE',activated_at=clock_timestamp()
WHERE source_id='source-test';
DO $$ BEGIN
  IF (SELECT count(*) FROM current_product_reference_names_cdc
      WHERE source_id='source-test') <> 1 THEN
    RAISE EXCEPTION 'active quality lease did not expose CDC name';
  END IF;
END $$;
UPDATE catalog_cdc_quality_lease SET
  verified_at=clock_timestamp() - interval '2 hours',
  valid_until=clock_timestamp() - interval '1 hour'
WHERE source_id='source-test';
DO $$ BEGIN
  IF (SELECT count(*) FROM current_product_reference_names_cdc
      WHERE source_id='source-test') <> 0 THEN
    RAISE EXCEPTION 'expired quality lease leaked CDC name';
  END IF;
END $$;
ROLLBACK;
