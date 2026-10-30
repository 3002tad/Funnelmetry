// At most one descriptive row per source/product. Never alter analytical counts.
export async function attachProductReferences(tx, sourceId, rows, options = {}) {
  const provider = options.provider ?? process.env.PRODUCT_REFERENCE_PROVIDER ?? 'catalog_cdc'
  if (provider !== 'catalog_cdc') throw Error('product_reference_provider_invalid')
    const [installed] = await tx(`SELECT
      to_regclass('public.current_product_reference_names_cdc') IS NOT NULL AND
      to_regclass('public.catalog_cdc_binding') IS NOT NULL AND
      to_regclass('public.catalog_cdc_quality_lease') IS NOT NULL AS installed`)
    if (!installed?.installed) throw Error('catalog_cdc_binding_unavailable')
    const [quality] = await tx(`SELECT b.coverage_epoch_id,
      b.state='ACTIVE' AND q.status='PASS' AND q.snapshot_complete
        AND q.valid_until > clock_timestamp() AND q.verified_at <= clock_timestamp()
        AND q.source_row_counts=q.projection_row_counts
        AND q.source_digest=q.projection_digest AND q.source_digest IS NOT NULL
        AND q.topic_end_offsets=q.applied_offsets
        AND q.slot_status IN ('reserved','extended') AND q.connector_running AS readable
      FROM catalog_cdc_binding b
      JOIN catalog_cdc_quality_lease q ON q.source_id=b.source_id
        AND q.coverage_epoch_id=b.coverage_epoch_id
      WHERE b.source_id=$1`, [sourceId])
    if (!quality?.readable) throw Error('catalog_cdc_blocked_by_quality')
    const names = rows.length ? await tx(`SELECT product_id,title,snapshot_id,observed_at,
      source_updated_at,provider,coverage_epoch_id FROM current_product_reference_names_cdc
      WHERE source_id=$1 AND product_id=ANY($2::text[])`,
    [sourceId, rows.map(row => row.product_id)]) : []
    const byId = new Map(names.map(({product_id,...reference}) => [product_id,reference]))
    return rows.map(row => ({...row, reference:byId.get(row.product_id) ?? null}))
}

export async function attachEventProductReferences(query, sourceId, events, options = {}) {
  const ids = [...new Set(events.flatMap(event => {
    const details = event.business_details
    return [details?.product_id, ...(details?.items ?? []).map(item => item.product_id)].filter(Boolean)
  }))]
  if (!ids.length) return events
  const references = await attachProductReferences(query, sourceId,
    ids.map(product_id => ({product_id})), options)
  const byId = new Map(references.map(row => [row.product_id, row.reference]))
  const enrich = item => ({...item, product_reference:byId.get(item.product_id) ?? null})
  return events.map(event => {
    if (!event.business_details) return event
    const details = enrich(event.business_details)
    if (details.items) details.items = details.items.map(enrich)
    return {...event, business_details:details}
  })
}
