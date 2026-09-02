BEGIN;

ALTER TABLE funnel_maturity_evaluations
  ADD COLUMN IF NOT EXISTS authoritative_conversion_time BOOLEAN;

ALTER TABLE funnel_maturity_evaluations
  DROP CONSTRAINT IF EXISTS funnel_maturity_evaluations_eligibility_reason_check;

ALTER TABLE funnel_maturity_evaluations
  ADD CONSTRAINT funnel_maturity_evaluations_eligibility_reason_check
  CHECK (eligibility_reason IS NULL OR eligibility_reason IN (
    'TIME_POLICY_UNCONFIGURED', 'OUTCOME_NOT_ELIGIBLE',
    'NON_AUTHORITATIVE_ENTRY_TIME', 'NON_AUTHORITATIVE_CONVERSION_TIME'
  ));

ALTER TABLE funnel_maturity_evaluations
  DROP CONSTRAINT IF EXISTS funnel_maturity_evaluations_conversion_authority_check;

ALTER TABLE funnel_maturity_evaluations
  ADD CONSTRAINT funnel_maturity_evaluations_conversion_authority_check
  CHECK (
    (outcome_status_snapshot = 'CONVERTED' AND authoritative_conversion_time IS NOT NULL)
    OR (outcome_status_snapshot <> 'CONVERTED' AND authoritative_conversion_time IS NULL)
  ) NOT VALID;

COMMIT;
