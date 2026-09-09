import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountSchemaError, assertAccountSchema, prepareAccountStartup } from '../src/lib/account-schema.js'

const complete = { session_column: true, session_trigger: true, staff_constraint: true }
test('startup rejects incomplete security schema before any seed or retry', async () => {
  for (const missing of Object.keys(complete)) {
    let seeded = false, waited = false
    await assert.rejects(prepareAccountStartup({
      execute: async sql => sql.includes('pg_attribute') ? [{ ...complete, [missing]: false }] : [],
      seed: async () => { seeded = true }, wait: async () => { waited = true },
    }), AccountSchemaError)
    assert.equal(seeded, false)
    assert.equal(waited, false)
  }
})
test('missing tables become an actionable schema error without DB details', async () => {
  await assert.rejects(assertAccountSchema(async () => { throw Object.assign(Error('private'), { code: '42P01' }) }),
    error => error instanceof AccountSchemaError && !error.message.includes('private'))
})
test('startup retries transient failures, succeeds once, and stops after exhausted attempts', async () => {
  let calls = 0, seeds = 0, waits = 0
  await prepareAccountStartup({ execute: async sql => {
    if (++calls === 1) throw Error('offline')
    return sql.includes('pg_attribute') ? [complete] : []
  }, seed: async () => { seeds++ }, wait: async () => { waits++ } })
  assert.equal(seeds, 1)
  assert.equal(waits, 1)
  let failedCalls = 0
  await assert.rejects(prepareAccountStartup({ attempts: 2,
    execute: async () => { failedCalls++; throw Error('offline') },
    seed: async () => assert.fail('must not seed'), wait: async () => {},
  }), /offline/)
  assert.equal(failedCalls, 2)
})
