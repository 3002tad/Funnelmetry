import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAuditQuery } from '../src/lib/account-audit.js'

test('audit filters are bounded and reject malformed or repeated values', () => {
  assert.deepEqual(parseAuditQuery({}), { limit: 25 })
  assert.equal(parseAuditQuery({ limit: '100', action: 'password.changed' }).limit, 100)
  for (const query of [{ limit: '0' }, { limit: '101' }, { limit: ['1', '2'] },
    { action: ['account.created'] }, { actor_id: "' OR true--" }, { target_id: 'bad' },
    { arbitrary: 'field' }, { cursor: 'bad' }, { cursor: ['bad'] }]) {
    assert.throws(() => parseAuditQuery(query))
  }
  const cursor = at => Buffer.from(JSON.stringify({ at, id: '00000000-0000-4000-8000-000000000001' })).toString('base64url')
  assert.equal(parseAuditQuery({ cursor: cursor('2026-09-09T01:00:00.123456Z') }).cursor.at, '2026-09-09T01:00:00.123456Z')
  assert.throws(() => parseAuditQuery({ cursor: cursor('2026-02-30T01:00:00.123456Z') }))
})
