import test from 'node:test'
import assert from 'node:assert/strict'
import {selectChatTool} from '../src/lib/ai/tool-plan.js'
import {renderProductRanking} from '../src/lib/ai/product-ranking-render.js'
import {rankProducts} from '../../../analytics/src/product-ranking.mjs'
test('product routing is opt-in and rejects unsupported model tool output',async()=>{
  const provider={complete:async()=>({text:'{"tool":"tool.product_value_ranking","last_hours":null}'})}
  const scope={from:'2026-09-01T00:00:00.000Z',to:'2026-09-02T00:00:00.000Z'}
  await assert.rejects(selectChatTool(provider,'top products',scope),/invalid_tool_plan/)
  assert.equal((await selectChatTool(provider,'top products',scope,undefined,null,null,{id:'tool.product_value_ranking'})).tool,'tool.product_value_ranking')
})
test('product output preserves exact amounts and blocks invalid/quality results',async()=>{
  const e={status:'PROVISIONAL',evidence_id:'test',provenance:{parameters:{source_id:'medusa-reference'}},
    result:{products:[{product_id:'prod_test',currency_code:'EUR',ordered_product_unit_value:'9007199254740993.123',position:'1'}]}}
  assert.match(renderProductRanking(e),/9007199254740993.123 EUR/)
  assert.match(renderProductRanking(e),/không phải doanh thu/)
  assert.throws(()=>renderProductRanking({...e,status:'BLOCKED_BY_QUALITY'}))
  assert.equal((await rankProducts({pool:{connect(){assert.fail('must not query')}},request:{},statementTimeoutMs:5000})).code,'INVALID_TOOL_REQUEST')
})
