import pg from "pg"
import { loadConfig } from "./config.js"
import { createJourneyRepository } from "./repository.js"
import { createKafkaJourneyRuntime } from "./kafka-runtime.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createJourneyRepository({ pool })
const runtime = createKafkaJourneyRuntime({ ...config.kafka, repository })
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`journey-processor received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("journey-processor shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("journey-processor shutdown failed", error)
  process.exitCode = 1
}))

try {
  await pool.query("SELECT 1")
  await runtime.start()
  console.log("journey-processor is resolving persisted canonical events")
} catch (error) {
  console.error("journey-processor startup failed", error)
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
