import pg from "pg"
import { loadConfig } from "./config.js"
import { createWorkerHealth } from '../../shared/health-server.mjs'
import { createKafkaIngressTelemetryRuntime } from "./kafka-runtime.js"
import { createIngressTelemetryRepository } from "./repository.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createIngressTelemetryRepository({ pool })
const runtime = createKafkaIngressTelemetryRuntime({ ...config.kafka, repository })
let shuttingDown = false
const health = createWorkerHealth({ worker: 'ingress-telemetry-writer', runtime, isStopping: () => shuttingDown })

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`ingress-telemetry-writer received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await health.stop()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("ingress-telemetry-writer shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("ingress-telemetry-writer shutdown failed", error)
  process.exitCode = 1
}))

try {
  await health.start()
  await pool.query("SELECT 1")
  await runtime.start()
  health.markStarted()
  console.log("ingress-telemetry-writer is persisting accepted receipts and canonicalization outcomes")
} catch (error) {
  console.error("ingress-telemetry-writer startup failed", error)
  await health.stop()
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
