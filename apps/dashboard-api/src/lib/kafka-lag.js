import { Kafka, logLevel } from 'kafkajs'
import { observeMembership } from './kafka-membership.js'

const decimal = value => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
export function partitionLag({ partition, low, high }, committed) {
  const base = { partition, low_offset: low, high_offset: high, committed_offset: committed ?? null, lag_offsets: null }
  if (!Number.isInteger(partition) || partition < 0 || !decimal(low) || !decimal(high) || BigInt(low) > BigInt(high))
    return { ...base, status: 'UNVERIFIED' }
  if (committed === '-1' || committed == null) return { ...base, status: 'NO_COMMITTED_OFFSET' }
  if (!decimal(committed)) return { ...base, status: 'UNVERIFIED' }
  if (BigInt(committed) < BigInt(low)) return { ...base, status: 'BELOW_RETENTION' }
  if (BigInt(committed) > BigInt(high)) return { ...base, status: 'INCONSISTENT_SNAPSHOT' }
  return { ...base, status: 'OBSERVED', lag_offsets: String(BigInt(high) - BigInt(committed)) }
}

export function lagConfig(env) {
  if (env.DASHBOARD_KAFKA_LAG_ENABLED !== 'true') return null
  const brokers = (env.DASHBOARD_KAFKA_LAG_BROKERS ?? '').split(',').map(value => value.trim())
  const targets = JSON.parse(env.DASHBOARD_KAFKA_LAG_TARGETS_JSON ?? 'null')
  if (!brokers.length || brokers.length > 5 || brokers.some(value => !/^[\w.-]+:\d{1,5}$/.test(value)) ||
      !Array.isArray(targets) || !targets.length || targets.length > 12 || targets.some(target =>
        !target || Object.keys(target).some(key => !['group_id', 'topic'].includes(key)) ||
        [target.group_id, target.topic].some(value => typeof value !== 'string' || !/^[\w.-]{1,200}$/.test(value))) ||
      new Set(targets.map(target => `${target.group_id}/${target.topic}`)).size !== targets.length) throw Error('invalid_lag_config')
  return { brokers, targets }
}

// Uses read-only admin operations only. No topic creation, joins, offset commits,
// offset resolution/reset, consumer, producer, or Docker access.
export async function collectLag(admin, targets) {
  await admin.connect()
  // Reuse one describe per group, including telemetry's two topic rows.
  const memberships = new Map([...new Set(targets.map(target => target.group_id))]
    .map(groupId => [groupId, observeMembership(admin, groupId)]))
  const groups = await Promise.all(targets.map(async ({ group_id, topic }) => {
    const membership = await memberships.get(group_id)
    try {
      // Read commits first. High/low later: moving snapshots are not atomic.
      const offsets = await admin.fetchOffsets({ groupId: group_id, topics: [topic], resolveOffsets: false })
      const bounds = await admin.fetchTopicOffsets(topic)
      if (!bounds.length || bounds.length > 128 || new Set(bounds.map(row => row.partition)).size !== bounds.length) throw Error('invalid_partitions')
      const commits = offsets.find(row => row.topic === topic)?.partitions ?? []
      const partitions = bounds.map(bound => partitionLag(bound, commits.find(row => row.partition === bound.partition)?.offset))
      const known = partitions.every(row => row.status === 'OBSERVED')
      return { group_id, topic, membership, status: known ? 'OBSERVED' : 'UNVERIFIED', partitions,
        lag_offsets: known ? String(partitions.reduce((sum, row) => sum + BigInt(row.lag_offsets), 0n)) : null }
    } catch { return { group_id, topic, membership, status: 'UNVERIFIED', partitions: [], lag_offsets: null } }
  }))
  return groups
}

export function createLagProbe({ env = process.env, makeAdmin, timeoutMs = 8000, cacheMs = 5000 } = {}) {
  let active, cached, expires = 0
  const unknown = reason => ({ status: 'UNVERIFIED', reason, scope: 'configured_consumer_groups_all_sources',
    checked_at: new Date().toISOString(), groups: [] })
  return async () => {
    if (cached && Date.now() < expires) return cached
    if (active) return active
    let config
    try { config = lagConfig(env) } catch { return unknown('INVALID_CONFIGURATION') }
    if (!config) return unknown('NOT_CONFIGURED')
    const admin = makeAdmin ? makeAdmin(config) : new Kafka({ brokers: config.brokers,
      clientId: 'dashboard-lag-observer', logLevel: logLevel.NOTHING,
      connectionTimeout: 2000, requestTimeout: 2000,
      retry: { retries: 2, initialRetryTime: 100, maxRetryTime: 300 },
    }).admin({ retry: { retries: 2, initialRetryTime: 100, maxRetryTime: 300 } })
    let timer
    const started_at = new Date().toISOString()
    const work = collectLag(admin, config.targets).then(groups => ({
      status: groups.every(group => group.status === 'OBSERVED') ? 'OBSERVED' : 'UNVERIFIED',
      scope: 'configured_consumer_groups_all_sources', started_at, checked_at: new Date().toISOString(), groups,
    })).catch(() => unknown('BROKER_UNAVAILABLE'))
    active = Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(unknown('TIMEOUT')), timeoutMs) })])
      .then(result => { cached = result; expires = Date.now() + cacheMs; return result })
      .finally(() => {
        clearTimeout(timer)
        // Keep a single in-flight operation even if the HTTP timeout wins.
        void work.finally(async () => { try { await admin.disconnect() } catch {} finally { active = null } })
      })
    return active
  }
}
export const kafkaLag = createLagProbe()
