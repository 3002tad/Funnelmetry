import pg from "pg"
import { loadConfig } from "./config.js"
import { createFunnelMaturityRepository } from "./repository.js"
import { createMaturitySchedulerRuntime } from "./runtime.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createFunnelMaturityRepository({ pool })
const runtime = createMaturitySchedulerRuntime({
  pool,
  repository,
  instanceId: config.instanceId,
  batchSize: config.batchSize,
  pollIntervalMs: config.pollIntervalMs,
})
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`funnel-maturity-scheduler received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("funnel-maturity-scheduler shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("funnel-maturity-scheduler shutdown failed", error)
  process.exitCode = 1
}))

try {
  await pool.query("SELECT 1")
  await runtime.start()
  console.log("funnel-maturity-scheduler is polling maturity candidates")
} catch (error) {
  console.error("funnel-maturity-scheduler startup failed", error)
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
