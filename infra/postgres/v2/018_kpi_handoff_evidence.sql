BEGIN;

-- NULL means historical handoff evidence is unavailable, not an empty change set.
ALTER TABLE kpi_projection_applications ADD COLUMN IF NOT EXISTS changed_instances JSONB
  CHECK (changed_instances IS NULL OR
    (jsonb_typeof(changed_instances) = 'array' AND jsonb_array_length(changed_instances) = changed_instance_count));

COMMIT;
