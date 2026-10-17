import { createHash } from 'node:crypto'
import { loadAnalyticalCoverage, validateAnalyticalCoverage } from '../../../../../analytics/src/analytical-coverage.mjs'

// The versioned metadata projection is the rebuildable source for Qdrant. Qdrant is never
// the authority for definitions or numbers; returned IDs resolve back here.
const dimensions = 384
const embeddingVersion = 'metadata-hash384-v1'
const stopWords = new Set(['a', 'an', 'and', 'are', 'by', 'cai', 'cho', 'co', 'cua', 'data',
  'du', 'duoc', 'gi', 'he', 'is', 'la', 'mot', 'nao', 'nhung', 'of', 'the', 'thi', 'thong',
  'to', 'trong', 'va', 've', 'voi', 'what', 'why'])

const aliases = Object.freeze({
  'asset.canonical_event': 'event su kien canonical stored rows event counts',
  'asset.journey': 'journey hanh trinh nguoi dung visitor session identity',
  'asset.journey_event': 'journey event lien ket su kien hanh trinh confidence',
  'asset.funnel_instance': 'funnel pheu chuyen doi conversion funnel instance',
  'asset.funnel_kpi_instance': 'funnel kpi pheu chuyen doi entrants pending dropped',
  'asset.funnel_kpi_step': 'funnel step buoc pheu reached step',
  'asset.funnel_maturity_finalization': 'funnel maturity ket thuc pheu finalization',
  'asset.funnel_late_conversion': 'late conversion chuyen doi muon sau finalization',
  'asset.fact_order': 'order don hang doanh thu gia tri don hang gross order value aov',
  'asset.ordered_product_item': 'product san pham gia tri san pham quantity price ordered item',
  'asset.current_product_reference': 'product catalog ten san pham danh muc current name',
  'asset.traffic_source_input': 'traffic nguon truy cap utm chien dich campaign',
  'asset.reconciliation_comparison': 'reconciliation doi soat so sanh source pipeline',
  'asset.canonicalization_outcome': 'canonicalization chuan hoa event outcome mapping',
  'asset.ingress_accepted_receipt': 'ingress accepted receipt nhan su kien',
  'asset.current_projection_record': 'current projection trang thai hien tai reconciliation',
})

function tokens(value) {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').match(/[a-z0-9]+/g)?.filter(token => token.length > 1 && !stopWords.has(token)) ?? []
}

export function embedMetadataText(value) {
  const vector = new Float64Array(dimensions)
  for (const token of tokens(value)) {
    const digest = createHash('sha256').update(token).digest()
    vector[digest.readUInt32BE(0) % dimensions] += 1
  }
  const length = Math.hypot(...vector)
  return length ? vector.map(value => value / length) : vector
}

export function buildMetadataVectorIndex(catalog) {
  validateAnalyticalCoverage(catalog)
  const catalogDigest = createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
  return Object.freeze({ catalogId: catalog.catalog_id, version: catalog.version,
    status: catalog.status, runtimePublished: catalog.runtime_published,
    catalogDigest,
    projectionDigest: createHash('sha256').update(`${catalogDigest}:${embeddingVersion}:${JSON.stringify(aliases)}`).digest('hex'),
    entries: catalog.assets.map(asset => Object.freeze({
      id: asset.id, description: asset.description, authority: asset.authority,
      qualityRequirements: asset.quality_requirements, limitations: asset.limitations,
      toolRefs: asset.tool_refs, availability: asset.availability,
      terms: new Set(tokens(`${asset.id} ${aliases[asset.id] ?? ''} ${asset.measures.map(item => item.id).join(' ')}`)),
      vector: embedMetadataText(`${asset.id} ${aliases[asset.id] ?? ''} ${asset.measures.map(item => item.id).join(' ')}`),
    })),
  })
}

function pointId(assetId) {
  const hex = createHash('sha256').update(assetId).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function clientConfig(env) {
  if (env.DASHBOARD_ENABLE_VECTOR_KNOWLEDGE !== 'true') return null
  let url
  try { url = new URL(env.QDRANT_KNOWLEDGE_URL) } catch { throw Error('invalid_knowledge_url') }
  const collection = env.QDRANT_KNOWLEDGE_COLLECTION || 'funnelmetry_metadata_v1'
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || !/^[a-z][a-z0-9_]{2,62}$/.test(collection)) throw Error('invalid_knowledge_config')
  return { baseUrl: url.origin, collection }
}

