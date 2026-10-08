import { createServer } from 'node:http'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { loadConfig } from './config.js'
import { createFeedClient } from './feed-client.js'
import { createConnector, ConnectorError } from './connector.js'
import { openPostgresCursorStore } from './postgres-cursor-store.js'
import { createKafkaPublisher } from './kafka-publisher.js'
import { supervise } from './supervisor.js'

async function main() {
  const config = loadConfig()
  const feedClient = createFeedClient(config)
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2,
    connectionTimeoutMillis: 10000, query_timeout: 10000 })
  pool.on('error', () => {}) // Session error handler marks ownership lost; never log credentials.
  const kafka = new Kafka({ clientId: config.id, brokers: config.brokers, logLevel: logLevel.NOTHING,
    connectionTimeout: 10000, requestTimeout: 30000, retry: { retries: 2 } })
  const controller = new AbortController()
  const state = { status: 'STARTING', last_success_at: null, error: null,
    connector_id: config.id, feed_observation: null }
  const server = createServer((request, response) => {
    if (!['/healthz', '/readyz'].includes(request.url)) { response.writeHead(404).end(); return }
    const ready = request.url === '/healthz' || state.status === 'READY'
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify(state))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '0.0.0.0', resolve) })
  const stop = () => {
    controller.abort()
    // Bound shutdown even if a dependency ignores cancellation.
    setTimeout(() => process.exit(1), 45000).unref()
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    await supervise({ signal: controller.signal, state,
      log: record => console.info(JSON.stringify({ service: 'source-connector', ...record })),
      openSession: async () => {
        let store, producer
        const close = async () => {
          try { await producer?.disconnect() } catch { /* next session recreates producer */ }
          finally { store?.close() }
        }
        try {
          store = await openPostgresCursorStore({ pool, connectorId: config.id, initialCursor: config.initialCursor })
          producer = kafka.producer({ transactionalId: `source-connector-${config.id}`, idempotent: true, maxInFlightRequests: 1 })
          await producer.connect()
          const publish = createKafkaPublisher({ producer, rawTopic: config.rawTopic, receiptTopic: config.receiptTopic })
          const connector = createConnector({ feedClient, cursorStore: store, publish, limit: config.limit,
            onFeedValidated: observation => { state.feed_observation = observation } })
          return { pollOnce: () => connector.pollOnce(), close }
        } catch (error) {
          await close()
          if (error instanceof ConnectorError) throw error
          throw new ConnectorError('DEPENDENCY_UNAVAILABLE')
        }
      },
    })
  } finally {
    server.close()
    await pool.end()
  }
}
main().catch(error => {
  console.error(JSON.stringify({ service: 'source-connector', code: error instanceof ConnectorError ? error.code : 'STARTUP_FAILED' }))
  process.exitCode = 1
})
