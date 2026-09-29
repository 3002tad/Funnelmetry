import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { summarizeOrders } from './order-summary.mjs'

const metadata = JSON.parse(await readFile(new URL('../metadata/order-value-v1.json', import.meta.url), 'utf8'))
export const ORDER_CATALOG_RELEASE = 'order-analytics-staging-1.0.0'
const document = {
  metadata,
  tool: {
    id: 'tool.metric_summary', version: '1.0.0', executable: 'order-summary-staged-v1',
    binding: 'public.analytical_fact_order_v1',
    outputs: {
      'measure.gross_order_value@1.0.0': 'gross_order_value',
      'measure.order_count@1.0.0': 'order_count',
      'metric.average_order_value@1.0.0': 'average_order_value',
    },
    required_dimensions: ['dimension.currency_code@1.0.0'],
  },
}
const expectedColumns = {
  source_id: 'text', order_id: 'text', total_amount: 'numeric', currency_code: 'text',
  order_placed_at: 'timestamp with time zone', quality_state: 'text', reason_code: 'text',
  canonical_event_ids: 'ARRAY', mapping_versions: 'ARRAY',
}
async function checkBinding(client) {
  const { rows } = await client.query(`SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='analytical_fact_order_v1'`)
  const actual = Object.fromEntries(rows.map(row => [row.column_name, row.data_type]))
  if (Object.entries(expectedColumns).some(([key, type]) => actual[key] !== type)) throw Error('UNVERIFIED_BINDING')
}

// Expose only the reviewed catalog document, after physical binding validation.
export async function inspectStagingOrderCatalog(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout = '5s'")
    const { rows: [row] } = await client.query('SELECT document,status FROM analytical_catalog_releases WHERE release_id=$1', [ORDER_CATALOG_RELEASE])
    if (!row || row.status !== 'VALIDATED_STAGING' || !isDeepStrictEqual(row.document, document)) throw Error('UNVERIFIED_CATALOG')
    await checkBinding(client)
    return { release_id: ORDER_CATALOG_RELEASE, status: row.status, binding_status: 'VERIFIED',
      metadata: row.document.metadata, tool: row.document.tool, checked_at: new Date().toISOString() }
  } finally {
    try { await client.query('ROLLBACK') } finally { client.release() }
  }
}

export async function discoverStagingOrderTool(pool) {
  const { rows: [row] } = await pool.query('SELECT document,status FROM analytical_catalog_releases WHERE release_id=$1', [ORDER_CATALOG_RELEASE])
  if (!row || row.status !== 'VALIDATED_STAGING' || !isDeepStrictEqual(row.document, document)) throw Error('UNVERIFIED_CATALOG')
  await checkBinding(pool)
  return {
    id: row.document.tool.id, catalog_release: ORDER_CATALOG_RELEASE,
    value_refs: Object.keys(row.document.tool.outputs), dimension_refs: [...row.document.tool.required_dimensions],
    description: 'Placed-order value, distinct order count and AOV, grouped by currency. Not paid/captured/net revenue. Provisional staging evidence; no item/category allocation.',
  }
}

// Deployment/test operation, deliberately separate from the read-only executor.
export async function installStagingOrderCatalog(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await checkBinding(client)
    await client.query(`INSERT INTO analytical_catalog_releases(release_id,document,status)
      VALUES ($1,$2::jsonb,'VALIDATED_STAGING') ON CONFLICT (release_id) DO NOTHING`,
    [ORDER_CATALOG_RELEASE, JSON.stringify(document)])
    const { rows: [row] } = await client.query('SELECT document FROM analytical_catalog_releases WHERE release_id=$1', [ORDER_CATALOG_RELEASE])
    if (!isDeepStrictEqual(row.document, document)) throw Error('CATALOG_VERSION_CONFLICT')
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

/** Internal staging registry. Not wired to HTTP/Agent; caller auth remains required
 * before eventual exposure. No SQL or executable name is accepted from callers.
 */
export async function executeStagingMetricSummary({ pool, request, statementTimeoutMs }) {
  const error = code => ({ status: 'ERROR', code, result: null })
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some(key => !['tool_id', 'catalog_release', 'value_refs', 'dimension_refs', 'parameters'].includes(key))
    || request.tool_id !== 'tool.metric_summary' || request.catalog_release !== ORDER_CATALOG_RELEASE
    || !Array.isArray(request.value_refs) || !request.value_refs.length || request.value_refs.length > 3
    || request.value_refs.some(ref => typeof ref !== 'string')
    || new Set(request.value_refs).size !== request.value_refs.length
    || !Array.isArray(request.dimension_refs)) return error('INVALID_TOOL_REQUEST')
  let release
  try {
    const { rows: [row] } = await pool.query('SELECT document,status FROM analytical_catalog_releases WHERE release_id=$1', [request.catalog_release])
    if (!row || row.status !== 'VALIDATED_STAGING' || !isDeepStrictEqual(row.document, document)) return error('UNVERIFIED_CATALOG')
    await checkBinding(pool)
    release = row.document
  } catch { return error('UNVERIFIED_CATALOG_OR_BINDING') }
  if (!isDeepStrictEqual(request.dimension_refs, release.tool.required_dimensions)
    || request.value_refs.some(ref => !Object.hasOwn(release.tool.outputs, ref))) return error('INCOMPATIBLE_SEMANTICS')
  const computed = await summarizeOrders({ pool, request: request.parameters, statementTimeoutMs })
  return {
    ...computed,
    result: computed.result ? { groups: computed.result.groups.map(group => ({
      currency_code: group.currency_code,
      values: Object.fromEntries(request.value_refs.map(ref => [ref, group[release.tool.outputs[ref]]])),
    })) } : null,
    semantic_context: {
      tool_id: release.tool.id, tool_contract_version: release.tool.version,
      executable_tool_version: release.tool.executable, catalog_release: request.catalog_release,
      catalog_status: 'VALIDATED_STAGING', value_refs: [...request.value_refs],
      dimension_refs: [...request.dimension_refs], execution_binding_ref: release.tool.binding,
    },
  }
}
