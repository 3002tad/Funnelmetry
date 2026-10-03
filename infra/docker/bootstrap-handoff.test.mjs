import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { bootstrap, validateTarget } from './bootstrap-handoff.mjs'
const files = ['one.sql'], sql = ['SELECT 1']
const digest = createHash('sha256').update(JSON.stringify([['one.sql', 'SELECT 1']])).digest('hex')
function fake(tables = [], state, failSql = false) {
  const calls = []
  return { calls, async query(q, args) {
    calls.push([q, args])
    if (q.includes('FROM pg_tables')) return { rows: tables.map(tablename => ({ tablename })) }
    if (q.includes('SELECT status')) return { rows: state ? [state] : [] }
    if (q === 'SELECT 1' && failSql) throw Error('test failure')
    return { rows: [] }
  } }
}
test('only the declared offline target is accepted', () => {
  const good = { HANDOFF_MODE: 'OFFLINE_DEMO', POSTGRES_HOST: 'postgres', POSTGRES_DB: 'funnelmetry_handoff' }
  assert.doesNotThrow(() => validateTarget(good))
  for (const key of Object.keys(good)) assert.throws(() => validateTarget({ ...good, [key]: 'other' }))
})
test('fresh database installs in order and marks READY last', async () => {
  const c = fake()
  await bootstrap(c, files, sql, () => {})
  assert.match(c.calls[0][0], /pg_advisory_lock/)
  assert.match(c.calls.at(-1)[0], /SET status='READY'/)
  assert.deepEqual(c.calls.find(([q]) => q.startsWith('INSERT'))[1], [digest])
})
test('unknown existing database is never modified', async () => {
  const c = fake(['canonical_events'])
  await assert.rejects(bootstrap(c, files, sql), /NOT_EMPTY/)
  assert.equal(c.calls.length, 2)
})
test('matching completed bootstrap is a read-only resume', async () => {
  const c = fake(['handoff_bootstrap'], { status: 'READY', schema_digest: digest })
  await bootstrap(c, files, sql, () => {})
  assert.ok(c.calls.every(([q]) => q.startsWith('SELECT')))
})
test('partial installs and changed migration artifacts require review', async () => {
  for (const state of [undefined, { status: 'INSTALLING', schema_digest: digest }, { status: 'READY', schema_digest: 'old' }]) {
    const c = fake(['handoff_bootstrap'], state)
    await assert.rejects(bootstrap(c, files, sql), /OPERATOR_REVIEW/)
    assert.ok(c.calls.every(([q]) => q.startsWith('SELECT')))
  }
})
test('SQL failure never marks the package READY', async () => {
  const c = fake([], undefined, true)
  await assert.rejects(bootstrap(c, files, sql, () => {}))
  assert.ok(!c.calls.some(([q]) => q.startsWith('UPDATE')))
})
