import { hasPermission } from './roles.js'

// Bounded queue; validate current authorization before every outgoing batch/ping.
export function attachGuardedSse({ req, res, bus, claims, execute, now = Date.now,
  intervalMs = 5000, timeoutMs = 5000, maxPending = 32 }) {
  let closed = false, draining = false
  const pending = []
  let timer
  function close() {
    if (closed) return
    closed = true
    pending.length = 0
    clearInterval(timer)
    bus.off('events', onEvents)
    bus.off('kpi', onKpi)
    req.off('close', close)
    res.off('close', close)
    res.end()
  }
  async function authorized() {
    if (!Number.isInteger(claims.session_version) || !Number.isFinite(claims.exp)
      || now() >= claims.exp * 1000) return false
    let deadline
    try {
      const rows = await Promise.race([
        execute('SELECT role,is_active,session_version FROM dashboard_users WHERE id=$1', [claims.sub]),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('timeout')), timeoutMs) }),
      ])
      const user = rows[0]
      return user?.is_active && user.session_version === claims.session_version
        && hasPermission(user.role, 'analytics.workspace.use') && now() < claims.exp * 1000
    } finally { clearTimeout(deadline) }
  }
  async function drain() {
    if (draining || closed) return
    draining = true
    try {
      while (pending.length && !closed) {
        const [name, payload] = pending.shift()
        if (!await authorized()) { close(); break }
        if (closed) break
        // Slow clients reconnect rather than accumulating an unbounded response buffer.
        if (!res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)) close()
      }
    } catch { close() }
    finally { draining = false }
  }
  function enqueue(name, payload) {
    if (closed) return
    if (pending.length >= maxPending) { close(); return }
    pending.push([name, payload])
    void drain()
  }
  function onEvents(rows) { enqueue('events', rows) }
  function onKpi() { enqueue('kpi', {}) }
  bus.on('events', onEvents)
  bus.on('kpi', onKpi)
  req.on('close', close)
  res.on('close', close)
  timer = setInterval(() => enqueue('ping', { ts: new Date(now()).toISOString() }), intervalMs)
  timer.unref?.()
  return close
}
