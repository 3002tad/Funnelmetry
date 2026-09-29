// At most one descriptive row per source/product. Never alter analytical counts.
export async function attachProductReferences(tx, sourceId, rows) {
  const [installed] = await tx("SELECT to_regclass('public.current_product_reference_names') IS NOT NULL AS installed")
  if (!installed?.installed) return rows.map(row => ({...row, reference:null}))
  const names = rows.length ? await tx(`SELECT product_id,title,snapshot_id,observed_at,source_updated_at,provider
    FROM current_product_reference_names WHERE source_id=$1 AND product_id=ANY($2::text[])`,
    [sourceId, rows.map(row => row.product_id)]) : []
  const byId = new Map(names.map(({product_id,...reference}) => [product_id,reference]))
  return rows.map(row => ({...row, reference:byId.get(row.product_id) ?? null}))
}

export async function attachEventProductReferences(query, sourceId, events) {
  const ids = [...new Set(events.flatMap(event => {
    const details = event.business_details
    return [details?.product_id, ...(details?.items ?? []).map(item => item.product_id)].filter(Boolean)
  }))]
  if (!ids.length) return events
  const references = await attachProductReferences(query, sourceId, ids.map(product_id => ({product_id})))
  const byId = new Map(references.map(row => [row.product_id, row.reference]))
  const enrich = item => ({...item, product_reference:byId.get(item.product_id) ?? null})
  return events.map(event => {
    if (!event.business_details) return event
    const details = enrich(event.business_details)
    if (details.items) details.items = details.items.map(enrich)
    return {...event, business_details:details}
  })
}
