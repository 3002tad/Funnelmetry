import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

Object.assign(process.env, {
  PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'agent-observability-test', JWT_EXPIRES: '1h',
  DASHBOARD_ADMIN_EMAIL: 'test@example.invalid', DASHBOARD_ADMIN_PASSWORD: 'test',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'unused',
  POSTGRES_USER: 'unused', POSTGRES_PASSWORD: 'unused',
  DASHBOARD_ENABLE_AI: 'false', DASHBOARD_ENABLE_LEGACY: 'false',
})

const { createAgentObservabilityRouter } = await import('../src/routes/agent-observability.js')

test('Agent observability counts only persisted completed tool evidence and hides private fields', async () => {
  let role = 'analyst', version = 1, reads = 0, fail = false, revoke = false, empty = false
  const app = express()
  app.use(createAgentObservabilityRouter({
    execute: async () => [{ role, is_active: true, session_version: version }],
    readOnly: async work => work(async (sql, args) => {
      reads++
      assert.match(sql, /FROM analytical_execution_evidence/)
      assert.match(sql, /interval '30 days'/)
      assert.match(sql, /COUNT\(\*\)::text/)
      assert.doesNotMatch(sql, /document|actor_id|prompt/i)
      assert.equal(args, undefined)
      if (fail) throw Error('PRIVATE_DATABASE_ERROR')
      if (revoke) version++
      if (empty) return []
      return [{ status: 'ERROR', execution_count: '9007199254740993',
        latest_created_at: '2026-10-12T00:00:00.000Z', actor_id: 'PRIVATE_ACTOR' }]
    }),
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'admin', role: 'super_admin', session_version: 1 }, process.env.JWT_SECRET)
  const get = (suffix = '', auth = true) => fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/agent-observability${suffix}`,
    { headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await get('', false)).status, 401)
    assert.equal((await get()).status, 403)
    assert.equal(reads, 0)
    role = 'super_admin'
    assert.equal((await get('?days=365')).status, 400)
    const response = await get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.status_counts.ERROR, '9007199254740993')
    assert.equal(body.status_counts.PROVISIONAL, '0')
    assert.equal(body.scope, 'PERSISTED_COMPLETED_ANALYTICAL_TOOL_EXECUTIONS_ONLY')
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE/)
    empty = true
    const noEvidence = await (await get()).json()
    assert.equal(noEvidence.status_counts.ERROR, '0')
    assert.equal(noEvidence.latest_execution_at, null)
    empty = false
    fail = true
    assert.equal((await get()).status, 503)
    fail = false
    revoke = true
    assert.equal((await get()).status, 401)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
