const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"')
const safeCount = value => typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
const groupStates = new Set(['Stable', 'PreparingRebalance', 'CompletingRebalance', 'Empty', 'Dead'])

// Prometheus 0.0.4 gauges, grouped by family. No request/entity IDs or errors as labels.
export function monitoringMetrics(kafka, workers) {
  const families = new Map()
  const gauge = (name, help, labels, value) => {
    if (!families.has(name)) families.set(name, { help, samples: new Map() })
    const labelText = Object.entries(labels).map(([key, label]) => `${key}="${escape(label)}"`).join(',')
    families.get(name).samples.set(labelText, value)
  }
  const timestamp = (collector, value, labels = {}) => {
    const parsed = typeof value === 'string' ? Date.parse(value) / 1000 : NaN
    if (Number.isFinite(parsed)) gauge('funnelmetry_monitoring_observed_timestamp_seconds',
      'Observation time from the underlying probe, not scrape time.', { collector, ...labels }, parsed)
  }
  const groups = kafka?.groups ?? []
  const rows = workers?.workers ?? []
  gauge('funnelmetry_monitoring_snapshot_available', 'At least one observation is available; not overall service health.',
    { collector: 'kafka' }, Number(groups.some(group => group.partitions?.length || group.membership?.status === 'OBSERVED')))
  gauge('funnelmetry_monitoring_snapshot_available', 'At least one observation is available; not overall service health.',
    { collector: 'workers' }, Number(rows.some(row => typeof row.ready === 'boolean')))
  timestamp('kafka', kafka?.checked_at)
  for (const group of groups) {
    const labels = { group_id: group.group_id, topic: group.topic }
    const available = group.status === 'OBSERVED' && safeCount(group.lag_offsets)
    gauge('funnelmetry_kafka_lag_available', 'Offset lag is known and exactly representable as a safe integer.', labels, Number(available))
    if (available) gauge('funnelmetry_kafka_lag_offsets', 'Kafka offset-position lag for all sources; not business-event count.', labels, group.lag_offsets)
    const membership = group.membership
    const known = membership?.status === 'OBSERVED' && groupStates.has(membership.state) &&
      Number.isSafeInteger(membership.member_count) && membership.member_count >= 0
    gauge('funnelmetry_kafka_membership_available', 'Broker membership observation is known, not worker health.', { group_id: group.group_id }, Number(known))
    if (known) {
      gauge('funnelmetry_kafka_group_members', 'Members of the whole consumer group, not container count.', { group_id: group.group_id }, membership.member_count)
      gauge('funnelmetry_kafka_group_state', 'Current observed broker group state; Stable is not processing success.',
        { group_id: group.group_id, state: membership.state }, 1)
    }
  }
  for (const row of rows) {
    const labels = { worker: row.worker }
    const known = ['STARTING', 'READY', 'DEGRADED', 'STOPPING'].includes(row.status) &&
      typeof row.ready === 'boolean' && row.ready === (row.status === 'READY')
    gauge('funnelmetry_worker_observation_available', 'Worker runtime observation is known.', labels, Number(known))
    if (known) gauge('funnelmetry_worker_runtime_ready', 'Local Kafka runtime flag only; not continuous dependency readiness.', labels, Number(row.ready))
    timestamp('workers', row.checked_at, labels)
  }
  return [...families].map(([name, family]) => `# HELP ${name} ${family.help}\n# TYPE ${name} gauge\n` +
    [...family.samples].map(([labels, value]) => `${name}{${labels}} ${value}\n`).join('')).join('')
}
