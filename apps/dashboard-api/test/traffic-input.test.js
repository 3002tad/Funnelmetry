import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'traffic-input-test-only-secret', JWT_EXPIRES: '1h',
  DASHBOARD_ADMIN_EMAIL: 'admin@example.test', DASHBOARD_ADMIN_PASSWORD: 'test-only-password',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test' })
const { createTrafficInputRouter, TRAFFIC_INPUT_SUMMARY_SQL, TRAFFIC_INPUT_BREAKDOWN_SQL, trafficInputContract } =
  await import('../src/routes/traffic-input.js')

test('traffic input SQL is aggregate-only and contract does not claim attribution', () => {
  assert.match(TRAFFIC_INPUT_SUMMARY_SQL, /source_id = \$1 AND received_at >= \$2::timestamptz AND received_at < \$3::timestamptz/)
  assert.ok(!/utm_source_hash|raw_body|source_payload/.test(TRAFFIC_INPUT_SUMMARY_SQL))
  assert.match(TRAFFIC_INPUT_BREAKDOWN_SQL, /r\.raw_utm_source_hash=t\.utm_source_hash/)
  assert.ok(!TRAFFIC_INPUT_BREAKDOWN_SQL.split('FROM')[0].includes('hash'))
  assert.equal(trafficInputContract.input_grain, 'source_id × source_event_id')
  assert.equal(trafficInputContract.time_basis, 'received_at')
})

test('Traffic API checks live analyst permission, bounds window, and preserves failure', async () => {
  let role = 'analyst', version = 0, fail = false, changeAfterQuery = () => {}
  const calls = []
  const execute = async (sql, params) => {
    if (sql.startsWith('SELECT role')) return [{ role, is_active: true, session_version: version }]
    calls.push({ sql, params })
    if (fail) throw Error('private database failure')
    changeAfterQuery()
    if (sql === TRAFFIC_INPUT_BREAKDOWN_SQL) return [
      { canonical_label: 'search', event_count: '2' },
      { canonical_label: null, event_count: '1' },
    ]
    return [{ observed_events: '9007199254740993', present_events: '2', absent_events: '1',
      invalid_events: '0', synthetic_events: '1', latest_received_at: '2026-10-12T01:00:00Z',
      utm_source_hash: 'must-not-leak' }]
  }
  const app = express(); app.use(createTrafficInputRouter({ execute, readOnly: work => work(execute) }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'analyst', role: 'analyst', session_version: 0 }, process.env.JWT_SECRET)
  const base = `http://127.0.0.1:${server.address().port}/api/v2/analytics/traffic-input`
  const get = (query = '?source_id=medusa-reference&from=2026-10-11&to=2026-10-12', auth = true) =>
    fetch(`${base}${query}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await get(undefined, false)).status, 401)
    for (const query of ['?source_id=medusa-reference',
      '?source_id=medusa-reference&from=2026-01-01&to=2026-10-12',
      '?source_id=medusa-reference&from=2026-10-11&to=2026-10-12&raw=true']) {
      assert.equal((await get(query)).status, 400)
    }
    assert.equal(calls.length, 0)
    const response = await get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.observed_events, '9007199254740993')
    assert.equal(body.attribution_verified, false)
    assert.equal(body.historical_coverage_verified, false)
    assert.ok(!JSON.stringify(body).includes('must-not-leak'))
    assert.deepEqual(calls[0].params, ['medusa-reference', '2026-10-11T00:00:00.000Z', '2026-10-12T00:00:00.000Z'])
    const grouped = await fetch(`${base}/breakdown?source_id=medusa-reference&from=2026-10-11&to=2026-10-12`,
      { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(grouped.status, 200)
    const groups = await grouped.json()
    assert.equal(groups.items[0].canonical_label, 'search')
    assert.equal(groups.items[1].canonical_label, null)
    assert.equal(groups.attribution_verified, false)
    assert.ok(!JSON.stringify(groups).includes('must-not-leak'))
    role = 'super_admin'; assert.equal((await get()).status, 403)
    role = 'analyst'; changeAfterQuery = () => { version++ }
    assert.equal((await get()).status, 401)
    version = 0; changeAfterQuery = () => {}; fail = true
    const unavailable = await get()
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { error: 'traffic_input_unavailable' })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
