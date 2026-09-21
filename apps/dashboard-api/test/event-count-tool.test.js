import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEventCounts } from '../src/lib/ai/event-count-tool.js'
import { selectChatTool } from '../src/lib/ai/tool-plan.js'

const scope = { sourceId: 'medusa-reference', from: '2026-09-01T00:00:00Z', to: '2026-09-03T00:00:00Z' }
const actor = { id: 'test', session_version: 0 }
const execute = async () => [{ role: 'analyst', is_active: true, session_version: 0 }]
const readOnly = async work => work(async (sql, params) => {
  assert.match(sql, /LIMIT 10001/)
  assert.doesNotMatch(sql, /SELECT \*|identity|payload/)
  assert.deepEqual(params, [scope.sourceId, scope.from, scope.to])
  return [{ event_type: 'order.created' }, { event_type: 'order.created' }]
})

test('tool exports only validated counts and enforces session and row budget', async () => {
  const runner = async input => {
    assert.deepEqual(input, { event_types: ['order.created', 'order.created'] })
    return { total_events: 2, counts: [{ event_type: 'order.created', count: 2 }] }
  }
  const args = { actor, scope, execute, readOnly, runner }
  assert.equal((await loadEventCounts(args)).data.total_events, 2)
  await assert.rejects(loadEventCounts({ ...args, execute: async () => [] }), /session_expired/)
  await assert.rejects(loadEventCounts({ ...args, execute: async () => [{ role: 'super_admin', is_active: true, session_version: 0 }] }), /forbidden/)
  await assert.rejects(loadEventCounts({ ...args, readOnly: async () => Array(10001).fill({ event_type: 'a.b' }) }), /budget/)
  await assert.rejects(loadEventCounts({ ...args, runner: async () => ({ total_events: 2, counts: [{ event_type: 'order.created', count: 1 }] }) }), /invalid_tool_result/)
})

test('planner restricts tool names, parameters and requested window', async () => {
  const provider = value => ({ complete: async () => ({ text: JSON.stringify(value) }) })
  const plan = await selectChatTool(provider({ tool: 'event_counts', last_hours: 24 }), 'count', scope)
  assert.equal(plan.scope.from, '2026-09-02T00:00:00.000Z')
  for (const bad of [{ tool: 'sql', last_hours: null }, { tool: 'event_counts', last_hours: null, sql: 'DROP' }, { tool: 'event_counts', last_hours: -1 }]) {
    await assert.rejects(selectChatTool(provider(bad), 'count', scope), /invalid_tool_plan/)
  }
  await assert.rejects(selectChatTool(provider({ tool: 'event_counts', last_hours: 72 }), 'count', scope), /outside_window/)
})
