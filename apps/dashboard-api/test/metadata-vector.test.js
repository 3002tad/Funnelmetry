import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMetadataVectorIndex, createMetadataVectorRetriever, embedMetadataText,
  renderMetadataKnowledge, syncMetadataVectors } from '../src/lib/ai/metadata-vector.js'
import { loadAnalyticalCoverage } from '../../../analytics/src/analytical-coverage.mjs'

const env = { DASHBOARD_ENABLE_VECTOR_KNOWLEDGE: 'true',
  QDRANT_KNOWLEDGE_URL: 'http://qdrant:6333', QDRANT_KNOWLEDGE_COLLECTION: 'funnelmetry_metadata_v1' }

test('knowledge vectors are deterministic and the index contains metadata only', async () => {
  const index = buildMetadataVectorIndex(await loadAnalyticalCoverage())
  assert.equal(index.entries.length, 16)
  assert.equal(index.status, 'DRAFT_COVERAGE')
  assert.equal(embedMetadataText('đơn hàng').length, 384)
  assert.deepEqual([...embedMetadataText('đơn hàng')], [...embedMetadataText('don hang')])
  assert.ok(index.entries.find(entry => entry.id === 'asset.fact_order').vector.some(value => value > 0))
  assert.match(renderMetadataKnowledge(index, [{ entry: index.entries.find(entry => entry.id === 'asset.fact_order') }]),
    /not paid\/captured\/net revenue/i)
})

test('Qdrant sync stores only asset IDs/version/hash, and lookup resolves authoritative metadata', async () => {
  let points, query
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/collections/funnelmetry_metadata_v1') && !options.method) {
      return { status: 404 }
    }
    if (options.method === 'PUT' && url.endsWith('/collections/funnelmetry_metadata_v1')) {
      assert.deepEqual(JSON.parse(options.body), { vectors: { size: 384, distance: 'Cosine' } })
      return { ok: true }
    }
    if (options.method === 'PUT' && url.endsWith('/points?wait=true')) {
      points = JSON.parse(options.body).points
      return { ok: true, json: async () => ({ status: 'ok' }) }
    }
    if (options.method === 'POST' && url.endsWith('/points/search')) {
      query = JSON.parse(options.body)
      return { ok: true, json: async () => ({ status: 'ok', result: [
        { score: 0.8, payload: points.find(point => point.payload.asset_id === 'asset.fact_order').payload },
        { score: 0.9, payload: { ...points[0].payload, catalog_digest: 'stale' } },
      ] }) }
    }
    assert.fail(`Unexpected Qdrant request: ${url}`)
  }
  const synced = await syncMetadataVectors({ env, fetchImpl })
  assert.equal(synced.points, 16)
  assert.equal(points.length, 16)
  assert.ok(points.every(point => Object.keys(point.payload).sort().join(',')
    === 'asset_id,catalog_digest,catalog_id,catalog_version,embedding_version,projection_digest'))
  const retriever = createMetadataVectorRetriever({ env, fetchImpl })
  const { hits, index } = await retriever.retrieve('Giá trị đơn hàng là gì?')
  assert.equal(query.vector.length, 384)
  assert.equal(query.filter.must[0].match.value, synced.projection_digest)
  assert.deepEqual(hits.map(hit => hit.entry.id), ['asset.fact_order'])
  assert.equal(index.catalogId, 'funnelmetry-analytical-coverage')
})

test('Qdrant is opt-in, never silently falls back to local/vector or numeric answers', async () => {
  const retriever = createMetadataVectorRetriever({ env: {} })
  assert.equal(retriever.enabled, false)
  await assert.rejects(retriever.retrieve('phễu là gì'), /knowledge_disabled/)
  const unavailable = createMetadataVectorRetriever({ env, fetchImpl: async () => ({ ok: false }) })
  await assert.rejects(unavailable.retrieve('phễu là gì'), /knowledge_unavailable/)
  assert.throws(() => createMetadataVectorRetriever({ env: { ...env, QDRANT_KNOWLEDGE_URL: 'http://user:pass@qdrant:6333' } }),
    /invalid_knowledge_config/)
})
