export const WORKERS = ['canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer', 'journey-processor', 'funnel-processor', 'kpi-projector']

async function probeWorker(worker, fetcher) {
  const checked_at = new Date().toISOString()
  const unknown = { worker, checked_at, status: 'UNVERIFIED', ready: null, scope: 'local_kafka_runtime_flag' }
  try {
    const response = await fetcher(`http://${worker}:32110/readyz`, { redirect: 'error', signal: AbortSignal.timeout(3000) })
    if (![200, 503].includes(response.status)) { await response.body?.cancel(); return unknown }
    const reader = response.body.getReader()
    let length = 0, chunks = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 4096) throw Error('oversized_health_response')
        chunks.push(Buffer.from(value))
      }
    } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (data.worker !== worker || data.scope !== unknown.scope ||
        !['STARTING', 'READY', 'DEGRADED', 'STOPPING'].includes(data.status) ||
        data.ready !== (data.status === 'READY') || (response.status === 200) !== data.ready) return unknown
    return { ...unknown, status: data.status, ready: data.ready }
  } catch { return unknown }
}

export function createWorkerProbe({ fetcher = fetch, env = process.env, cacheMs = 5000 } = {}) {
  let active, cached, expires = 0
  return async () => {
    if (env.DASHBOARD_WORKER_HEALTH_ENABLED !== 'true') return { reason: 'NOT_CONFIGURED', workers: [] }
    if (cached && Date.now() < expires) return cached
    if (active) return active
    active = Promise.all(WORKERS.map(worker => probeWorker(worker, fetcher)))
      .then(workers => { cached = { workers }; expires = Date.now() + cacheMs; return cached })
      .finally(() => { active = null })
    return active
  }
}
export const workerReadiness = createWorkerProbe()
