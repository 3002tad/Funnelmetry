import assert from 'node:assert/strict'
import { Kafka, logLevel } from 'kafkajs'

// Read-only verification consumer: never commit offsets to worker groups.
const rawCount = Number(process.env.RECOVERY_RAW_COUNT)
const canonicalCount = Number(process.env.RECOVERY_CANONICAL_COUNT)
assert.ok(Number.isSafeInteger(rawCount) && rawCount > 0)
assert.ok(Number.isSafeInteger(canonicalCount) && canonicalCount > 0 && canonicalCount <= rawCount)
const expected = {
  'funnelmetry.raw.v1': rawCount,
  'funnelmetry.ingress.receipts.v1': rawCount,
  'funnelmetry.canonicalization.outcomes.v1': rawCount,
  'funnelmetry.canonical.v1': canonicalCount,
  'funnelmetry.canonical.persisted.v1': canonicalCount,
  'funnelmetry.journey.resolved.v1': canonicalCount,
  'funnelmetry.funnel.updated.v1': canonicalCount,
  'funnelmetry.kpi.updated.v1': canonicalCount,
}
const seen = Object.fromEntries(Object.keys(expected).map(topic => [topic, 0]))
const client = new Kafka({ clientId: 'recovery-verifier', brokers: ['kafka:9092'], logLevel: logLevel.NOTHING })
const consumer = client.consumer({ groupId: `recovery-verify-${Date.now()}`, readUncommitted: false })
let crash
consumer.on(consumer.events.CRASH, () => { crash = true })
try {
  await consumer.connect()
  await consumer.subscribe({ topics: Object.keys(expected), fromBeginning: true })
  await consumer.run({ autoCommit: false, eachMessage: async ({ topic }) => { seen[topic]++ } })
  const deadline = Date.now() + 45000
  while (!crash && Object.entries(expected).some(([topic, count]) => seen[topic] < count) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(!crash, 'Verifier consumer crashed')
  assert.deepEqual(seen, expected, 'Replay did not reach all downstream topics')
  console.log(JSON.stringify({ status: 'verified', counts: seen }))
} finally {
  await consumer.stop().catch(() => {})
  await consumer.disconnect()
}
