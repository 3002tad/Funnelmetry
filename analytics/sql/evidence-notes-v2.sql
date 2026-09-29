-- Additive classification; existing notes remain NOTE, never official findings.
ALTER TABLE analytical_evidence_notes ADD COLUMN IF NOT EXISTS review_kind text NOT NULL
  DEFAULT 'NOTE' CHECK(review_kind IN ('NOTE','USEFUL','NEEDS_REVIEW','INACCURATE'));
