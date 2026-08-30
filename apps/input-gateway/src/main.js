import { createIngressHandler } from "./ingress-handler.js"
import { loadConfig } from "./config.js"
import { createIngressHttpServer } from "./http-server.js"
import { createKafkaRuntime } from "./kafka-runtime.js"

const config = loadConfig()
const runtime = createKafkaRuntime(config.kafka)
const handleIngress = createIngressHandler({
  durableIngress: runtime.durableIngress,
  browserKeys: config.browserKeys,
  backendKeys: config.backendKeys,
  maxBodyBytes: config.maxBodyBytes,
  maxPayloadBytes: config.maxPayloadBytes,
  maxClockSkewMs: config.maxClockSkewMs,
})
const server = createIngressHttpServer({
  handleIngress,
  isReady: runtime.isReady,
  corsOrigins: config.corsOrigins,
  maxBodyBytes: config.maxBodyBytes,
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`input-gateway received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  server.closeIdleConnections?.()
  await new Promise((resolve) => server.close(resolve))
  await runtime.stop()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("input-gateway shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("input-gateway shutdown failed", error)
  process.exitCode = 1
}))

try {
  await runtime.start()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.port, config.host, resolve)
  })
  console.log(`input-gateway listening on http://${config.host}:${config.port}`)
} catch (error) {
  console.error("input-gateway startup failed", error)
  await runtime.stop()
  process.exitCode = 1
}
