import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachGuardedSse } from '../src/lib/guarded-sse.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(overrides = {}) {
  const req = new EventEmitter(), res = new EventEmitter(), bus = new EventEmitter()
  const frames = []
  let ended = false
  res.write = data => { frames.push(data); return true }
  res.end = () => { ended = true }
  const close = attachGuardedSse({ req, res, bus,
    claims: { sub: 'user', session_version: 0, exp: 200 }, now: () => 100000,
    execute: async () => [{ role: 'analyst', is_active: true, session_version: 0 }],
    ...overrides })
  return { req, res, bus, frames, close, ended: () => ended }
}
test('SSE checks revocation before payload delivery and cleans listeners', async () => {
  let version = 0
  const f = fixture({ execute: async () => [{ role: 'analyst', is_active: true, session_version: version }] })
  try {
    f.bus.emit('events', [{ event_id: 'first' }]); await tick()
    assert.equal(f.frames.length, 1)
    version++
    f.bus.emit('events', [{ event_id: 'must-not-send' }]); await tick()
    assert.equal(f.frames.length, 1)
    assert.equal(f.ended(), true)
    assert.equal(f.bus.listenerCount('events'), 0)
    assert.equal(f.bus.listenerCount('kpi'), 0)
  } finally { f.close() }
})
test('SSE closes for expiration, inactive account, removed capability and DB error', async () => {
  for (const override of [
    { now: () => 200000 },
    { execute: async () => [{ role: 'analyst', is_active: false, session_version: 0 }] },
    { execute: async () => [{ role: 'staff', is_active: true, session_version: 0 }] },
    { execute: async () => { throw Error('private') } },
  ]) {
    const f = fixture(override)
    try {
      f.bus.emit('events', ['private']); await tick()
      assert.equal(f.ended(), true)
      assert.equal(f.frames.length, 0)
    } finally { f.close() }
  }
})
test('SSE drops queued work when disconnected or overloaded', async () => {
  let release
  const f = fixture({ maxPending: 1, execute: () => new Promise(resolve => { release = resolve }) })
  f.bus.emit('events', ['first'])
  f.bus.emit('events', ['second'])
  f.bus.emit('events', ['overflow'])
  assert.equal(f.ended(), true)
  release([{ role: 'analyst', is_active: true, session_version: 0 }])
  await tick()
  assert.equal(f.frames.length, 0)
  f.close()
  const disconnected = fixture()
  disconnected.res.emit('close')
  assert.equal(disconnected.bus.listenerCount('events'), 0)
})
test('SSE closes idle revoked streams and timed-out authorization queries', async () => {
  for (const options of [
    { execute: async () => [], intervalMs: 5 },
    { execute: () => new Promise(() => {}), intervalMs: 5, timeoutMs: 5 },
  ]) {
    const f = fixture(options)
    try {
      await new Promise(resolve => setTimeout(resolve, 60))
      assert.equal(f.ended(), true)
      assert.equal(f.frames.length, 0)
    } finally { f.close() }
  }
})
