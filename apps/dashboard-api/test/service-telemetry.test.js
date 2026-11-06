import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTelemetry, telemetryScope, persistTelemetry, parseTelemetryHistory, readTelemetryHistory } from '../src/lib/service-telemetry.js'
const env = { DASHBOARD_SCALING_STACK: 'test-stack' }, scope = telemetryScope(env)
const now = Date.now()
const sample = () => ({ stack: scope.stack, service: scope.service, observed_at: new Date(now).toISOString(), desired_replicas: 1, running_replicas: 1, memory_percent_max: 0,
  kafka: { status:'OBSERVED',group_id:scope.group,topic:scope.topic,raw_offset_lag:'2',consumable_lag:'0',partition_count:2,control_only_partitions:2 }, workers:[] })
test('telemetry preserves measured zero and conservative provenance; mismatched or unknown signals stay null', () => {
 const row=normalizeTelemetry(sample(),scope,now)
 assert.equal(row.consumable_lag,'0');assert.equal(row.memory_percent_max,0);assert.equal(row.lag_reason,'VERIFIED_CONTROL_TAIL_EXCLUDED')
 for(const change of [{group_id:'wrong'},{status:'UNVERIFIED'},{consumable_lag:null},{consumable_lag:'3'}]){
  const data=sample();Object.assign(data.kafka,change);const r=normalizeTelemetry(data,scope,now);assert.equal(r.consumable_lag,null);assert.equal(r.lag_status,'UNVERIFIED')
 }
 const unavailable=sample();unavailable.running_replicas=null;unavailable.kafka=null;assert.equal(normalizeTelemetry(unavailable,scope,now).raw_offset_lag,null)
 assert.throws(()=>normalizeTelemetry(sample(),scope,now+61000),/invalid_telemetry/)
 const invalid=sample();invalid.memory_percent_max=101;assert.throws(()=>normalizeTelemetry(invalid,scope,now),/invalid_telemetry/)
})
test('ingest deduplicates and retention deletes only bounded operational samples in the same stack/service',async()=>{
 const calls=[];await persistTelemetry(async(sql,params)=>calls.push({sql,params}),normalizeTelemetry(sample(),scope,now))
 assert.match(calls[0].sql,/ON CONFLICT DO NOTHING/);assert.equal(calls[0].params[9],'0')
 assert.match(calls[1].sql,/stack_name=\$1 AND service_name=\$2/);assert.match(calls[1].sql,/LIMIT 5000/);assert.deepEqual(calls[1].params,[scope.stack,scope.service,7])
 await assert.rejects(persistTelemetry(()=>assert.fail(),{},0),/retention/)
})
test('history uses server-owned scope, bounded windows, lossless offsets and actual bucket samples',async()=>{
 for(const q of [{hours:'0'},{hours:'169'},{hours:['1']},{hours:'1;DROP'},{stack:'other'}])assert.throws(()=>parseTelemetryHistory(q,env),/query/)
 const request=parseTelemetryHistory({hours:'168'},env,now);assert.equal(request.bucket_seconds,840)
 const result=await readTelemetryHistory(async(sql,params)=>{assert.match(sql,/DISTINCT ON/);assert.match(sql,/LIMIT 721/);assert.equal(params[0],scope.stack);return[{observed_at:'2026-11-06T01:00:00Z',consumable_lag:null},{observed_at:'2026-11-06T00:00:00Z',consumable_lag:'0'}]},request)
 assert.equal(result.items[0].consumable_lag,'0');assert.equal(result.items[1].consumable_lag,null)
})
