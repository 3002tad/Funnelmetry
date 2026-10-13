// Entrypoint for a fresh, isolated Swarm cursor. The wrapper resolves mounted
// secrets before this file runs; no database URL or token enters the stack spec.
if (process.env.SWARM_LIVE_ACK !== 'FRESH_PARALLEL_LIVE' ||
    process.env.SOURCE_CONNECTOR_MODE !== 'NORMAL' ||
    !process.env.POSTGRES_PASSWORD) {
  console.error('Fresh parallel-live connector acknowledgement or DB secret missing')
  process.exitCode = 1
} else {
  process.env.SOURCE_CONNECTOR_DATABASE_URL = `postgresql://funnelmetry:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@postgres:5432/funnelmetry_handoff`
  await import('./main.js')
}
