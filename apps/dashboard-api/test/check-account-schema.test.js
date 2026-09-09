import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAccountSchema } from '../src/lib/check-account-schema.js'

const env = { POSTGRES_HOST: 'test', POSTGRES_PORT: '5432', POSTGRES_DB: 'test',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'must-not-log' }
test('schema check needs DB configuration only, validates inputs without connecting', async () => {
  assert.equal((await checkAccountSchema({}, () => assert.fail())).status, 'INVALID_CONFIG')
  assert.equal((await checkAccountSchema({ ...env, POSTGRES_PORT: '0' }, () => assert.fail())).status, 'INVALID_CONFIG')
})
test('schema check runs in a read-only transaction and always closes its connection', async () => {
  for (const mode of ['ready', 'missing', 'offline']) {
    const calls = []
    let closed = false
    const result = await checkAccountSchema(env, () => ({
      connect: async () => { if (mode === 'offline') throw Error('must-not-log') },
      query: async sql => {
        calls.push(sql)
        if (mode === 'missing' && sql.includes('FROM dashboard_users')) throw Object.assign(Error('must-not-log'), { code: '42P01' })
        return { rows: sql.includes('pg_attribute') ? [{ session_column: true, session_trigger: true, staff_constraint: true }] : [] }
      },
      end: async () => { closed = true },
    }))
    assert.equal(result.status, { ready: 'READY', missing: 'MIGRATION_REQUIRED', offline: 'UNAVAILABLE' }[mode])
    assert.equal(JSON.stringify(result).includes('must-not-log'), false)
    assert.equal(closed, true)
    if (mode !== 'offline') assert.equal(calls[0], 'BEGIN READ ONLY')
    if (mode === 'ready') assert.equal(calls.at(-1), 'COMMIT')
  }
})
