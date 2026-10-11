// Runs in the disposable handoff worker; no live source, no production topic changes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadConfig } from '/workspace/workers/canonical-normalizer/src/config.js'
const require = createRequire('/workspace/workers/source-connector/package.json')
const { Kafka, logLevel, AssignerProtocol } = require('kafkajs')
const { Client } = require('pg')
const stage = process.env.SCALE_STAGE
assert.match(process.env.SCALE_PROJECT || '', /^funnelmetry-handoff-test-[a-f0-9]{12}$/)
assert.ok(['prepare', 'two', 'one'].includes(stage))
assert.equal(process.env.POSTGRES_HOST, 'postgres')
assert.equal(process.env.POSTGRES_DB, 'funnelmetry_handoff')
assert.equal(process.env.CANONICAL_NORMALIZER_INSTANCE_ID_MODE, 'container')
const config = loadConfig()
assert.notEqual(config.instanceId, process.env.CANONICAL_NORMALIZER_INSTANCE_ID, 'new identity code must be present in image')
const db = new Client({ host: 'postgres', database: 'funnelmetry_handoff', user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD })
const admin = new Kafka({ brokers: ['kafka:9092'], logLevel: logLevel.NOTHING }).admin()
try {
  await db.connect()
  assert.equal((await db.query("SELECT count(*)::int AS n FROM dashboard_users WHERE email LIKE '%@handoff-acceptance.invalid'")).rows[0].n, 2)
  await admin.connect()
  if (stage === 'prepare') {
    const meta = await admin.fetchTopicMetadata({ topics: [config.rawTopic] })
    assert.equal(meta.topics[0].partitions.length, 1)
    await admin.createPartitions({ topicPartitions: [{ topic: config.rawTopic, count: 2 }] })
    console.log('PASS: disposable raw topic expanded to two partitions; live topic untouched')
  } else {
    const expected = stage === 'two' ? 2 : 1
    let passed = false
    for (let i = 0; i < 90; i++) {
      const { groups } = await admin.describeGroups([config.consumerGroupId])
      const group = groups[0]
      if (group.state === 'Stable' && group.members.length === expected) {
        const assignment = group.members.map(m => AssignerProtocol.MemberAssignment.decode(m.memberAssignment).assignment[config.rawTopic] || [])
        const partitions = assignment.flat().sort()
        if (JSON.stringify(partitions) === '[0,1]' && assignment.every(a => a.length > 0)) { passed = true; break }
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    assert.ok(passed, 'stable membership and exclusive complete partition assignment')
    console.log(`PASS: ${expected} normalizer members own both raw partitions without overlap`)
  }
} catch { console.error(`FAIL: isolated scale ${stage}`); process.exitCode = 1 }
finally { await admin.disconnect().catch(() => {}); await db.end() }
