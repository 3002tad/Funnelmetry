import test from 'node:test'
import assert from 'node:assert/strict'
import {connectorReadiness} from '../src/lib/connector-readiness.js'
test('readiness distinguishes unreachable, degraded and ready without leaking errors',async()=>{
  for(const [code,status] of [[200,'READY'],[503,'BLOCKED'],[503,'DEGRADED']]){
    const result=await connectorReadiness(async(url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal);return {status:code,json:async()=>({status,last_success_at:'2026-09-29T00:00:00Z',error:'secret-token'})}})
    assert.equal(result.status,status);assert.equal(result.ready,code===200);assert.equal(result.error_present,true);assert.ok(!JSON.stringify(result).includes('secret-token'))
  }
  for(const fetcher of [async()=>{throw Error('secret')},async()=>({status:200,json:async()=>({status:'BLOCKED'})}),async()=>({status:404})]){
    const result=await connectorReadiness(fetcher);assert.equal(result.status,'UNVERIFIED');assert.equal(result.ready,null)
  }
})
