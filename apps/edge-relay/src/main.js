import { createSourceIngressHttpServer } from "./http-server.js"
import { loadConfig } from "./config.js"
import { createMetrics } from "./metrics.js"
import { createSourceIngressHandler } from "./relay-handler.js"
import { SourceEventStore } from "./relay-repository.js"

const config = loadConfig()
const repository = new SourceEventStore(config)
const metrics = createMetrics()
const handleSourceIngress = createSourceIngressHandler({
  repository,
  browserKeys: config.browserKeys,
  backendKeys: config.backendKeys,
  metrics,
  maxBodyBytes: config.maxBodyBytes,
  maxPayloadBytes: config.maxPayloadBytes,
  maxClockSkewMs: config.maxClockSkewMs,
})
const server = createSourceIngressHttpServer({
  handleSourceIngress,
  repository,
  metrics,
  browserKeys: config.browserKeys,
  maxBodyBytes: config.maxBodyBytes,
  adminToken: config.adminToken,
  eventFeedTokens: config.eventFeedTokens,
  eventFeedMaxLimit: config.eventFeedMaxLimit,
  eventFeedMaxWaitSeconds: config.eventFeedMaxWaitSeconds,
})

let closing = false

function shutdown(signal) {
  if (closing) return
  closing = true
  server.close(() => {
    repository.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
  console.info(JSON.stringify({ message: "Funnelmetry Source Ingress stopping", signal }))
}

server.listen(config.port, config.host, () => {
  worker.start()
  console.info(JSON.stringify({
    message: "Funnelmetry Source Ingress listening",
    host: config.host,
    port: config.port,
    event_feed_id: repository.eventFeedId,
  }))
})

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
