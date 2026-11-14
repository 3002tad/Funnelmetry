// Explicit connection only; never loads deployment env or mutates pipeline data.
import pg from 'pg'
import { writeFile } from 'node:fs/promises'
import { createV2AnalyticsRepository } from '../src/lib/v2-analytics-repository.js'
import { parseV2AnalyticsQuery, parseProfileIdentity } from '../src/lib/v2-analytics-query.js'

if (process.argv.includes('--help')) {
  console.log('Set FUNNEL_DIAGNOSTIC_DATABASE_URL to a read-only/test DB connection.\nnode scripts/diagnose-funnel.mjs SOURCE FROM_UTC TO_EXCLUSIVE_UTC PROFILE VERSION OUTPUT.json\nRuns SELECT and EXPLAIN ANALYZE in a read-only transaction; queries execute twice. No data repair or schema change.')
  process.exit(0)
}
const [source, from, to, profileId, version, output] = process.argv.slice(2)
if (!output || !from || !to || !version || !process.env.FUNNEL_DIAGNOSTIC_DATABASE_URL) throw Error('Missing arguments or FUNNEL_DIAGNOSTIC_DATABASE_URL; see --help')
const scope = parseV2AnalyticsQuery({ source_id: source, from, to })
const identity = parseProfileIdentity(profileId, version)
const client = new pg.Client({ connectionString: process.env.FUNNEL_DIAGNOSTIC_DATABASE_URL, connectionTimeoutMillis: 10000 })
try {
  await client.connect()
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await client.query("SET LOCAL statement_timeout = '15s'")
  await client.query("SET LOCAL lock_timeout = '2s'")
  const plans = []
  // The repository issues concurrent health queries; serialize each query/plan
  // pair on this single transaction connection to keep evidence easy to inspect.
  let queue = Promise.resolve()
  const query = (sql, params) => {
    const task = queue.then(async () => {
      if (!/^\s*SELECT\b/i.test(sql)) throw Error('Diagnostic accepts repository SELECT statements only')
      const rows = (await client.query(sql, params)).rows
      const explained = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)
      plans.push({ sql, params, plan: explained.rows[0]['QUERY PLAN'] })
      return rows
    })
    queue = task.catch(() => {})
    return task
  }
  const repository = createV2AnalyticsRepository({ query })
  const funnel = await repository.getFunnel(scope, identity)
  const health = await repository.getDataHealth(scope)
  const coverage = await query(`SELECT COUNT(*)::bigint AS source_snapshot_count,
    MIN(coverage_end_at) AS earliest_coverage_end_at, MAX(coverage_end_at) AS latest_coverage_end_at
    FROM reconciliation_snapshots WHERE source_id = $1`, [scope.sourceId])
  await queue
  await client.query('ROLLBACK')
  await writeFile(output, JSON.stringify({ capturedAt: new Date().toISOString(), scope, identity,
    readOnly: true, note: 'EXPLAIN ANALYZE executes each read again; timings may benefit from warmed buffers. Not end-to-end latency.',
    profileFound: Boolean(funnel), reconciliation: health.reconciliation,
    sourceSnapshotCoverage: coverage[0], plans }, null, 2))
  console.log(`Diagnostic written: ${output}`)
} catch (error) {
  // Avoid echoing a connection URI or raw driver error with sensitive values.
  console.error(`Diagnostic failed (${error.code || 'ERROR'}); no success report produced.`)
  process.exitCode = 1
} finally { await client.end().catch(() => {}) }
