import assert from 'node:assert/strict'
import test from 'node:test'
import { INGRESS_EVENT_SPEC_VERSION } from '@3002tad/funnelmetry-input-contract'
import { createKafkaTrafficSourceRuntime } from '../src/kafka-runtime.js'

const browserEvent = { specversion: INGRESS_EVENT_SPEC_VERSION,
  source_id: 'medusa-reference', event_id: 'browser:event-1', producer: 'browser_sdk',
  source_event_type: 'behavior.page_viewed', source_schema_version: '1.0',
  occurred_at: '2026-10-12T00:00:00.000Z', source_payload: {},
  source_metadata: { utm_source: 'Newsletter' } }

function fakeKafka() {
  const calls = [], commits = []
  let eachMessage, finishRun, crashHandler
  const consumer = {
    events: { CRASH: 'crash' },
    on: (_event, handler) => { crashHandler = handler },
    connect: async () => calls.push('connect'),
    disconnect: async () => calls.push('disconnect'),
    subscribe: async options => calls.push({ subscribe: options }),
    commitOffsets: async offsets => commits.push(offsets),
    run: options => { eachMessage = options.eachMessage; calls.push(`run:autoCommit=${options.autoCommit}`)
      return new Promise(resolve => { finishRun = resolve }) },
    stop: async () => { calls.push('stop'); finishRun?.() },
  }
  return {
    calls, commits, consumer: () => consumer,
    deliver(event = browserEvent, key = [event.source_id, event.event_id]) {
      return eachMessage({ topic: 'raw', partition: 2, message: { offset: '7',
        key: Buffer.from(JSON.stringify(key)), value: Buffer.from(JSON.stringify({
          ingestion_id: 'ing_feed_1', received_at: '2026-10-12T00:00:01.000Z', raw_body: JSON.stringify(event),
        })) } })
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, repository, onError = () => {}) {
  return createKafkaTrafficSourceRuntime({ kafka, repository, brokers: ['unused:9092'], clientId: 'traffic',
    consumerGroupId: 'traffic-raw-v1', rawTopic: 'raw', onError })
}

test('starts at retained raw beginning and commits only after PostgreSQL persistence', async () => {
  const kafka = fakeKafka(), operations = []
  const worker = runtime(kafka, { persist: async observation => {
    operations.push(observation.utm_source_state)
    assert.equal(kafka.commits.length, 0)
  } })
  await worker.start()
  assert.deepEqual(kafka.calls.find(value => typeof value === 'object').subscribe,
    { topic: 'raw', fromBeginning: true })
  await kafka.deliver()
  assert.deepEqual(operations, ['PRESENT'])
  assert.deepEqual(kafka.commits[0], [{ topic: 'raw', partition: 2, offset: '8' }])
  await worker.stop()
})

test('non-browser business event is skipped without creating a traffic row', async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => assert.fail('must not persist') })
  await worker.start()
  await kafka.deliver({ ...browserEvent, producer: 'source_bridge', source_event_type: 'medusa.order_placed' })
  assert.equal(kafka.commits.length, 1)
  await worker.stop()
})

test('never commits an invalid raw event or failed projection and marks crashes unhealthy', async () => {
  const kafka = fakeKafka(), errors = []
  const worker = runtime(kafka, { persist: async () => { throw Error('database unavailable') } },
    error => errors.push(error))
  await worker.start()
  await assert.rejects(() => kafka.deliver(), /database unavailable/)
  await assert.rejects(() => kafka.deliver(browserEvent, ['medusa-reference', 'other']), /invalid_traffic_raw_record/)
  assert.equal(kafka.commits.length, 0)
  kafka.crash(Error('consumer crashed'))
  assert.equal(worker.isHealthy(), false)
  assert.equal(errors.length, 1)
  await worker.stop()
})
