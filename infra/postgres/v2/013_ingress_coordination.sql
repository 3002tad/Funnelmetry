BEGIN;

CREATE TABLE IF NOT EXISTS ingress_receipt_claims (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_fingerprint TEXT,
  ingestion_id TEXT NOT NULL UNIQUE,
  receipt_document JSONB NOT NULL,
  claim_state TEXT NOT NULL CHECK (claim_state IN ('CLAIMED', 'ACCEPTED')),
  owner_token TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, event_id),
  CONSTRAINT ingress_receipt_claims_receipt_identity_check CHECK (
    receipt_document->>'source_id' = source_id
    AND receipt_document->>'event_id' = event_id
    AND receipt_document->>'ingestion_id' = ingestion_id
    AND receipt_document->>'status' = 'accepted'
  )
);

CREATE INDEX IF NOT EXISTS ingress_receipt_claims_lease_idx
  ON ingress_receipt_claims (claim_state, lease_expires_at);

ALTER TABLE ingress_receipt_claims ALTER COLUMN event_fingerprint DROP NOT NULL;

INSERT INTO ingress_receipt_claims (
  source_id, event_id, event_fingerprint, ingestion_id, receipt_document,
  claim_state, owner_token, lease_expires_at
)
SELECT source_id, event_id, NULL, ingestion_id, receipt_document,
       'ACCEPTED', 'migration:accepted-receipt', NOW()
  FROM ingress_accepted_receipts
ON CONFLICT (source_id, event_id) DO NOTHING;

COMMIT;
