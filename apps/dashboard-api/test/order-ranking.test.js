import test from 'node:test'
import assert from 'node:assert/strict'
import {selectChatTool} from '../src/lib/ai/tool-plan.js'
import {renderOrderRanking} from '../src/lib/ai/order-ranking-render.js'
import {rankOrders,rankingContract} from '../../../analytics/src/order-ranking.mjs'
const scope={sourceId:'medusa-reference',from:'2026-09-01T00:00:00.000Z',to:'2026-09-02T00:00:00.000Z'}
test('ranking dispatch is opt-in, bounded and never SQL',async()=>{
  const provider={complete:async messages=>{
    assert.match(messages[0].content,/Never answer ranking requests with metric_summary/)
    return {text:JSON.stringify({tool:'tool.order_ranking',last_hours:null})}
  }}
  assert.equal((await selectChatTool(provider,'Đơn hàng cao nhất',scope,null,{id:'tool.metric_summary'},rankingContract)).tool,'tool.order_ranking')
  await assert.rejects(selectChatTool({complete:async()=>({text:'{"tool":"tool.order_ranking","last_hours":null}'})},'top',scope,null),/invalid_tool_plan/)
  for(const patch of [{tool_id:'sql'},{parameters:{sql:'SELECT secret'}},{catalog_release:'latest'}]){
    const request={tool_id:rankingContract.id,catalog_release:rankingContract.catalog_release,value_refs:rankingContract.value_refs,dimension_refs:rankingContract.dimension_refs,
      parameters:{source_id:scope.sourceId,from:scope.from,to:scope.to},...patch}
    assert.equal((await rankOrders({pool:{query(){assert.fail('no DB')}},request,statementTimeoutMs:1000})).code,'INVALID_TOOL_REQUEST')
  }
})
test('ranking rendering preserves exact decimal and explicitly labels monetary boundary',()=>{
  const evidence={status:'PROVISIONAL',evidence_id:'test-id',provenance:{parameters:{source_id:scope.sourceId,from:scope.from,to:scope.to}},
    result:{orders:[{currency_code:'EUR',position:'1',order_id:'order_test',gross_order_value:'9007199254740993.01'}]}}
  const answer=renderOrderRanking(evidence)
  assert.match(answer,/9007199254740993\.01 EUR/);assert.match(answer,/không phải doanh thu đã thanh toán/)
  assert.throws(()=>renderOrderRanking({...evidence,status:'BLOCKED_BY_QUALITY'}))
})
