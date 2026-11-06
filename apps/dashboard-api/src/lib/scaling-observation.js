import { open } from 'node:fs/promises'
import { kafkaLag } from './kafka-lag.js'
import { workerReadiness } from './worker-readiness.js'
import { readControllerObservation } from './controller-observation.js'
import { readWorkerTelemetry } from './worker-telemetry.js'

// The API reads a bounded telemetry file; it never receives Docker access.
export function createScalingProbe({ env = process.env, lag = kafkaLag, workers = workerReadiness, clock = Date.now } = {}) {
  return async () => {
    const checked_at = new Date(clock()).toISOString()
    const runtime = { status: 'UNVERIFIED', reason: 'NOT_CONFIGURED', observed_at: null, desired_replicas: null, running_replicas: null, memory_percent_max: null }
    let telemetry
    if (env.DASHBOARD_SCALING_SNAPSHOT_FILE) {
      let file
      try {
        file = await open(env.DASHBOARD_SCALING_SNAPSHOT_FILE, 'r')
        const buffer = Buffer.alloc(16385)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 16384) throw Error('oversized')
        const data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
        const age = clock() - Date.parse(data.observed_at)
        const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000
        if (data.service !== 'canonical-normalizer' || data.stack !== env.DASHBOARD_SCALING_STACK ||
          !Number.isFinite(age) || age < -5000 || age > 60000 ||
          !count(data.desired_replicas) || !count(data.running_replicas) ||
          !(data.memory_percent_max === null || (Number.isFinite(data.memory_percent_max) && data.memory_percent_max >= 0 && data.memory_percent_max <= 100))) throw Error('invalid')
        Object.assign(runtime, { status: 'OBSERVED', reason: null, observed_at: data.observed_at,
          desired_replicas: data.desired_replicas, running_replicas: data.running_replicas, memory_percent_max: data.memory_percent_max })
        telemetry = data
      } catch { runtime.reason = 'SNAPSHOT_UNAVAILABLE_OR_STALE' }
      finally { await file?.close() }
    }
    const [lagResult, workerResult] = await Promise.allSettled([lag(), workers()])
    let group = lagResult.status === 'fulfilled' ? lagResult.value.groups?.find(row =>
      row.group_id === (env.DASHBOARD_SCALING_GROUP_ID || 'funnelmetry-canonical-normalizer-v1') &&
      row.topic === (env.DASHBOARD_SCALING_TOPIC || 'funnelmetry.raw.v1')) : null
    let worker = workerResult.status === 'fulfilled' ? workerResult.value.workers?.find(row => row.worker === 'canonical-normalizer') : null
    const k = telemetry?.kafka
    if (group?.status !== 'OBSERVED' && k?.status === 'OBSERVED' &&
      k.group_id === (env.DASHBOARD_SCALING_GROUP_ID || 'funnelmetry-canonical-normalizer-v1') &&
      k.topic === (env.DASHBOARD_SCALING_TOPIC || 'funnelmetry.raw.v1') &&
      typeof k.raw_offset_lag === 'string' && /^(0|[1-9]\d{0,30})$/.test(k.raw_offset_lag) &&
      Number.isSafeInteger(k.partition_count) && k.partition_count > 0 && k.partition_count <= 128) {
      group = { status: 'OBSERVED', lag_offsets: k.raw_offset_lag, partition_count: k.partition_count }
    }
    if (worker?.ready == null && telemetry) {
      const sample = await readWorkerTelemetry(env, ['canonical-normalizer'], clock)
      const w = sample.workers[0]
      if (w?.ready != null) worker = w
    }
    return { checked_at, service: 'canonical-normalizer', scope: 'all_sources_service_runtime', read_only: true, runtime,
      kafka: { status: group?.status ?? 'UNVERIFIED', raw_offset_lag: group?.status === 'OBSERVED' ? group.lag_offsets : null,
        partition_count: group?.partition_count ?? group?.partitions?.length ?? null, consumable_lag: null },
      readiness: { status: worker?.status ?? 'UNVERIFIED', ready: worker?.ready ?? null },
      controller: await readControllerObservation(env, clock()) }
  }
}
export const scalingObservation = createScalingProbe()