async function qdrantRequest(config, path, body, fetchImpl, signal) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(3000)]),
  })
  if (!response.ok) throw Error('knowledge_unavailable')
  const json = await response.json()
  if (json?.status !== 'ok' || !json.result) throw Error('knowledge_unavailable')
  return json.result
}

export function createMetadataVectorRetriever({ env = process.env, fetchImpl = fetch,
  load = loadAnalyticalCoverage } = {}) {
  const config = clientConfig(env)
  let indexPromise
  const retrieve = async (question, signal) => {
    if (!config) throw Error('knowledge_disabled')
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) throw Error('invalid_knowledge_query')
    const queryTerms = new Set(tokens(question))
    if (!queryTerms.size) return { index: await (indexPromise ??= Promise.resolve().then(load).then(buildMetadataVectorIndex)), hits: [] }
    indexPromise ??= Promise.resolve().then(load).then(buildMetadataVectorIndex)
    const index = await indexPromise
    const points = await qdrantRequest(config, `/collections/${config.collection}/points/search`, {
      vector: [...embedMetadataText(question)], limit: 5, with_payload: true,
      filter: { must: [{ key: 'projection_digest', match: { value: index.projectionDigest } }] },
    }, fetchImpl, signal)
    if (!Array.isArray(points)) throw Error('knowledge_unavailable')
    const byId = new Map(index.entries.map(entry => [entry.id, entry]))
    const candidates = points.filter(point => point?.payload?.catalog_digest === index.catalogDigest
      && point?.payload?.projection_digest === index.projectionDigest
      && point?.payload?.embedding_version === embeddingVersion
      && Number.isFinite(point.score) && point.score >= 0.15
      && byId.has(point?.payload?.asset_id))
      .map(point => ({ entry: byId.get(point.payload.asset_id), similarity: point.score }))
      .filter(hit => [...queryTerms].some(term => hit.entry.terms.has(term)))
    const hits = candidates.filter((hit, index) => index === 0 || hit.similarity >= candidates[0].similarity * 0.9)
      .slice(0, 2)
    return { index, hits }
  }
  return Object.freeze({ enabled: !!config, retrieve })
}

export async function syncMetadataVectors({ env = process.env, fetchImpl = fetch,
  load = loadAnalyticalCoverage } = {}) {
  const config = clientConfig(env)
  if (!config) throw Error('knowledge_disabled')
  const index = buildMetadataVectorIndex(await load())
  const collectionUrl = `${config.baseUrl}/collections/${config.collection}`
  let response = await fetchImpl(collectionUrl, { signal: AbortSignal.timeout(3000) })
  if (response.status === 404) {
    response = await fetchImpl(collectionUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: dimensions, distance: 'Cosine' } }), signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error('knowledge_index_unavailable')
  } else if (!response.ok || (await response.json())?.result?.config?.params?.vectors?.size !== dimensions) {
    throw Error('knowledge_index_incompatible')
  }
  response = await fetchImpl(`${collectionUrl}/points?wait=true`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ points: index.entries.map(entry => ({ id: pointId(entry.id), vector: [...entry.vector],
      payload: { asset_id: entry.id, catalog_id: index.catalogId, catalog_version: index.version,
        catalog_digest: index.catalogDigest, projection_digest: index.projectionDigest,
        embedding_version: embeddingVersion } })) }),
  })
  if (!response.ok || (await response.json())?.status !== 'ok') throw Error('knowledge_index_unavailable')
  return { catalog_id: index.catalogId, catalog_version: index.version,
    catalog_digest: index.catalogDigest, projection_digest: index.projectionDigest,
    points: index.entries.length }
}

export function renderMetadataKnowledge(index, hits) {
  if (!hits.length) return null
  const lines = hits.map(({ entry }) => {
    const status = entry.toolRefs.length ? `Tool được khai báo trong metadata: ${entry.toolRefs.join(', ')}; cần kiểm tra runtime/quality trước khi sử dụng.`
      : 'Chưa có tool phân tích cho mục này; mô tả metadata không tự bật quyền truy vấn.'
    return `[${entry.id}@${index.version}] ${entry.description}\nNguồn ý nghĩa: ${entry.authority}\n`
      + `${status}\nGiới hạn: ${entry.limitations.join(' ')}`
  })
  return `Mình tìm thấy mô tả liên quan trong metadata (${index.status}, chưa công bố runtime):\n\n${lines.join('\n\n')}`
}
