-- Staged only; no active runtime release is selected by this schema.
CREATE TABLE IF NOT EXISTS analytical_catalog_releases (
  release_id text PRIMARY KEY,
  document jsonb NOT NULL,
  status text NOT NULL CHECK (status = 'VALIDATED_STAGING'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_analytical_catalog_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Catalog releases are immutable; create a new version';
END $$;
DROP TRIGGER IF EXISTS analytical_catalog_immutable ON analytical_catalog_releases;
CREATE TRIGGER analytical_catalog_immutable BEFORE UPDATE OR DELETE ON analytical_catalog_releases
FOR EACH ROW EXECUTE FUNCTION reject_analytical_catalog_mutation();
