// Operator check; no JWT creation, user impersonation, writes or chat-history mutation.
import assert from 'node:assert/strict'
import { readOnlyTransaction, closeDatabase } from '../src/db.js'
import { runPolars } from '../src/lib/ai/event-count-tool.js'
import { selectChatTool } from '../src/lib/ai/tool-plan.js'
import { createDashScopeClient } from '../src/lib/ai/dashscope.js'

try {
  const to = new Date(), from = new Date(to.getTime() - 86400000)
  const scope = { sourceId: 'medusa-reference', from: from.toISOString(), to: to.toISOString() }
  const snapshot = await readOnlyTransaction(async execute => {
    const [row] = await execute(`WITH rows AS MATERIALIZED (
      SELECT event_type FROM canonical_events WHERE source_id=$1 AND occurred_at >= $2 AND occurred_at < $3
      ORDER BY occurred_at, canonical_event_id LIMIT 10001
    ), counts AS (SELECT event_type, count(*)::int AS count FROM rows GROUP BY event_type)
    SELECT COALESCE((SELECT json_agg(event_type) FROM rows), '[]') AS event_types,
      COALESCE((SELECT json_agg(counts ORDER BY event_type) FROM counts), '[]') AS counts`,
    [scope.sourceId, scope.from, scope.to])
    return row
  })
  assert.ok(snapshot.event_types.length > 0 && snapshot.event_types.length <= 10000)
  const result = await runPolars({ event_types: snapshot.event_types })
  assert.deepEqual(result.counts, snapshot.counts)
  console.log(JSON.stringify({ status: 'PASS', matches_sql: true, scope, ...result }))
  if (process.argv.includes('--live-model')) {
    // Explicitly bounded external test: one selection + one explanation, no retries.
    const provider = createDashScopeClient()
    const question = 'Trong phạm vi đã chọn có bao nhiêu event, chia theo loại?'
    const plan = await selectChatTool(provider, question, scope)
    assert.equal(plan.tool, 'event_counts')
    console.log(JSON.stringify({ planner: 'PASS', selected_tool: plan.tool }))
    const reply = await provider.complete([
      { role: 'system', content: 'Explain the supplied stored event-row counts in Vietnamese. State this is not customer count or revenue. Do not invent numbers.' },
      { role: 'user', content: JSON.stringify({ question, scope, evidence: result }) },
    ])
    console.log(JSON.stringify({ provider: 'PASS', answer_verification: 'NOT_VERIFIED', answer: reply.text }))
  }
} catch {
  console.error('Polars smoke failed (details suppressed; no credentials logged).')
  process.exitCode = 1
} finally { await closeDatabase() }
