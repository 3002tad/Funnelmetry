-- Additive migration. Prerequisite: evidence-v1.sql. No historical rewrites.
CREATE TABLE IF NOT EXISTS analytical_evidence_notes (
  note_id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES analytical_execution_evidence(evidence_id),
  actor_id text NOT NULL,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  origin text NOT NULL DEFAULT 'HUMAN_NOTE' CHECK (origin='HUMAN_NOTE'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytical_evidence_notes_owner_idx
  ON analytical_evidence_notes(actor_id,evidence_id,created_at DESC,note_id DESC);
DROP TRIGGER IF EXISTS analytical_notes_immutable ON analytical_evidence_notes;
CREATE TRIGGER analytical_notes_immutable BEFORE UPDATE OR DELETE ON analytical_evidence_notes
FOR EACH ROW EXECUTE FUNCTION reject_analytical_evidence_mutation();
