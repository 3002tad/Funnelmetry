import test from 'node:test'
import assert from 'node:assert/strict'
import {connectorReadiness} from '../src/lib/connector-readiness.js'
import { feedObservation } from '../src/lib/feed-observation.js'

test('feed observation strips payload/credentials and preserves exact sequence strings', async () => {
  const data = { status: 'DEGRADED', connector_id: 'connector-a', token: 'private-token',
    feed_observation: { observed_at: '2026-10-08T00:00:00Z', event_feed_id: 'feed-a',
      requested_after_seq: 7, retention_floor_seq: 3, latest_available_seq: Number.MAX_SAFE_INTEGER,
      returned_count: 0, events: [{ secret: 'private-token' }], url: 'private-token' } }
  const result = await connectorReadiness(async () => ({ status: 503, json: async () => data }))
  assert.equal(result.ready, false)
  assert.equal(result.feed_observation.latest_available_seq, '9007199254740991')
  assert.equal(result.feed_observation.requested_after_seq, '7')
  assert.equal(JSON.stringify(result).includes('private-token'), false)
  assert.equal(feedObservation({}), null) // old worker/no successful observation
  for (const change of [{ latest_available_seq: 6 }, { retention_floor_seq: 8 },
    { latest_available_seq: Number.MAX_SAFE_INTEGER + 1 }, { returned_count: -1 },
    { observed_at: 'invalid' }, { event_feed_id: '<script>' }, { requested_after_seq: '7' }]) {
    assert.equal(feedObservation({ ...data, feed_observation: { ...data.feed_observation, ...change } }), null)
  }
})
test('readiness distinguishes unreachable, degraded and ready without leaking errors',async()=>{
  for(const [code,status] of [[200,'READY'],[503,'BLOCKED'],[503,'DEGRADED']]){
    const result=await connectorReadiness(async(url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal);return {status:code,json:async()=>({status,last_success_at:'2026-09-29T00:00:00Z',error:'secret-token'})}})
    assert.equal(result.status,status);assert.equal(result.ready,code===200);assert.equal(result.error_present,true);assert.ok(!JSON.stringify(result).includes('secret-token'))
  }
  for(const fetcher of [async()=>{throw Error('secret')},async()=>({status:200,json:async()=>({status:'BLOCKED'})}),async()=>({status:404})]){
    const result=await connectorReadiness(fetcher);assert.equal(result.status,'UNVERIFIED');assert.equal(result.ready,null)
  }
})
