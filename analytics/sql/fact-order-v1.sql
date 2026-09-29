-- STAGED: not part of automatic runtime migrations. Requires explicit cutover.
-- One row per (source_id, order_id); no item joins or historical ledger updates.
CREATE OR REPLACE VIEW analytical_fact_order_v1 AS
WITH candidates AS (
  SELECT *, aggregate_id AS order_id,
    CASE WHEN jsonb_typeof(data->'total_amount') = 'string'
      AND length(data->>'total_amount') <= 64
      AND data->>'total_amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      THEN (data->>'total_amount')::numeric END AS amount,
    upper(data->>'currency_code') AS currency,
    COALESCE(mapping_version = 'medusa-order-placed-v2'
      AND event_class = 'BUSINESS_FACT'
      AND aggregate_type = 'order'
      AND aggregate_id = data->>'order_id'
      AND data->>'amount_unit' = 'major'
      AND data->>'amount_semantics' = 'medusa.order.total'
      AND NOT data ? 'total_minor'
      AND data->>'currency_code' ~ '^[A-Za-z]{3}$'
      AND quality->>'authoritative_event_time' = 'true'
      AND quality->>'time_basis' = 'source_occurred', false) AS valid_contract
  FROM canonical_events
  WHERE source_id = 'medusa-reference' AND event_type = 'order.placed'
), grouped AS (
  SELECT source_id, order_id,
    bool_and(valid_contract AND amount IS NOT NULL AND order_id IS NOT NULL) AS valid,
    count(DISTINCT (amount, currency, occurred_at)) AS variants,
    min(amount) AS amount, min(currency) AS currency, min(occurred_at) AS placed_at,
    array_agg(canonical_event_id ORDER BY canonical_event_id) AS canonical_event_ids,
    array_agg(DISTINCT mapping_version ORDER BY mapping_version) AS mapping_versions
  FROM candidates GROUP BY source_id, order_id
)
SELECT source_id, order_id,
  CASE WHEN valid AND variants = 1 THEN amount END AS total_amount,
  CASE WHEN valid AND variants = 1 THEN currency END AS currency_code,
  CASE WHEN valid AND variants = 1 THEN placed_at END AS order_placed_at,
  CASE WHEN valid AND variants = 1 THEN 'VALID' ELSE 'BLOCKED_BY_QUALITY' END AS quality_state,
  CASE WHEN NOT valid THEN 'invalid_contract'
       WHEN variants <> 1 THEN 'conflicting_order_facts' END AS reason_code,
  canonical_event_ids, mapping_versions
FROM grouped;
