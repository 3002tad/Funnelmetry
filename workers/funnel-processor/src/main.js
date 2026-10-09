import pg from "pg"
import { loadConfig } from "./config.js"
import { createWorkerHealth } from '../../shared/health-server.mjs'
import { createKafkaFunnelRuntime } from "./kafka-runtime.js"
import { createFunnelRepository } from "./repository.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createFunnelRepository({ pool })
const runtime = createKafkaFunnelRuntime({ ...config.kafka, repository })
let shuttingDown = false
const health = createWorkerHealth({ worker: 'funnel-processor', runtime, isStopping: () => shuttingDown })

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`funnel-processor received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await health.stop()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("funnel-processor shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("funnel-processor shutdown failed", error)
  process.exitCode = 1
}))

try {
  await health.start()
  await pool.query("SELECT 1")
  await runtime.start()
  health.markStarted()
  console.log("funnel-processor is projecting resolved journeys")
} catch (error) {
  console.error("funnel-processor startup failed", error)
  await health.stop()
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
