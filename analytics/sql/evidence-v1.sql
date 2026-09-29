-- Staged, append-only completed executions; no source/business mutations.
CREATE TABLE IF NOT EXISTS analytical_execution_evidence (
  evidence_id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE,
  tool_call_id uuid NOT NULL UNIQUE,
  actor_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROVISIONAL','INSUFFICIENT_DATA','BLOCKED_BY_QUALITY','ERROR')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_analytical_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Analytical evidence is append-only';
END $$;
DROP TRIGGER IF EXISTS analytical_evidence_immutable ON analytical_execution_evidence;
CREATE TRIGGER analytical_evidence_immutable BEFORE UPDATE OR DELETE ON analytical_execution_evidence
FOR EACH ROW EXECUTE FUNCTION reject_analytical_evidence_mutation();
