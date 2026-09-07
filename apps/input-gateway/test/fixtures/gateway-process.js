// Fault injection lives only in this test entry point.
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { createKafkaRuntime } from '../../src/kafka-runtime.js'
import { createPostgresReceiptCoordinator } from '../../src/postgres-receipt-coordinator.js'
import { createIngressHttpServer } from '../../src/http-server.js'
import { createIngressHandler } from '../../src/ingress-handler.js'

const config = JSON.parse(process.env.GATEWAY_TEST_CONFIG)
const pool = new pg.Pool({ connectionString: config.databaseUrl ?? process.env.TEST_DATABASE_URL,
  ...(config.freshDbConnections ? { maxUses: 1, connectionTimeoutMillis: 1000 } : {}),
  options: `-c search_path=${config.schema}` })
const coordinator = createPostgresReceiptCoordinator({ pool, instanceId: config.instanceId })
let kafka
if (config.killBeforeCommit) {
  kafka = new Kafka({ brokers: config.brokers, clientId: config.clientId, logLevel: logLevel.ERROR })
  const createProducer = kafka.producer.bind(kafka)
  kafka.producer = options => {
    const producer = createProducer(options)
    const transaction = producer.transaction.bind(producer)
    producer.transaction = async () => ({
      ...await transaction(),
      commit: async () => { process.kill(process.pid, 'SIGKILL') },
    })
    return producer
  }
}
const runtime = createKafkaRuntime({ ...config,
  kafka,
  receiptCoordinator: config.killAfterCommit ? {
    ...coordinator,
    confirmReceipt: async () => {}, // Ensure this process cannot complete its own claim via replay.
    complete: async () => { process.kill(process.pid, 'SIGKILL') },
  } : config.killBeforeSend ? {
    ...coordinator,
    authorizeSend: async () => { process.kill(process.pid, 'SIGKILL') },
  } : coordinator,
})
const server = createIngressHttpServer({ isReady: runtime.isReady,
  handleIngress: createIngressHandler({ durableIngress: runtime.durableIngress,
    browserKeys: { test: { source_id: 'test-source', secret: 'test-secret' } } }),
})
await runtime.start()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
process.send({ port: server.address().port })
process.on('message', async message => {
  if (message === 'stop') {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await runtime.stop()
    await pool.end()
    process.disconnect()
  }
})
