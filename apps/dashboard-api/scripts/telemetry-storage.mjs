// Operator-only migration/ingest. No HTTP mutation endpoint or Docker access.
import { readFile } from 'node:fs/promises'
import { resolveSecretFiles } from '../../../infra/docker/swarm-entrypoint.mjs'
import { normalizeTelemetry, telemetryScope, persistTelemetry } from '../src/lib/service-telemetry.js'
Object.assign(process.env, await resolveSecretFiles(process.env))
for (const key of Object.keys(process.env)) if (key.endsWith('_FILE') && process.env[key.slice(0,-5)]) delete process.env[key]
const { query, transaction, closeDatabase } = await import('../src/db.js')
try {
  const command = process.argv[2]
  if (command === 'migrate') {
    const sql = await readFile(new URL('../migrations/001_service_telemetry_samples.sql', import.meta.url), 'utf8')
    await transaction(async execute => { await execute(`SELECT pg_advisory_xact_lock(hashtext('service_telemetry_samples_v1'))`); await execute(sql) })
    console.log('Operational telemetry migration ready')
  } else if (command === 'ingest') {
    let text = ''
    for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 16384) throw Error('oversized_telemetry') }
    const sample = normalizeTelemetry(JSON.parse(text), telemetryScope())
    await transaction(execute => persistTelemetry(execute, sample, Number(process.env.DASHBOARD_TELEMETRY_RETENTION_DAYS ?? '7')))
    console.log('Operational telemetry sample stored')
  } else throw Error('Expected migrate or ingest')
} catch { console.error('Telemetry operation failed; check configuration, schema and snapshot'); process.exitCode=1 }
finally { await closeDatabase() }
