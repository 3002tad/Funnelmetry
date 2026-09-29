import { readFile } from 'node:fs/promises'
import { createDashScopeClient } from '../../apps/dashboard-api/src/lib/ai/dashscope.js'
import { selectChatTool } from '../../apps/dashboard-api/src/lib/ai/tool-plan.js'
import { ORDER_SUMMARY_PROMPT } from '../../apps/dashboard-api/src/lib/ai/order-summary-prompt.js'

if (!process.argv.includes('--live-synthetic-only')) throw Error('Explicit live synthetic evaluation opt-in required')
const cases = JSON.parse(await readFile(new URL('./qwen-order-eval-cases.json', import.meta.url), 'utf8'))
const provider = createDashScopeClient({ ...process.env, DASHBOARD_ENABLE_QWEN: 'true' })
const scope = { sourceId: cases.fixture.source_id, from: cases.fixture.from, to: cases.fixture.to }
// Evaluation descriptor only: no production catalog/database is accessed.
const tool = { id: 'tool.metric_summary', catalog_release: 'order-analytics-staging-1.0.0',
  value_refs: ['measure.gross_order_value@1.0.0', 'measure.order_count@1.0.0', 'metric.average_order_value@1.0.0'],
  dimension_refs: ['dimension.currency_code@1.0.0'],
  description: 'Placed-order value, distinct order count and AOV, grouped by currency. Not paid/captured/net revenue. Provisional staging evidence; no item/category allocation.' }
let passed = 0
for (const [index, item] of cases.cases.entries()) {
  try {
    const plan = await selectChatTool(provider, item.question, scope, undefined, tool)
    const expectedFrom = item.expected_last_hours ? new Date(Date.parse(scope.to) - item.expected_last_hours * 3600000).toISOString() : scope.from
    const pass = plan.tool === item.expected_tool && plan.scope.from === expectedFrom
    if (pass) passed++
    console.log(JSON.stringify({ case: index + 1, stage: 'planner', pass, selected: plan.tool, from: plan.scope.from }))
  } catch (error) {
    console.log(JSON.stringify({ case: index + 1, stage: 'planner', pass: false, error: ['ai_timeout','ai_rate_limited','ai_auth_failed','invalid_tool_plan'].includes(error.message) ? error.message : 'evaluation_failed' }))
    // Do not repeatedly call a provider with invalid credentials or rate limiting.
    if (['ai_auth_failed','ai_rate_limited'].includes(error.message)) break
  }
}
console.log(JSON.stringify({ planner_pass: passed, planner_total: cases.cases.length, model: 'qwen-flash', region: 'singapore', synthetic_only: true }))
// One standalone synthesis probe; these are explicitly synthetic values, not a persisted run.
const evidence = { evidence_id: 'synthetic-eval-order-001', quality_state: 'PROVISIONAL',
  scope, result: { groups: cases.fixture.groups },
  warnings: ['SYNTHETIC_EVALUATION_ONLY', 'FEED_COMPLETENESS_UNVERIFIED', 'PLACED_ORDER_VALUE_NOT_PAID_REVENUE'] }
try {
  const reply = await provider.complete([
    { role: 'system', content: ORDER_SUMMARY_PROMPT },
    { role: 'user', content: JSON.stringify({ question: cases.cases[1].question, evidence }) },
  ])
  console.log(JSON.stringify({ stage: 'synthesis', response: reply.text, verification: 'REQUIRES_REVIEW', synthetic_only: true }))
} catch { console.log(JSON.stringify({ stage: 'synthesis', error: 'evaluation_failed' })) }
if (passed !== cases.cases.length) process.exitCode = 1
