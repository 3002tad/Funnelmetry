import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSourcesQuery, listObservedSources } from '../src/lib/admin-sources.js'

test('source inventory filters are bounded and use parameterized exact source IDs', async () => {
  assert.deepEqual(parseSourcesQuery({}), { limit: 25, after: null, source_id: null })
  for (const query of [{ limit: '0' }, { limit: '101' }, { limit: ['1','2'] }, { after: '' },
    { source_id: ['shop'] }, { source_id: 'x'.repeat(201) }, { after: '\n' }, { secret: 'x' }]) {
    assert.throws(() => parseSourcesQuery(query))
  }
  const source = "shop' OR 1=1 --"
  const page = await listObservedSources(async (sql, params) => {
    assert.equal(sql.includes(source), false)
    assert.deepEqual(params, [null, source, 2])
    return [{ source_id: 'a' }, { source_id: 'b' }]
  }, parseSourcesQuery({ limit: '1', source_id: source }))
  assert.equal(page.next_after, 'a')
  assert.equal(page.items[0].connection_status, 'UNVERIFIED')
  assert.equal(page.scope, 'retained_observed_sources')
})
