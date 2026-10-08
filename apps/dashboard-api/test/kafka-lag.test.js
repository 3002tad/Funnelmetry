import test from 'node:test'
import assert from 'node:assert/strict'
import { partitionLag, lagConfig, collectLag, createLagProbe } from '../src/lib/kafka-lag.js'

const targets = [{ group_id: 'worker', topic: 'events' }]
const env = { DASHBOARD_KAFKA_LAG_ENABLED: 'true', DASHBOARD_KAFKA_LAG_BROKERS: 'kafka:9092', DASHBOARD_KAFKA_LAG_TARGETS_JSON: JSON.stringify(targets) }
test('offset lag is exact; missing commit, retention and moving snapshot are not zero', () => {
  const bound = { partition: 0, low: '5', high: '9007199254740993' }
  assert.equal(partitionLag(bound, '5').lag_offsets, '9007199254740988')
  assert.equal(partitionLag(bound, bound.high).lag_offsets, '0')
  for (const [commit, status] of [[undefined,'NO_COMMITTED_OFFSET'],['-1','NO_COMMITTED_OFFSET'],['4','BELOW_RETENTION'],['9007199254740994','INCONSISTENT_SNAPSHOT'],['NaN','UNVERIFIED']]) {
    const result = partitionLag(bound, commit)
    assert.equal(result.status, status); assert.equal(result.lag_offsets, null)
  }
  assert.equal(partitionLag({ partition: 0, low: '10', high: '9' }, '9').status, 'UNVERIFIED')
})
test('monitoring is opt-in and rejects unbounded or ambiguous operator configuration', () => {
  assert.equal(lagConfig({}), null)
  assert.deepEqual(lagConfig(env).targets, targets)
  for (const extra of [
    { DASHBOARD_KAFKA_LAG_TARGETS_JSON: '{}' },
    { DASHBOARD_KAFKA_LAG_TARGETS_JSON: JSON.stringify([...targets, ...targets]) },
    { DASHBOARD_KAFKA_LAG_TARGETS_JSON: JSON.stringify([{ ...targets[0], secret: 'bad' }]) },
    { DASHBOARD_KAFKA_LAG_BROKERS: 'https://attacker/secret' },
  ]) assert.throws(() => lagConfig({ ...env, ...extra }))
})
test('collector calls only read methods; any missing partition commit prevents a total', async () => {
  const admin = { connect: async () => {}, fetchOffsets: async args => {
    assert.deepEqual(args, { groupId: 'worker', topics: ['events'], resolveOffsets: false })
    return [{ topic: 'events', partitions: [{ partition: 0, offset: '7' }] }]
  }, fetchTopicOffsets: async () => [{ partition: 0, low: '0', high: '10' }, { partition: 1, low: '0', high: '0' }] }
  const [result] = await collectLag(admin, targets)
  assert.equal(result.lag_offsets, null)
  assert.equal(result.partitions[0].lag_offsets, '3')
  assert.equal(result.partitions[1].status, 'NO_COMMITTED_OFFSET')
  admin.fetchOffsets = async () => { throw Error('private broker credential') }
  const output = await collectLag(admin, targets)
  assert.ok(!JSON.stringify(output).includes('private'))
  assert.equal(output[0].status, 'UNVERIFIED')
})
test('probe caches and coalesces calls, disconnects and returns sanitized outage', async () => {
  let created = 0, disconnected = 0
  const probe = createLagProbe({ env, makeAdmin: () => {
    created++
    return { connect: async () => { throw Error('secret') }, disconnect: async () => { disconnected++ } }
  } })
  const [one,two] = await Promise.all([probe(),probe()])
  assert.deepEqual(one,two); assert.equal(created,1)
  assert.equal(one.reason,'BROKER_UNAVAILABLE')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disconnected,1)
  await probe(); assert.equal(created,1)
})
test('timeout is unknown and a slow operation cannot spawn overlapping probes', async () => {
  let release, created = 0, disconnected = 0
  const probe = createLagProbe({ env, timeoutMs: 5, cacheMs: 0, makeAdmin: () => {
    created++
    return { connect: () => new Promise(resolve => { release=resolve }),
      fetchOffsets: async () => [], fetchTopicOffsets: async () => [], disconnect: async () => { disconnected++ } }
  } })
  assert.equal((await probe()).reason,'TIMEOUT')
  assert.equal((await probe()).reason,'TIMEOUT'); assert.equal(created,1)
  release(); await new Promise(resolve => setTimeout(resolve,10))
  assert.equal(disconnected,1)
})
