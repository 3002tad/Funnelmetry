// Pre-create the exact CDC-11 shadow topics. The live broker disables auto-create.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { ensureTopics } from '../../infra/docker/swarm-kafka-topics.mjs'

const filenames = Object.freeze({
  order: 'cdc-order-v2-shadow.json',
  catalog: 'cdc-catalog-shadow.json',
  inventoryPrice: 'cdc-inventory-price-shadow.json',
})

export function targetTopicSpecs(profiles) {
  const names = []
  for (const [kind, profile] of Object.entries(profiles)) {
    if (!Object.hasOwn(filenames, kind) || profile.status !== 'SHADOW_ONLY' ||
        profile.snapshot_mode !== 'initial' ||
        !/^[a-z][a-z0-9_]{2,62}$/.test(profile.topic_prefix ?? '') ||
        !Array.isArray(profile.table_columns)) throw Error('cdc_target_topic_profile_invalid')
    const expectedCount = { order: 3, catalog: 4, inventoryPrice: 16 }[kind]
    if (profile.table_columns.length !== expectedCount) throw Error('cdc_target_topic_table_count_invalid')
    for (const entry of profile.table_columns) {
      const match = /^public\.([a-z][a-z0-9_]*):([a-z][a-z0-9_]*(?:,[a-z][a-z0-9_]*)*)$/.exec(entry)
      if (!match) throw Error('cdc_target_topic_allowlist_invalid')
      names.push(`${profile.topic_prefix}.public.${match[1]}`)
    }
    names.push(`${profile.topic_prefix}.transaction`)
    names.push(`__debezium-heartbeat.${profile.topic_prefix}`)
  }
  if (!profiles.order || !profiles.catalog || !profiles.inventoryPrice ||
      Object.keys(profiles).length !== 3 ||
      !/^cdc_shadow_reference\.order_recorded_state\.v2$/.test(profiles.order.fact_topic ?? '')) {
    throw Error('cdc_target_topic_profile_set_invalid')
  }
  names.push(profiles.order.fact_topic)
  if (names.length !== 30 || new Set(names).size !== 30) throw Error('cdc_target_topic_collision')
  return names.map(topic => ({ topic, numPartitions: 1, replicationFactor: 1,
    configEntries: [{ name: 'cleanup.policy', value: 'delete' }] }))
}

async function main() {
  if (process.argv.length !== 5 || process.argv[2] !== '--profile-dir' ||
      !['plan', 'apply', 'verify'].includes(process.argv[4])) {
    throw Error('usage: install-target-topics.mjs --profile-dir <dir> plan|apply|verify')
  }
  const root = path.resolve(process.argv[3])
  const profiles = Object.fromEntries(await Promise.all(Object.entries(filenames).map(async ([kind, filename]) =>
    [kind, JSON.parse(await readFile(path.join(root, filename), 'utf8'))])))
  const specs = targetTopicSpecs(profiles)
  const action = process.argv[4]
  if (action === 'plan') {
    console.log(JSON.stringify({ status: 'CDC_TOPICS_PLAN_ONLY', count: specs.length,
      topics: specs.map(spec => spec.topic) }))
    return
  }
  const require = createRequire('/workspace/workers/source-connector/package.json')
  const { Kafka, logLevel } = require('kafkajs')
  const admin = new Kafka({ clientId: 'cdc11-target-topic-installer', brokers: ['kafka:9092'],
    logLevel: logLevel.ERROR, connectionTimeout: 3000, requestTimeout: 8000,
    retry: { retries: 3 } }).admin()
  await admin.connect()
  try {
    if (action === 'apply') await ensureTopics(admin, specs)
    else {
      const existing = new Set(await admin.listTopics())
      if (specs.some(spec => !existing.has(spec.topic))) throw Error('cdc_target_topics_missing')
      // ensureTopics verifies exact existing partitions, replication and cleanup policy.
      await ensureTopics(admin, specs)
    }
  } finally { await admin.disconnect() }
  console.log(JSON.stringify({ status: 'CDC_TOPICS_READY', count: specs.length }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`cdc-target-topics: ${error.message}`); process.exitCode = 1 })
}
