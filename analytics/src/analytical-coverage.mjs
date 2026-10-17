import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const catalogUrl = new URL('../metadata/analytical-coverage-v1.json', import.meta.url)
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const allowedAvailability = new Set(['DOCUMENTED_ONLY', 'IMPLEMENTED_OPT_IN', 'STAGED_TOOL'])
const identifier = /^[a-z][a-z0-9_]*$/
const semanticId = /^asset\.[a-z][a-z0-9_]*$/
const physicalName = /^public\.([a-z][a-z0-9_]*)$/
const knownToolRefs = new Set(['event_counts', 'overview', 'tool.metric_summary',
  'tool.order_ranking', 'tool.product_value_ranking'])
const requiredBindings = new Map([
  ['asset.canonical_event', 'public.canonical_events'],
  ['asset.journey', 'public.journeys'],
  ['asset.journey_event', 'public.journey_events'],
  ['asset.funnel_instance', 'public.funnel_instances'],
  ['asset.funnel_kpi_instance', 'public.funnel_kpi_instance_facts'],
  ['asset.funnel_kpi_step', 'public.funnel_kpi_step_facts'],
  ['asset.funnel_maturity_finalization', 'public.funnel_maturity_finalizations'],
  ['asset.funnel_late_conversion', 'public.funnel_late_conversions'],
  ['asset.fact_order', 'public.analytical_fact_order_v1'],
  ['asset.ordered_product_item', 'public.analytical_product_order_items_v1'],
  ['asset.current_product_reference', 'public.current_product_reference_names'],
  ['asset.traffic_source_input', 'public.traffic_source_raw_events_v1'],
  ['asset.reconciliation_comparison', 'public.reconciliation_comparisons'],
  ['asset.canonicalization_outcome', 'public.canonicalization_latest_outcomes'],
  ['asset.ingress_accepted_receipt', 'public.ingress_accepted_receipts'],
  ['asset.current_projection_record', 'public.analytics_current_projection_records'],
])

export async function loadAnalyticalCoverage() {
  return JSON.parse(await readFile(catalogUrl, 'utf8'))
}

function invalid(message) { throw Error(`INVALID_ANALYTICAL_COVERAGE: ${message}`) }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 }
function sameFields(left, right) { return JSON.stringify(left) === JSON.stringify(right) }

function validateEmbeddedDefinition(asset) {
  const definition = asset.definition
  if (asset.id !== 'asset.fact_order' && asset.id !== 'asset.ordered_product_item') {
    if (definition !== undefined) invalid(`${asset.id} unexpected definition`)
    return
  }
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)
    || definition.status !== 'DRAFT' || definition.version !== '1.0.0'
    || definition.runtime_published !== false) invalid(`${asset.id} definition status`)
  if (asset.id === 'asset.fact_order') {
    if (definition.asset?.id !== asset.id
      || definition.asset.relation !== asset.relation.slice('public.'.length)
      || !sameFields(definition.asset.grain, asset.grain)
      || definition.asset.time_basis !== asset.time_basis
      || definition.asset.quality_field !== 'quality_state'
      || definition.asset.required_quality !== 'VALID'
      || definition.asset.scope !== 'medusa-reference'
      || !sameFields(definition.measures?.map(item => item.id), ['measure.gross_order_value', 'measure.order_count'])
      || definition.measures[0].field !== 'total_amount'
      || !sameFields(definition.measures[1].fields, asset.grain)
      || definition.metrics?.[0]?.id !== 'metric.average_order_value'
      || definition.metrics[0].numerator !== 'measure.gross_order_value'
      || definition.metrics[0].denominator !== 'measure.order_count'
      || definition.policies?.['measure.revenue'] !== 'unavailable_for_this_baseline; not_an_alias'
      || definition.policies.cross_currency !== 'prohibited_without_fx_contract; group_by_currency_required'
      || definition.policies.blocked_rows !== 'block_execution_for_affected_scope; never_silently_drop') {
      invalid(`${asset.id} definition semantics`)
    }
  } else if (definition.tool_id !== 'tool.product_value_ranking'
    || definition.catalog_release !== 'product-value-staging-1.0.0'
    || definition.binding !== asset.relation
    || !sameFields(definition.input_grain, asset.grain)
    || definition.time_basis !== asset.time_basis
    || !sameFields(definition.value_refs, ['measure.ordered_product_unit_value@1.0.0'])
    || !sameFields(definition.dimension_refs, ['dimension.currency_code@1.0.0', 'dimension.product_id@1.0.0'])
    || definition.formula !== 'SUM(point_in_time_unit_price_amount * quantity)'
    || definition.limit_per_currency !== 5
    || definition.policies?.quality !== 'block if any source order or items invalid; no silent exclusion'
    || definition.policies.currency !== 'separate; no FX conversion'
    || definition.policies.revenue !== 'not paid/net revenue and not allocated order total') {
    invalid(`${asset.id} definition semantics`)
  }
}

