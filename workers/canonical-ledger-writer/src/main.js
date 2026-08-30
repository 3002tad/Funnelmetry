import pg from "pg"
import { loadConfig } from "./config.js"
import { createCanonicalLedgerRepository } from "./repository.js"
import { createKafkaLedgerRuntime } from "./kafka-runtime.js"

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createCanonicalLedgerRepository({ pool })
const runtime = createKafkaLedgerRuntime({ ...config.kafka, repository })
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`canonical-ledger-writer received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("canonical-ledger-writer shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("canonical-ledger-writer shutdown failed", error)
  process.exitCode = 1
}))

try {
  await pool.query("SELECT 1")
  await runtime.start()
  console.log("canonical-ledger-writer is persisting canonical events")
} catch (error) {
  console.error("canonical-ledger-writer startup failed", error)
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
