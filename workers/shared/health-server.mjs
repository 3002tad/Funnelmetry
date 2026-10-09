import { createServer } from 'node:http'

// Opt-in, private network only. No payloads, credentials or actuator exposed.
export function createWorkerHealth({ worker, runtime, isStopping, port = process.env.WORKER_HEALTH_PORT, host = '0.0.0.0' }) {
  let server, started = false
  return {
    markStarted() { started = true },
    async start() {
      if (port === undefined || port === '') return
      if (!/^\d+$/.test(String(port)) || Number(port) < 0 || Number(port) > 65535) throw Error('invalid_worker_health_port')
      server = createServer((req, res) => {
        if (req.method !== 'GET' || !['/healthz', '/readyz'].includes(req.url)) { res.writeHead(404).end(); return }
        let status = 'DEGRADED'
        try { status = isStopping() ? 'STOPPING' : !started ? 'STARTING' : runtime.isHealthy() ? 'READY' : 'DEGRADED' } catch {}
        const ready = status === 'READY'
        res.writeHead(req.url === '/healthz' || ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ worker, status, ready, scope: 'local_kafka_runtime_flag' }))
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), host, resolve) })
      return server.address().port
    },
    async stop() { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } },
  }
}