// Validate the document before using it for discovery. This does not publish or expose tools.
export function validateAnalyticalCoverage(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)
    || catalog.catalog_id !== 'funnelmetry-analytical-coverage'
    || catalog.version !== '1.0.0' || catalog.status !== 'DRAFT_COVERAGE'
    || catalog.runtime_published !== false || !Array.isArray(catalog.assets)) invalid('catalog header')
  const byId = new Map()
  const byRelation = new Set()
  for (const asset of catalog.assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)
      || !semanticId.test(asset.id ?? '') || byId.has(asset.id)
      || !nonempty(asset.description) || !physicalName.test(asset.relation ?? '')
      || byRelation.has(asset.relation) || requiredBindings.get(asset.id) !== asset.relation
      || !nonempty(asset.schema_ref)
      || !asset.schema_ref.endsWith('.sql') || asset.schema_ref.includes('..')
      || !nonempty(asset.authority) || !allowedAvailability.has(asset.availability)) invalid('asset identity/binding')
    if (!asset.schema_ref.startsWith('infra/postgres/') && !asset.schema_ref.startsWith('analytics/sql/')) invalid('schema reference')
    byId.set(asset.id, asset)
    byRelation.add(asset.relation)
    const columns = asset.required_columns
    if (!columns || typeof columns !== 'object' || Array.isArray(columns) || !Object.keys(columns).length
      || Object.entries(columns).some(([name, type]) => !identifier.test(name) || !nonempty(type))) invalid(`${asset.id} columns`)
    const columnNames = new Set(Object.keys(columns))
    for (const key of ['grain', 'primary_keys', 'dimensions', 'measures', 'relationships',
      'quality_requirements', 'supported_operations', 'tool_refs', 'limitations']) {
      if (!Array.isArray(asset[key])) invalid(`${asset.id} ${key}`)
    }
    if (!asset.grain.length || !asset.primary_keys.length
      || asset.grain.some(name => !columnNames.has(name))
      || asset.primary_keys.some(name => !columnNames.has(name))
      || asset.dimensions.some(name => !columnNames.has(name))
      || !columnNames.has(asset.time_basis)) invalid(`${asset.id} grain/dimension/time`)
    if (new Set(asset.grain).size !== asset.grain.length
      || new Set(asset.dimensions).size !== asset.dimensions.length
      || new Set(asset.primary_keys).size !== asset.primary_keys.length) invalid(`${asset.id} duplicate field`)
    if (asset.measures.some(measure => !nonempty(measure?.id) || !nonempty(measure.aggregation)
      || !nonempty(measure.unit) || (measure.field !== undefined && !columnNames.has(measure.field)))) invalid(`${asset.id} measure`)
    if (new Set(asset.measures.map(measure => measure.id)).size !== asset.measures.length
      || asset.measures.some(measure => /(?:^|\.)revenue(?:$|\.)/.test(measure.id))) invalid(`${asset.id} measure authority`)
    if (asset.availability === 'DOCUMENTED_ONLY' && (asset.tool_refs.length || asset.supported_operations.length)) invalid(`${asset.id} executable claim`)
    if (asset.tool_refs.some(ref => !knownToolRefs.has(ref)) || asset.supported_operations.some(op => !nonempty(op))
      || asset.quality_requirements.some(rule => !nonempty(rule))
      || asset.limitations.some(limit => !nonempty(limit))) invalid(`${asset.id} empty semantic`)
    validateEmbeddedDefinition(asset)
  }
  if (byId.size !== requiredBindings.size
    || [...requiredBindings.keys()].some(id => !byId.has(id))) invalid('missing or unexpected logical asset')
  for (const asset of catalog.assets) {
    for (const relation of asset.relationships) {
      const target = byId.get(relation?.target_asset)
      if (!target || !Array.isArray(relation.keys) || !relation.keys.length
        || relation.keys.some(key => !Object.hasOwn(asset.required_columns, key)
          || !Object.hasOwn(target.required_columns, key)
          || asset.required_columns[key] !== target.required_columns[key])
        || !['many-to-one', 'one-to-many', 'one-to-one'].includes(relation.cardinality)
        || typeof relation.safe_aggregation !== 'boolean') invalid(`${asset.id} relationship`)
    }
  }
  return catalog
}

