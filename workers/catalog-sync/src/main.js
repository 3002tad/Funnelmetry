import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { catalogConfig, readCatalog, saveCatalog } from './catalog.js'

async function main() {
  const config = catalogConfig(process.env)
  const once = process.argv.includes('--once'), abort = new AbortController()
  process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort())
  do {
    const client = new pg.Client({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
      database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
      connectionTimeoutMillis: 10000 })
    // Never log errors from pg/fetch: they may contain credentials, URLs or data.
    client.on('error', () => {})
    try {
      await client.connect()
      const {rows} = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`catalog-sync:${config.sourceId}`])
      if (!rows[0].locked) throw Error('catalog_sync_busy')
      const products = await readCatalog(config, undefined, abort.signal)
      await saveCatalog(client, {sourceId:config.sourceId,snapshotId:randomUUID(),products})
      console.log(JSON.stringify({status:'catalog_reference_saved',count:products.length}))
    } catch {
      console.error(JSON.stringify({status:'catalog_sync_failed',previous_snapshot_preserved:true}))
      if (once) process.exitCode = 1
    } finally { await client.end().catch(() => {}) }
    if (once || abort.signal.aborted) break
    await delay(config.intervalMs, undefined, {signal:abort.signal}).catch(() => {})
  } while (!abort.signal.aborted)
}
main().catch(() => { console.error('catalog_configuration_or_runtime_failed'); process.exitCode=1 })
