import pg from "pg"
import { loadConfig } from "./config.js"
import { createKafkaKpiRuntime } from "./kafka-runtime.js"
import { createKpiRepository } from "./repository.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createKpiRepository({ pool })
const runtime = createKafkaKpiRuntime({ ...config.kafka, repository })
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`kpi-projector received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("kpi-projector shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("kpi-projector shutdown failed", error)
  process.exitCode = 1
}))

try {
  await pool.query("SELECT 1")
  await runtime.start()
  console.log("kpi-projector is materializing funnel KPI base facts")
} catch (error) {
  console.error("kpi-projector startup failed", error)
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