// Runtime consumers keep their existing staged catalog documents, sourced from one JSON file.
export async function loadAnalyticalDefinition(assetId) {
  if (assetId !== 'asset.fact_order' && assetId !== 'asset.ordered_product_item') {
    invalid(`unknown detailed definition ${assetId}`)
  }
  const catalog = validateAnalyticalCoverage(await loadAnalyticalCoverage())
  return structuredClone(catalog.assets.find(asset => asset.id === assetId).definition)
}

// Source files are a development check, not proof that a deployment has applied them.
export async function validateCoverageSources(catalog) {
  catalog ??= await loadAnalyticalCoverage()
  validateAnalyticalCoverage(catalog)
  for (const asset of catalog.assets) {
    const source = await readFile(resolve(repositoryRoot, asset.schema_ref), 'utf8')
    const name = asset.relation.slice('public.'.length)
    if (!new RegExp(`CREATE\\s+(?:TABLE\\s+IF\\s+NOT\\s+EXISTS|OR\\s+REPLACE\\s+VIEW)\\s+${name}\\b`, 'i').test(source)) {
      invalid(`${asset.id} source relation missing`)
    }
  }
  return catalog
}

// An operator can run this against PostgreSQL; no catalog row or tool is activated.
export async function inspectCoverageBindings(pool, catalog) {
  catalog ??= await loadAnalyticalCoverage()
  validateAnalyticalCoverage(catalog)
  if (!pool || typeof pool.query !== 'function') throw TypeError('read-only PostgreSQL pool required')
  const results = []
  for (const asset of catalog.assets) {
    const name = asset.relation.slice('public.'.length)
    try {
      const { rows } = await pool.query(
        `SELECT column_name,data_type FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2`, ['public', name])
      const actual = Object.fromEntries(rows.map(row => [row.column_name, row.data_type]))
      const missingOrWrong = Object.entries(asset.required_columns)
        .filter(([column, type]) => actual[column] !== type).map(([column]) => column)
      results.push({ id: asset.id, binding: asset.relation,
        status: missingOrWrong.length ? 'UNVERIFIED' : 'VERIFIED_BINDING',
        mismatched_columns: missingOrWrong })
    } catch {
      results.push({ id: asset.id, binding: asset.relation, status: 'UNVERIFIED', mismatched_columns: [] })
    }
  }
  return { catalog_id: catalog.catalog_id, version: catalog.version, runtime_published: false, results }
}
