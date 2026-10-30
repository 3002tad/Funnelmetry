-- Versioned metadata for a quality-gated, parameterized current-offer read.
-- No tool, historical order price or generalized sellable-stock claim.
CREATE TABLE reference_current_offer_metadata_releases (
  asset_id text NOT NULL,
  asset_version text NOT NULL,
  contract_id text NOT NULL,
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (asset_id, asset_version),
  CHECK (asset_id = 'asset.reference_medusa_current_offer'),
  CHECK (contract_id = 'reference.medusa.current_offer.v1')
);

CREATE TABLE reference_current_offer_metadata_bindings (
  source_id text NOT NULL,
  asset_id text NOT NULL,
  asset_version text NOT NULL,
  catalog_epoch_id text NOT NULL,
  stage2_epoch_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('SHADOW', 'ACTIVE')),
  decision_ref text NOT NULL,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id, asset_id, asset_version),
  FOREIGN KEY (asset_id, asset_version)
    REFERENCES reference_current_offer_metadata_releases(asset_id, asset_version),
  CHECK (state <> 'ACTIVE' OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX reference_current_offer_one_active_binding
  ON reference_current_offer_metadata_bindings(source_id, asset_id)
  WHERE state = 'ACTIVE';

CREATE TABLE reference_current_offer_metadata_binding_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL,
  asset_id text NOT NULL,
  asset_version text NOT NULL,
  catalog_epoch_id text NOT NULL,
  stage2_epoch_id text NOT NULL,
  old_state text,
  new_state text NOT NULL,
  decision_ref text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (new_state IN ('SHADOW', 'ACTIVE'))
);

CREATE OR REPLACE FUNCTION audit_reference_current_offer_metadata_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    previous_state := NULL;
  ELSE
    previous_state := OLD.state;
  END IF;
  IF TG_OP = 'INSERT' OR previous_state IS DISTINCT FROM NEW.state THEN
    INSERT INTO reference_current_offer_metadata_binding_audit
      (source_id, asset_id, asset_version, catalog_epoch_id, stage2_epoch_id,
       old_state, new_state, decision_ref)
    VALUES (NEW.source_id, NEW.asset_id, NEW.asset_version,
      NEW.catalog_epoch_id, NEW.stage2_epoch_id,
      previous_state,
      NEW.state, NEW.decision_ref);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reference_current_offer_metadata_binding_audit_trigger
AFTER INSERT OR UPDATE OF state ON reference_current_offer_metadata_bindings
FOR EACH ROW EXECUTE FUNCTION audit_reference_current_offer_metadata_binding();

CREATE OR REPLACE FUNCTION reject_reference_current_offer_metadata_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reference current-offer metadata releases and audit are immutable';
END;
$$;
CREATE TRIGGER reference_current_offer_metadata_release_immutable
BEFORE UPDATE OR DELETE ON reference_current_offer_metadata_releases
FOR EACH ROW EXECUTE FUNCTION reject_reference_current_offer_metadata_mutation();
CREATE TRIGGER reference_current_offer_metadata_audit_immutable
BEFORE UPDATE OR DELETE ON reference_current_offer_metadata_binding_audit
FOR EACH ROW EXECUTE FUNCTION reject_reference_current_offer_metadata_mutation();
