import test from 'node:test'
import assert from 'node:assert/strict'
import { monitoringMetrics } from '../src/lib/monitoring-metrics.js'
const group = { group_id: 'worker', topic: 'events', status: 'OBSERVED', lag_offsets: '3', partitions: [{}], membership: { status: 'OBSERVED', state: 'Stable', member_count: 1 } }
test('metrics group families, deduplicate membership, preserve timestamps and known zero', () => {
  const output = monitoringMetrics({ checked_at:'2026-10-09T00:00:00Z',groups:[group,{...group,topic:'other',lag_offsets:'0'}] },
    { workers:[{worker:'worker',status:'READY',ready:true,checked_at:'2026-10-09T00:00:00Z'}] })
  assert.match(output,/funnelmetry_kafka_lag_offsets\{group_id="worker",topic="events"\} 3\n/)
  assert.match(output,/funnelmetry_kafka_lag_offsets\{group_id="worker",topic="other"\} 0\n/)
  assert.equal(output.split('\n').filter(line=>line.startsWith('funnelmetry_kafka_group_members{')).length,1)
  assert.match(output,/funnelmetry_worker_runtime_ready\{worker="worker"\} 1/)
  assert.match(output,new RegExp(String(Date.parse('2026-10-09T00:00:00Z')/1000)))
  const names=output.split('\n').filter(line=>line.startsWith('# TYPE ')).map(line=>line.split(' ')[2]);assert.equal(new Set(names).size,names.length)
  assert.ok(output.endsWith('\n'))
})
test('unknown or inexact lag and unknown worker readiness omit numeric samples', () => {
  for(const lag of [null,'-1','9007199254740993']) {
    const output=monitoringMetrics({groups:[{...group,lag_offsets:lag,membership:{status:'UNVERIFIED'}}]},
      {workers:[{worker:'worker',ready:null,status:'UNVERIFIED'}]})
    assert.match(output,/funnelmetry_kafka_lag_available\{[^}]+\} 0/)
    assert.ok(!output.includes('funnelmetry_kafka_lag_offsets'))
    assert.ok(!output.includes('funnelmetry_worker_runtime_ready'))
    assert.ok(!output.includes('funnelmetry_kafka_group_members'))
  }
  const output=monitoringMetrics({groups:[],reason:'secret'}, {workers:[]})
  assert.match(output,/collector="kafka"\} 0/);assert.match(output,/collector="workers"\} 0/);assert.ok(!output.includes('secret'))
})
test('labels are escaped and arbitrary fields never become samples or labels', () => {
  const output=monitoringMetrics({groups:[{...group,group_id:'line\n"\\',secret:'do-not-export'}]}, {workers:[]})
  assert.ok(output.includes('group_id="line\\n\\"\\\\"'))
  assert.ok(!output.includes('do-not-export'))
})
