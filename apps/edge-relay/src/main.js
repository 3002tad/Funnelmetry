import { createRelayHttpServer } from "./http-server.js"
import { loadConfig } from "./config.js"
import { createDeliveryWorker } from "./delivery-worker.js"
import { createMetrics } from "./metrics.js"
import { createRelayHandler } from "./relay-handler.js"
import { RelayRepository } from "./relay-repository.js"
import { createUpstreamClient } from "./upstream-client.js"

const config = loadConfig()
const repository = new RelayRepository(config)
const metrics = createMetrics()
const upstream = config.upstream.enabled
  ? createUpstreamClient({
    ingressUrl: config.upstream.ingressUrl,
    upstreamBrowserKeys: config.upstreamBrowserKeys,
    requestTimeoutMs: config.requestTimeoutMs,
  })
  : null
const worker = createDeliveryWorker({
  repository,
  upstream,
  upstreamEnabled: config.upstream.enabled,
  instanceId: config.instanceId,
  leaseMs: config.leaseMs,
  intervalMs: config.deliveryIntervalMs,
  batchSize: config.deliveryBatchSize,
  retryMinMs: config.retryMinMs,
  retryMaxMs: config.retryMaxMs,
  metrics,
})
const handleRelay = createRelayHandler({
  repository,
  browserKeys: config.browserKeys,
  metrics,
  maxBodyBytes: config.maxBodyBytes,
  maxPayloadBytes: config.maxPayloadBytes,
})
const server = createRelayHttpServer({
  handleRelay,
  repository,
  worker,
  metrics,
  browserKeys: config.browserKeys,
  maxBodyBytes: config.maxBodyBytes,
  adminToken: config.adminToken,
})

let closing = false

function shutdown(signal) {
  if (closing) return
  closing = true
  worker.stop()
  server.close(() => {
    repository.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
  console.info(JSON.stringify({ message: "Funnelmetry Edge Relay stopping", signal }))
}

server.listen(config.port, config.host, () => {
  worker.start()
  console.info(JSON.stringify({
    message: "Funnelmetry Edge Relay listening",
    host: config.host,
    port: config.port,
    upstream_state: worker.getStatus().state,
  }))
})

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
