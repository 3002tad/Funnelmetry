const decimal = value => typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value)
const count = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 10000
export function telemetryScope(env = process.env) {
  const stack = env.DASHBOARD_SCALING_STACK
  if (typeof stack !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,100}$/.test(stack)) throw Error('telemetry_stack_not_configured')
  return { stack, service: 'canonical-normalizer', group: env.DASHBOARD_SCALING_GROUP_ID || 'funnelmetry-canonical-normalizer-v1', topic: env.DASHBOARD_SCALING_TOPIC || 'funnelmetry.raw.v1' }
}
export function normalizeTelemetry(data, scope, now = Date.now()) {
  const age = now - Date.parse(data?.observed_at), k = data?.kafka
  if (data?.stack !== scope.stack || data?.service !== scope.service || !Number.isFinite(age) || age < -5000 || age > 60000 ||
    !count(data.desired_replicas) || !count(data.running_replicas) ||
    !(data.memory_percent_max === null || typeof data.memory_percent_max === 'number' && Number.isFinite(data.memory_percent_max) && data.memory_percent_max >= 0 && data.memory_percent_max <= 100)) throw Error('invalid_telemetry')
  const bound = k?.status === 'OBSERVED' && k?.group_id === scope.group && k?.topic === scope.topic
  const raw = bound && decimal(k.raw_offset_lag) ? k.raw_offset_lag : null
  const lag = raw !== null && decimal(k.consumable_lag) && BigInt(k.consumable_lag) <= BigInt(raw) ? k.consumable_lag : null
  const worker = Array.isArray(data.workers) ? data.workers.find(w => w?.worker === scope.service) : null
  const workerAge = now - Date.parse(worker?.checked_at)
  const readiness = worker && Number.isFinite(workerAge) && workerAge >= -5000 && workerAge <= 60000 &&
    worker.scope === 'local_kafka_runtime_flag' && ['READY','DEGRADED','STARTING','STOPPING'].includes(worker.status) && worker.ready === (worker.status === 'READY') ? worker.status : 'UNVERIFIED'
  return { ...scope, observed_at: new Date(data.observed_at).toISOString(), desired_replicas: data.desired_replicas, running_replicas: data.running_replicas,
    memory_percent_max: data.memory_percent_max, raw_offset_lag: raw, consumable_lag: lag,
    partition_count: bound && Number.isInteger(k.partition_count) && k.partition_count > 0 && k.partition_count <= 128 ? k.partition_count : null,
    control_only_partitions: lag !== null && Number.isInteger(k.control_only_partitions) && k.control_only_partitions >= 0 && k.control_only_partitions <= 128 ? k.control_only_partitions : null,
    lag_status: lag === null ? 'UNVERIFIED' : 'OBSERVED', lag_reason: lag === null ? 'CONSUMABLE_LAG_UNVERIFIED' : k.control_only_partitions > 0 ? 'VERIFIED_CONTROL_TAIL_EXCLUDED' : 'RAW_OFFSETS_RETAINED_CONSERVATIVELY', readiness_status: readiness }
}
export const INSERT_TELEMETRY_SQL = `INSERT INTO service_telemetry_samples
  (stack_name,service_name,consumer_group_id,topic,observed_at,desired_replicas,running_replicas,memory_percent_max,
   raw_offset_lag,consumable_lag,partition_count,control_only_partitions,lag_status,lag_reason,readiness_status,measurement_version)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'read_committed_tail_v1') ON CONFLICT DO NOTHING`
export async function persistTelemetry(execute, sample, retentionDays = 7) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) throw Error('invalid_telemetry_retention')
  const s = sample
  await execute(INSERT_TELEMETRY_SQL, [s.stack,s.service,s.group,s.topic,s.observed_at,s.desired_replicas,s.running_replicas,s.memory_percent_max,s.raw_offset_lag,s.consumable_lag,s.partition_count,s.control_only_partitions,s.lag_status,s.lag_reason,s.readiness_status])
  await execute(`WITH expired AS (SELECT ctid FROM service_telemetry_samples
    WHERE stack_name=$1 AND service_name=$2 AND observed_at < now() - ($3::integer * interval '1 day') LIMIT 5000)
    DELETE FROM service_telemetry_samples t USING expired e WHERE t.ctid=e.ctid`, [s.stack,s.service,retentionDays])
}
export function parseTelemetryHistory(query, env = process.env, now = Date.now()) {
  if (Object.keys(query).some(k => k !== 'hours') || query.hours !== undefined && (typeof query.hours !== 'string' || !/^\d{1,3}$/.test(query.hours))) throw Error('invalid_telemetry_query')
  const hours = Number(query.hours ?? '24')
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw Error('invalid_telemetry_query')
  return { ...telemetryScope(env), from: new Date(now-hours*3600000).toISOString(), to: new Date(now).toISOString(), bucket_seconds: Math.max(30, Math.ceil(hours*3600/720)) }
}
export async function readTelemetryHistory(execute, scope) {
  const rows = await execute(`SELECT DISTINCT ON (floor(extract(epoch FROM observed_at)/$7::integer))
    observed_at,desired_replicas,running_replicas,memory_percent_max,raw_offset_lag::text,consumable_lag::text,
    partition_count,control_only_partitions,lag_status,lag_reason,readiness_status
    FROM service_telemetry_samples WHERE stack_name=$1 AND service_name=$2 AND consumer_group_id=$3 AND topic=$4
    AND observed_at >= $5::timestamptz AND observed_at <= $6::timestamptz
    AND measurement_version='read_committed_tail_v1'
    ORDER BY floor(extract(epoch FROM observed_at)/$7::integer) DESC, observed_at DESC LIMIT 721`,
    [scope.stack,scope.service,scope.group,scope.topic,scope.from,scope.to,scope.bucket_seconds])
  return { status: 'OBSERVED', service: scope.service, scope: 'all_sources_service_runtime', from: scope.from, to: scope.to,
    bucket_seconds: scope.bucket_seconds, sampling: 'latest_actual_sample_per_bucket', checked_at: new Date().toISOString(), items: rows.reverse() }
}
