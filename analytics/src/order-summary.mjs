import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Internal staged access binding; not an Agent tool or a published metadata resolver.
const metadataBytes = await readFile(new URL('../metadata/order-value-v1.json', import.meta.url))
const metadata = JSON.parse(metadataBytes)
const metadataHash = createHash('sha256').update(metadataBytes).digest('hex')
const SQL = `WITH facts AS MATERIALIZED (
  SELECT * FROM public.analytical_fact_order_v1 WHERE source_id=$1
), gate AS (
  SELECT count(*)::text AS blocked_count FROM facts WHERE quality_state <> 'VALID'
), totals AS (
  SELECT currency_code, count(*)::text AS order_count,
    sum(total_amount)::text AS gross_order_value,
    (sum(total_amount)/count(*))::text AS average_order_value
  FROM facts WHERE (SELECT blocked_count FROM gate)='0'
    AND order_placed_at >= $2::timestamptz AND order_placed_at < $3::timestamptz
    AND ($4::text IS NULL OR currency_code=$4)
  GROUP BY currency_code
)
SELECT gate.blocked_count, transaction_timestamp() AS snapshot_at,
  COALESCE((SELECT jsonb_agg(to_jsonb(totals) ORDER BY currency_code) FROM totals), '[]'::jsonb) AS groups
FROM gate`

function validate(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some(key => !['source_id', 'from', 'to', 'currency_code'].includes(key))) return false
  const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  return request.source_id === metadata.asset.scope && iso(request.from) && iso(request.to)
    && request.from < request.to
    && (request.currency_code === undefined || (typeof request.currency_code === 'string' && /^[A-Z]{3}$/.test(request.currency_code)))
}

/** Internal, read-only aggregate. Money/counts stay strings; no JS float arithmetic.
 * Caller supplies resource timeout; no product timeout policy is invented here.
 */
export async function summarizeOrders({ pool, request, statementTimeoutMs }) {
  if (!validate(request) || !Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    return { status: 'ERROR', code: 'INVALID_REQUEST', result: null }
  }
  const provenance = {
    implementation_version: 'order-summary-staged-v1', metadata_version: metadata.version,
    metadata_sha256: metadataHash, metadata_status: metadata.status,
    asset_ref: metadata.asset.id, binding_ref: 'public.analytical_fact_order_v1',
    grain: [...metadata.asset.grain], time_basis: metadata.asset.time_basis,
    parameters: { ...request }, interval: '[from,to)',
    warnings: ['DRAFT_METADATA_NOT_RUNTIME_PUBLISHED', 'FEED_COMPLETENESS_FRESHNESS_RECONCILIATION_UNVERIFIED',
      'PLACED_ORDER_VALUE_NOT_PAID_REVENUE'],
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(statementTimeoutMs)])
    const { rows: [row] } = await client.query(SQL, [request.source_id, request.from, request.to, request.currency_code ?? null])
    await client.query('COMMIT')
    provenance.snapshot_at = row.snapshot_at
    // Conservative source-wide gate: invalid rows lose time/currency in the view.
    // A narrow filter must never hide such a row.
    if (row.blocked_count !== '0') return {
      status: 'BLOCKED_BY_QUALITY', quality_state: 'INVALID', result: null,
      blocked_order_count: row.blocked_count, gate_scope: 'entire_source', provenance,
    }
    return {
      status: row.groups.length ? 'PROVISIONAL' : 'INSUFFICIENT_DATA', quality_state: 'PROVISIONAL',
      result: { groups: row.groups }, provenance,
    }
  } catch {
    if (client) { try { await client.query('ROLLBACK') } catch {} }
    return { status: 'ERROR', code: 'ORDER_SUMMARY_EXECUTION_FAILED', result: null, provenance }
  } finally { client?.release() }
}
