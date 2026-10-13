import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

const env = { TRAFFIC_SOURCE_INSTANCE_ID: 'traffic-1', KAFKA_BOOTSTRAP_SERVERS: 'kafka:9092',
  KAFKA_TOPIC_RAW: 'funnelmetry.raw.v1', POSTGRES_HOST: 'postgres', POSTGRES_DB: 'pipeline',
  POSTGRES_USER: 'pipeline', POSTGRES_PASSWORD: 'private-value' }

test('traffic writer config pins an independent raw consumer group', () => {
  const config = loadConfig(env)
  assert.equal(config.kafka.consumerGroupId, 'funnelmetry-traffic-source-raw-v1')
  assert.equal(config.kafka.rawTopic, 'funnelmetry.raw.v1')
  assert.equal(config.postgres.max, 5)
})

test('traffic writer rejects missing or unsafe configuration before startup', () => {
  assert.throws(() => loadConfig({ ...env, KAFKA_TOPIC_RAW: '' }), /KAFKA_TOPIC_RAW/)
  assert.throws(() => loadConfig({ ...env, TRAFFIC_SOURCE_INSTANCE_ID: 'unsafe/instance' }), /INSTANCE_ID/)
  assert.throws(() => loadConfig({ ...env, TRAFFIC_SOURCE_POSTGRES_POOL_SIZE: '0' }), /POOL_SIZE/)
})
