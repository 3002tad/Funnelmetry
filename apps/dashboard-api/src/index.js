import { createApp } from './app.js'
import { config } from './config.js'
import { startEventPoller } from './lib/event-poller.js'
import { seedAdminUser } from './seed.js'
import { query, closeDatabase } from './db.js'
import { AccountSchemaError, prepareAccountStartup } from './lib/account-schema.js'

const app = createApp()

prepareAccountStartup({
  execute: query,
  seed: seedAdminUser,
  onRetry: attempt => console.error(`dashboard account startup unavailable (attempt ${attempt}/8)`),
}).then(() => {
  app.listen(config.port, () => {
    console.log(`dashboard-api listening on :${config.port}`)
    startEventPoller()
  })
}).catch(async error => {
  console.error(error instanceof AccountSchemaError ? error.message : 'dashboard startup failed; API was not started')
  process.exitCode = 1
  await closeDatabase()
})
