import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScalingProbe } from '../src/lib/scaling-observation.js'
import { readWorkerTelemetry } from '../src/lib/worker-telemetry.js'
test('scaling projection preserves zero, scopes Kafka and redacts snapshot fields; rejects stale data', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'scaling-'))
 try {
  const path = join(directory, 'sample.json'), now = Date.now()
  const sample = { stack: 'local', service: 'canonical-normalizer', observed_at: new Date(now).toISOString(), desired_replicas: 1, running_replicas: 0, memory_percent_max: 0, secret: 'never-return' }
  await writeFile(path, JSON.stringify(sample))
  const probe = createScalingProbe({ env: { DASHBOARD_SCALING_SNAPSHOT_FILE: path, DASHBOARD_SCALING_STACK: 'local' }, clock: () => now,
   lag: async () => ({ groups: [{ group_id: 'other', topic: 'funnelmetry.raw.v1', status: 'OBSERVED', lag_offsets: '99' }, { group_id: 'funnelmetry-canonical-normalizer-v1', topic: 'funnelmetry.raw.v1', status: 'OBSERVED', lag_offsets: '0', partitions: [{}] }] }),
   workers: async () => ({ workers: [{ worker: 'canonical-normalizer', status: 'DEGRADED', ready: false }] }) })
  const result = await probe()
  assert.equal(result.runtime.running_replicas, 0); assert.equal(result.runtime.memory_percent_max, 0)
  assert.equal(result.kafka.raw_offset_lag, '0'); assert.equal(result.kafka.consumable_lag, null)
  assert.equal(result.readiness.ready, false); assert.ok(!JSON.stringify(result).includes('never-return'))
  for (const change of [{ observed_at: new Date(now - 61000).toISOString() }, { stack: 'wrong' }, { memory_percent_max: 101 }, { desired_replicas: -1 }]) {
   await writeFile(path, JSON.stringify({ ...sample, ...change }))
   assert.equal((await probe()).runtime.desired_replicas, null)
  }
 } finally { await rm(directory, { recursive: true, force: true }) }
})
test('missing runtime and failed probes stay unknown, not zero', async () => {
 const result = await createScalingProbe({ env: {}, lag: async () => { throw Error('secret') }, workers: async () => { throw Error('secret') } })()
 assert.equal(result.runtime.reason, 'NOT_CONFIGURED'); assert.equal(result.runtime.desired_replicas, null)
 assert.equal(result.kafka.raw_offset_lag, null); assert.equal(result.readiness.ready, null)
})
test('collector telemetry supplies Kafka and all worker readiness with bounded freshness and redaction', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'scaling-'))
 try {
  const path = join(directory, 'sample.json'), now = Date.now(), timestamp = new Date(now).toISOString()
  const env = { DASHBOARD_SCALING_SNAPSHOT_FILE: path, DASHBOARD_SCALING_STACK: 'local' }
  const sample = { stack: 'local', service: 'canonical-normalizer', observed_at: timestamp, desired_replicas: 1, running_replicas: 1, memory_percent_max: 10,
   kafka: { status: 'OBSERVED', group_id: 'funnelmetry-canonical-normalizer-v1', topic: 'funnelmetry.raw.v1', raw_offset_lag: '2', partition_count: 2 },
   workers: [{ worker: 'canonical-normalizer', status: 'READY', ready: true, checked_at: timestamp, scope: 'local_kafka_runtime_flag', secret: 'redacted' }] }
  await writeFile(path, JSON.stringify(sample))
  const probe = createScalingProbe({ env, clock: () => now, lag: async () => ({ groups: [] }), workers: async () => ({ workers: [] }) })
  const data = await probe(); assert.equal(data.kafka.raw_offset_lag, '2'); assert.equal(data.kafka.partition_count, 2); assert.equal(data.readiness.ready, true)
  sample.kafka.consumable_lag='0';sample.kafka.reason='VERIFIED_CONTROL_TAIL_EXCLUDED'
  await writeFile(path,JSON.stringify(sample));assert.equal((await probe()).kafka.consumable_lag,'0')
  sample.kafka.consumable_lag='3';await writeFile(path,JSON.stringify(sample));assert.equal((await probe()).kafka.consumable_lag,null)
  const health = await readWorkerTelemetry(env, ['canonical-normalizer', 'canonical-ledger-writer'], () => now)
  assert.equal(health.workers[0].ready, true); assert.equal(health.workers[1].ready, null); assert.ok(!JSON.stringify(health).includes('redacted'))
  sample.workers[0].checked_at = new Date(now - 61000).toISOString()
  await writeFile(path, JSON.stringify(sample))
  assert.equal((await probe()).readiness.ready, null, 'fresh outer snapshot must not revive a stale worker sample')
  sample.workers[0].checked_at = timestamp
  sample.kafka.group_id = 'wrong'; sample.workers[0].ready = false
  await writeFile(path, JSON.stringify(sample))
  assert.equal((await probe()).kafka.raw_offset_lag, null)
  assert.equal((await readWorkerTelemetry(env, ['canonical-normalizer'], () => now)).workers[0].ready, null)
  assert.equal((await probe()).readiness.ready, null)
  assert.equal((await readWorkerTelemetry(env, ['canonical-normalizer'], () => now + 61000)).reason, 'SNAPSHOT_UNAVAILABLE_OR_STALE')
 } finally { await rm(directory, { recursive: true, force: true }) }
})
