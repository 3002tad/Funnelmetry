import { open } from 'node:fs/promises'

export async function readWorkerTelemetry(env, names, clock = Date.now) {
  let file
  try {
    file = await open(env.DASHBOARD_SCALING_SNAPSHOT_FILE, 'r')
    const buffer = Buffer.alloc(16385)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 16384) throw Error('oversized')
    const data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    const age = clock() - Date.parse(data.observed_at)
    if (data.stack !== env.DASHBOARD_SCALING_STACK || data.service !== 'canonical-normalizer' ||
      !Number.isFinite(age) || age < -5000 || age > 60000 || !Array.isArray(data.workers)) throw Error('invalid')
    return { workers: names.map(worker => {
      const matches = data.workers.filter(row => row?.worker === worker)
      const row = matches.length === 1 ? matches[0] : null
      const sampleAge = clock() - Date.parse(row?.checked_at)
      const valid = row && Number.isFinite(sampleAge) && sampleAge >= -5000 && sampleAge <= 60000 &&
        row.scope === 'local_kafka_runtime_flag' && ['READY','DEGRADED','STARTING','STOPPING'].includes(row.status) && row.ready === (row.status === 'READY')
      return { worker, checked_at: valid ? row.checked_at : data.observed_at,
        status: valid ? row.status : 'UNVERIFIED', ready: valid ? row.ready : null, scope: 'local_kafka_runtime_flag' }
    }) }
  } catch { return { reason: 'SNAPSHOT_UNAVAILABLE_OR_STALE', workers: [] } }
  finally { await file?.close() }
}
