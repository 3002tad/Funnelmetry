import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Only validate the read model here. The API image does not contain the
// manager-side controller/actuator toolchain and must not import it.
function validateObservationPolicy(config) {
  const p = config?.autoscale
  const positive = value => Number.isSafeInteger(value) && value > 0
  const decimal = value => typeof value === 'string' && /^(0|[1-9]\d{0,30})$/.test(value)
  if (config?.service !== 'canonical-normalizer' || typeof config.stack !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,100}$/.test(config.stack) || !p ||
      p.project !== config.stack || p.service !== config.service ||
      !positive(config.cpuHeadroomNano) || !positive(config.memoryHeadroomBytes) ||
      !positive(p.minReplicas) || !positive(p.maxReplicas) || p.minReplicas > p.maxReplicas || p.maxReplicas > 32 ||
      !decimal(p.upLag) || !decimal(p.downLag) ||
      ![p.upWindowMs, p.downWindowMs, p.cooldownMs, p.maxSampleAgeMs].every(positive) ||
      [p.upMemoryPercent, p.downMemoryPercent].some(value => value !== undefined &&
        (!Number.isFinite(value) || value < 0 || value > 100))) throw Error('invalid_policy')
}

async function boundedJson(path, limit) {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw Error('oversized')
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally { await file.close() }
}
export async function readControllerObservation(env = process.env, now = Date.now()) {
  const unavailable = { status: 'UNVERIFIED', reason: 'CONTROLLER_STATE_NOT_CONNECTED', policy: null, history: [], series: [] }
  if (!env.DASHBOARD_CONTROLLER_OBSERVATION_DIR) return unavailable
  try {
    const directory = env.DASHBOARD_CONTROLLER_OBSERVATION_DIR
    const [config, state, completion] = await Promise.all([
      boundedJson(join(directory, 'config.json'), 32768), boundedJson(join(directory, 'state.json'), 262144),
      boundedJson(join(directory, 'status.json'), 16384),
    ])
    validateObservationPolicy(config)
    const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex')
    if (config.stack !== env.DASHBOARD_SCALING_STACK || state.version !== 1 || state.fingerprint !== fingerprint ||
      state.pending !== null || !Array.isArray(state.audit) || state.audit.length > 200 || !state.audit.length ||
      state.audit.some(event => event.result !== 'OBSERVE_ONLY') ||
      completion.scope?.stack !== config.stack || completion.scope?.service !== config.service ||
      !Number.isFinite(Date.parse(completion.checkedAt)) || Date.parse(completion.checkedAt) > now + 5000) throw Error('invalid')
    const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000
    const decimal = value => typeof value === 'string' && /^(0|[1-9]\d{0,30})$/.test(value)
    const safeCode = value => typeof value === 'string' && /^[A-Z_]{1,100}$/.test(value) ? value : null
    const history = state.audit.map(event => {
      if (!Number.isSafeInteger(event.at) || event.at < 0 || event.at > now + 5000 || !safeCode(event.reason)) throw Error('invalid_event')
      return { at: new Date(event.at).toISOString(), kind: event.signal === 'kafka_lag' ? 'AUTOSCALE' : 'RECOVERY',
        reason: safeCode(event.reason), result: 'OBSERVE_ONLY', action: safeCode(event.action) ?? 'HOLD',
        previous_replicas: count(event.previousReplicas) ? event.previousReplicas : null,
        desired_replicas: count(event.desiredReplicas) ? event.desiredReplicas : null,
        consumable_lag: decimal(event.observedValue) ? event.observedValue : null,
        raw_offset_lag: decimal(event.rawOffsetLag) ? event.rawOffsetLag : null,
        memory_percent: Number.isFinite(event.observedMemoryPercent) && event.observedMemoryPercent >= 0 && event.observedMemoryPercent <= 100 ? event.observedMemoryPercent : null }
    })
    const series = history.filter(row => row.kind === 'AUTOSCALE').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    const last = series.at(-1)
    if (!last || Date.parse(completion.checkedAt) < Date.parse(last.at)) throw Error('missing_observations')
    const p = config.autoscale
    return { status: 'COMPLETED_OBSERVATION', mode: 'OBSERVE_ONLY', reason: null,
      last_observed_at: last.at, stale: now - Date.parse(last.at) > p.maxSampleAgeMs,
      recovery_status: safeCode(completion.recovery?.persistedStatus),
      policy: { scope: 'LOCAL_OBSERVATION_TEST', min_replicas: p.minReplicas, max_replicas: p.maxReplicas,
        up_lag: p.upLag, down_lag: p.downLag, up_memory_percent: p.upMemoryPercent ?? null,
        down_memory_percent: p.downMemoryPercent ?? null, up_window_ms: p.upWindowMs, down_window_ms: p.downWindowMs,
        cooldown_ms: p.cooldownMs, cpu_headroom_nano: config.cpuHeadroomNano, memory_headroom_bytes: config.memoryHeadroomBytes },
      last_decision: last, history: history.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), series }
  } catch { return { ...unavailable, reason: 'CONTROLLER_OBSERVATION_INVALID_OR_UNAVAILABLE' } }
}
