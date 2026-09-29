const fail = () => { throw new Error('catalog_response_invalid') }
export function catalogConfig(env) {
  let url
  try { url = new URL(env.CATALOG_MEDUSA_URL) } catch { throw Error('catalog_config_invalid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('catalog_config_invalid')
  const sourceId = env.CATALOG_SOURCE_ID, token = env.CATALOG_MEDUSA_SECRET_KEY
  if (typeof sourceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(sourceId) ||
      typeof token !== 'string' || !token || /\s/.test(token)) throw Error('catalog_config_invalid')
  const intervalMs = Number(env.CATALOG_INTERVAL_MS ?? 3600000)
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000 || intervalMs > 86400000) throw Error('catalog_config_invalid')
  return { origin: url.origin, sourceId, token, intervalMs }
}

// Read-only Admin API, explicit field allowlist, no prices or arbitrary metadata.
// Offset pagination is not a transactionally consistent source snapshot.
export async function readCatalog(config, fetchImpl = fetch, stopSignal) {
  const products = [], seen = new Set()
  const runSignal = AbortSignal.any([AbortSignal.timeout(120000), ...(stopSignal ? [stopSignal] : [])])
  let expectedCount
  for (let offset = 0; offset < 10000; offset += 100) {
    const url = new URL('/admin/products', config.origin)
    url.search = new URLSearchParams({ limit: '100', offset: String(offset), order: 'id', fields: 'id,title,updated_at' }).toString()
    let page
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Basic ${config.token}`, Accept: 'application/json' }, signal: AbortSignal.any([runSignal, AbortSignal.timeout(10000)]) })
      if (response.status !== 200) { await response.body?.cancel(); throw Error() }
      const reader = response.body.getReader(), chunks = []; let bytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          bytes += value.length; if (bytes > 1024 * 1024) throw Error()
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      page = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch { throw Error('catalog_fetch_failed') }
    if (!page || !Array.isArray(page.products) || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > 10000 ||
        page.offset !== offset || page.limit !== 100 || page.products.length !== Math.min(100, Math.max(0, page.count - offset))) fail()
    expectedCount ??= page.count
    if (expectedCount !== page.count) fail()
    for (const p of page.products) {
      if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(p.id) || seen.has(p.id) ||
          typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500 || p.title.includes('\0') ||
          (p.updated_at != null && (typeof p.updated_at !== 'string' || !Number.isFinite(Date.parse(p.updated_at))))) fail()
      seen.add(p.id)
      products.push({ product_id: p.id, title: p.title.trim(), source_updated_at: p.updated_at ?? null })
    }
    if (products.length === expectedCount) return products
  }
  fail()
}

// Caller holds a session lock across fetch + persistence. All rows publish atomically.
export async function saveCatalog(client, { sourceId, snapshotId, products }) {
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL statement_timeout = '15s'")
    await client.query(`INSERT INTO product_reference_snapshots
      (snapshot_id,source_id,observed_at,provider,product_count)
      VALUES ($1,$2,clock_timestamp(),'medusa-admin-products-v2',$3)`, [snapshotId, sourceId, products.length])
    await client.query(`INSERT INTO product_reference_names (source_id,snapshot_id,product_id,title,source_updated_at)
      SELECT $1,$2,x.product_id,x.title,x.source_updated_at FROM jsonb_to_recordset($3::jsonb)
      AS x(product_id text,title text,source_updated_at timestamptz)`, [sourceId,snapshotId,JSON.stringify(products)])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
}
