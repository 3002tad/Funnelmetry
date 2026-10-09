import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerProbe, WORKERS } from '../src/lib/worker-readiness.js'
const env={DASHBOARD_WORKER_HEALTH_ENABLED:'true'}
const response=(worker,status='READY',extra={})=>new Response(JSON.stringify({worker,status,ready:status==='READY',scope:'local_kafka_runtime_flag',...extra}),{status:status==='READY'?200:503})
test('fixed worker probe allowlists identity and redacts fields, caches/coalesces requests',async()=>{
  let calls=0
  const probe=createWorkerProbe({env,fetcher:async(url,options)=>{
    calls++; assert.equal(options.redirect,'error'); assert.ok(options.signal)
    const worker=new URL(url).hostname; assert.ok(WORKERS.includes(worker));assert.equal(new URL(url).port,'32110')
    return response(worker,'READY',{error:'secret'})
  }})
  const [a,b]=await Promise.all([probe(),probe()]);assert.deepEqual(a,b);assert.equal(calls,6)
  assert.ok(a.workers.every(row=>row.ready===true));assert.ok(!JSON.stringify(a).includes('secret'))
  await probe();assert.equal(calls,6)
})
test('invalid, unavailable, oversized and inconsistent responses are unknown, not stopped',async()=>{
  const cases=[async()=>{throw Error('secret')},async()=>new Response('secret',{status:500}),
    async()=>new Response('x'.repeat(4097)),async()=>new Response('bad json'),
    async()=>response('wrong-worker'),async url=>response(new URL(url).hostname,'READY',{ready:false})]
  for(const fetcher of cases){const result=await createWorkerProbe({env,fetcher})();assert.ok(result.workers.every(row=>row.status==='UNVERIFIED'&&row.ready===null))}
})
test('reported degraded is distinguished from unavailable; off makes no calls',async()=>{
  const result=await createWorkerProbe({env,fetcher:async url=>response(new URL(url).hostname,'DEGRADED')})()
  assert.ok(result.workers.every(row=>row.status==='DEGRADED'&&row.ready===false))
  assert.deepEqual(await createWorkerProbe({env:{},fetcher:()=>{throw Error('must not fetch')}})(),{reason:'NOT_CONFIGURED',workers:[]})
})
