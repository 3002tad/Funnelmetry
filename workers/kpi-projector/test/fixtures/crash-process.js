// Fault injection is confined to this test entry point, never production main.js.
import pg from 'pg'
import { createKpiRepository } from '../../src/repository.js'
import { createKafkaKpiRuntime } from '../../src/kafka-runtime.js'

const config = JSON.parse(process.env.KPI_FAULT_CONFIG)
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL,
  options: `-c search_path=${config.schema}` })
const repository = createKpiRepository({ pool })
const runtime = createKafkaKpiRuntime({ ...config, repository: {
  async project(input) {
    const result = await repository.project(input)
    if (config.crash) process.kill(process.pid, 'SIGKILL')
    return result
  },
} })
await runtime.start()
process.send('ready')
process.on('message', async message => {
  if (message !== 'stop') return
  await runtime.stop()
  await pool.end()
  process.disconnect()
})
