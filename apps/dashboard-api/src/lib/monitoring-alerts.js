import { WORKERS } from './worker-readiness.js'

export function alertPolicy(env = process.env) {
  const bounded = (key, fallback, max) => {
    const value = Number(env[key] ?? fallback)
    if (!Number.isInteger(value) || value < 1 || value > max) throw Error('invalid_alert_policy')
    return value
  }
  return { expiry_warning_seconds: bounded('MONITORING_EXPIRY_WARNING_SECONDS', 86400, 31536000),
    scrape_stale_seconds: bounded('MONITORING_SCRAPE_STALE_SECONDS', 120, 3600) }
}

// Operator-controlled fixed Docker DNS, never a caller-provided target/PromQL.
export async function scrapeObservation({ env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  if (env.DASHBOARD_PROMETHEUS_MONITORING_ENABLED !== 'true') return { state: 'UNKNOWN', reason: 'NOT_CONFIGURED' }
  try {
    const r = await fetcher('http://prometheus:9090/api/v1/targets?state=active', { redirect: 'error', signal: AbortSignal.timeout(4000) })
    if (!r.ok) { await r.body?.cancel(); throw Error('unavailable') }
    const reader = r.body.getReader(); let size = 0; const chunks = []
    try { for (;;) { const {done,value} = await reader.read(); if (done) break
      size += value.byteLength; if (size > 65536) throw Error('oversized'); chunks.push(Buffer.from(value))
    } } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (data.status !== 'success' || !Array.isArray(data.data?.activeTargets)) throw Error('invalid')
    const rows = data.data.activeTargets.filter(t => t.labels?.job === 'funnelmetry-monitoring')
    if (rows.length !== 1) return { state: 'UNKNOWN', reason: 'TARGET_MISSING_OR_AMBIGUOUS' }
    const row = rows[0], time = Date.parse(row.lastScrape)
    if (!Number.isFinite(time) || time <= 0 || time > now + 5000 || now - time > alertPolicy(env).scrape_stale_seconds * 1000)
      return { state: 'UNKNOWN', reason: 'SCRAPE_STALE_OR_MISSING' }
    if (!['up', 'down'].includes(row.health)) return { state: 'UNKNOWN', reason: 'SCRAPE_UNKNOWN' }
    return { state: row.health === 'up' ? 'OK' : 'ERROR', checked_at: new Date(time).toISOString() }
  } catch { return { state: 'UNKNOWN', reason: 'PROMETHEUS_UNAVAILABLE' } }
}

export function monitoringAlerts({ workers, scrape, credentials, policy, now = Date.now() }) {
  const items = []
  const add = (id, level, code, subject) => items.push({ id, level, code, ...(subject ? { subject } : {}) })
  if (scrape.state === 'ERROR') add('scrape', 'ERROR', 'SCRAPE_FAILED')
  else if (scrape.state !== 'OK') add('scrape', 'UNKNOWN', scrape.reason ?? 'SCRAPE_UNKNOWN')
  for (const name of WORKERS) {
    const w = workers?.workers?.find(w => w.worker === name)
    if (!w || w.ready === null || !['READY','STARTING','DEGRADED','STOPPING'].includes(w.status) || w.ready !== (w.status === 'READY'))
      add(`worker:${name}`, 'UNKNOWN', 'WORKER_UNVERIFIED', name)
    else if (!w.ready) add(`worker:${name}`, 'WARNING', 'WORKER_NOT_READY', name)
  }
  if (!credentials) add('credentials', 'UNKNOWN', 'CREDENTIALS_UNAVAILABLE')
  else {
    if (!credentials.length) add('credentials', 'UNKNOWN', 'NO_USABLE_CREDENTIAL_REGISTERED')
    for (const c of credentials) {
      const expiry = Date.parse(c.expires_at)
      if (!Number.isFinite(expiry)) add(`key:${c.id}`, 'UNKNOWN', 'CREDENTIAL_EXPIRY_UNKNOWN', c.id)
      else if (expiry <= now) add(`key:${c.id}`, 'WARNING', 'CREDENTIAL_EXPIRED', c.id)
      else if (expiry - now <= policy.expiry_warning_seconds * 1000) add(`key:${c.id}`, 'WARNING', 'CREDENTIAL_EXPIRING', c.id)
    }
  }
  return { checked_at: new Date(now).toISOString(), policy, scrape,
    scope: 'current_observations_all_sources_and_unrevoked_keys', items,
    status: items.some(i => i.level !== 'UNKNOWN') ? 'ATTENTION' : items.length ? 'UNVERIFIED' : 'NO_CURRENT_WARNINGS' }
}
