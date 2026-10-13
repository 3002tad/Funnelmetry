import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import express from 'express'
import jwt from 'jsonwebtoken'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'traffic-registry-test-only-secret', JWT_EXPIRES: '1h',
  DASHBOARD_ADMIN_EMAIL: 'admin@example.test', DASHBOARD_ADMIN_PASSWORD: 'test-only-password',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test' })
const { createTrafficSourceRegistryRouter } = await import('../src/routes/traffic-source-registry.js')
const { parseMappingMutation, rawSourceHash, saveTrafficMapping, TRAFFIC_SOURCE_LABELS_SQL } =
  await import('../src/lib/traffic-source-registry.js')

const actor = { id: '00000000-0000-4000-8000-000000000001', session_version: 1 }
const input = (raw, label, expectedVersion = null) => parseMappingMutation({
  source_id: 'medusa-reference', raw_utm_source: raw, canonical_label: label, expected_version: expectedVersion,
})

test('registry matches exact browser raw bytes without storing or returning raw values', () => {
  assert.equal(rawSourceHash('Google'), createHash('sha256').update('Google').digest('hex'))
  assert.notEqual(rawSourceHash('Google'), rawSourceHash('google'))
  assert.notEqual(rawSourceHash(' google'), rawSourceHash('google'))
  assert.equal(rawSourceHash(''), createHash('sha256').update('').digest('hex'))
  assert.throws(() => input('google\n', 'google'))
  assert.throws(() => input('google', 'Google'))
  assert.throws(() => parseMappingMutation({ source_id: 'medusa-reference',
    raw_utm_source: 'google', canonical_label: 'google' }))
  assert.throws(() => input('google', 'google', 0))
  assert.ok(!TRAFFIC_SOURCE_LABELS_SQL.includes('raw_utm_source_hash AS'))
})

test('mapping create, idempotent retry and versioned replacement append audit only on change', async () => {
  let role = 'analyst', version = 1
  let state = null
  const audit = []
  const statements = []
  const run = async work => work(async (sql, params) => {
    statements.push({ sql, params })
    if (sql.includes('FROM dashboard_users')) return [{ role, is_active: true, session_version: version }]
    if (sql.startsWith('INSERT INTO traffic_source_registry_v1')) {
      if (state) return []
      state = { canonical_label: params[2], version: 1, updated_at: '2026-10-12T00:00:00Z' }
      return [state]
    }
    if (sql.startsWith('UPDATE traffic_source_registry_v1')) {
      if (!state || state.version !== params[4] || state.canonical_label === params[2]) return []
      state = { canonical_label: params[2], version: state.version + 1, updated_at: '2026-10-12T01:00:00Z' }
      return [state]
    }
    if (sql.startsWith('SELECT canonical_label, version')) return state ? [state] : []
    if (sql.startsWith('INSERT INTO traffic_source_registry_audit_v1')) { audit.push(params); return [] }
    throw Error('unexpected SQL')
  })
  const created = await saveTrafficMapping(input('Google', 'search'), actor, run)
  assert.deepEqual({ label: created.canonical_label, version: created.version, changed: created.changed },
    { label: 'search', version: 1, changed: true })
  assert.equal((await saveTrafficMapping(input('Google', 'search'), actor, run)).changed, false)
  await assert.rejects(saveTrafficMapping(input('Google', 'social'), actor, run), { status: 409 })
  const replaced = await saveTrafficMapping(input('Google', 'social', 1), actor, run)
  assert.equal(replaced.version, 2)
  await assert.rejects(saveTrafficMapping(input('Google', 'search', 1), actor, run), { status: 409 })
  assert.equal(audit.length, 2)
  assert.deepEqual(audit.map(row => row[5]), ['ASSIGNED', 'REASSIGNED'])
  assert.ok(!JSON.stringify(statements).includes('Google'))
  role = 'staff'; await assert.rejects(saveTrafficMapping(input('Other', 'social'), actor, run), { status: 403 })
  role = 'analyst'; version = 2
  await assert.rejects(saveTrafficMapping(input('Other', 'social'), actor, run), { status: 401 })
  assert.equal(audit.length, 2)
})

test('registry HTTP routes protect lookup/mutation and redact raw/hash', async () => {
  let role = 'analyst', version = 1
  const calls = []
  const execute = async (sql, params) => {
    if (sql.startsWith('SELECT role')) return [{ role, is_active: true, session_version: version }]
    calls.push({ sql, params })
    if (sql === TRAFFIC_SOURCE_LABELS_SQL) return [{ canonical_label: 'search', raw_variant_count: '2', updated_at: '2026-10-12T00:00:00Z' }]
    return [{ canonical_label: 'search', version: 3, updated_at: '2026-10-12T00:00:00Z' }]
  }
  const app = express(); app.use(express.json()); app.use(createTrafficSourceRegistryRouter({ execute,
    run: async work => work(async sql => sql.includes('FROM dashboard_users')
      ? [{ role, is_active: true, session_version: version }] : [{ canonical_label: 'search', version: 1, updated_at: '2026-10-12T00:00:00Z' }]) }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: actor.id, role: 'analyst', session_version: 1 }, process.env.JWT_SECRET)
  const base = `http://127.0.0.1:${server.address().port}/api/v2/analytics/traffic-source-registry`
  const post = (path, body, auth = true) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) })
  try {
    assert.equal((await post('/lookup', { source_id: 'medusa-reference', raw_utm_source: 'Google' }, false)).status, 401)
    const lookup = await post('/lookup', { source_id: 'medusa-reference', raw_utm_source: 'Google' })
    assert.equal(lookup.status, 200)
    const result = await lookup.json()
    assert.equal(result.version, 3)
    assert.ok(!JSON.stringify(result).includes('Google'))
    assert.ok(!JSON.stringify(result).includes(rawSourceHash('Google')))
    assert.equal(calls.at(-1).params[1], rawSourceHash('Google'))
    const labels = await fetch(base + '?source_id=medusa-reference', { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(labels.status, 200)
    assert.equal((await labels.json()).labels[0].raw_variant_count, '2')
    assert.equal((await post('', { source_id: 'medusa-reference', raw_utm_source: 'Google',
      canonical_label: 'Bad Label', expected_version: null })).status, 400)
    role = 'staff'
    assert.equal((await post('/lookup', { source_id: 'medusa-reference', raw_utm_source: 'Google' })).status, 403)
    role = 'analyst'; version = 2
    assert.equal((await post('/lookup', { source_id: 'medusa-reference', raw_utm_source: 'Google' })).status, 401)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
