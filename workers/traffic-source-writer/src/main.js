import pg from 'pg'
import { createWorkerHealth } from '../../shared/health-server.mjs'
import { loadConfig } from './config.js'
import { createKafkaTrafficSourceRuntime } from './kafka-runtime.js'
import { createTrafficSourceRepository } from './repository.js'

const config = loadConfig()
const pool = new pg.Pool(config.postgres)
const repository = createTrafficSourceRepository({ pool })
const runtime = createKafkaTrafficSourceRuntime({ ...config.kafka, repository })
let shuttingDown = false
const health = createWorkerHealth({ worker: 'traffic-source-writer', runtime, isStopping: () => shuttingDown })

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`traffic-source-writer received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await health.stop()
  await runtime.stop()
  await pool.end()
  clearTimeout(forceExit)
}

process.once('SIGINT', () => shutdown('SIGINT').catch(() => { process.exitCode = 1 }))
process.once('SIGTERM', () => shutdown('SIGTERM').catch(() => { process.exitCode = 1 }))

try {
  await health.start()
  await pool.query('SELECT 1 FROM traffic_source_raw_events_v1 LIMIT 0')
  await runtime.start()
  health.markStarted()
  console.log('traffic-source-writer is projecting hashed raw UTM metadata')
} catch {
  console.error('traffic-source-writer startup failed; check additive schema, DB and Kafka')
  await health.stop()
  await runtime.stop()
  await pool.end()
  process.exitCode = 1
}
