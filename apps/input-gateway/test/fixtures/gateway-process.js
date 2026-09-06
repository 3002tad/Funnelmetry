// Fault injection lives only in this test entry point.
import pg from 'pg'
import { createKafkaRuntime } from '../../src/kafka-runtime.js'
import { createPostgresReceiptCoordinator } from '../../src/postgres-receipt-coordinator.js'
import { createIngressHttpServer } from '../../src/http-server.js'
import { createIngressHandler } from '../../src/ingress-handler.js'

const config = JSON.parse(process.env.GATEWAY_TEST_CONFIG)
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${config.schema}` })
const coordinator = createPostgresReceiptCoordinator({ pool, instanceId: config.instanceId })
const runtime = createKafkaRuntime({ ...config,
  receiptCoordinator: config.killAfterCommit ? {
    ...coordinator,
    confirmReceipt: async () => {}, // Ensure this process cannot complete its own claim via replay.
    complete: async () => { process.kill(process.pid, 'SIGKILL') },
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
