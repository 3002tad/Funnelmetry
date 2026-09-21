import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertEvidenceAccess } from './overview-evidence.js'

export const eventCountMetadata = Object.freeze({
  id: 'event_counts', version: '1.0.0',
  description: 'Count stored canonical event rows grouped by event_type using Polars; NOT customers, orders, revenue or conversion.',
  asset: 'canonical_events', grain: 'stored canonical event row', primary_keys: ['canonical_event_id'],
  dimensions: ['event_type'], measure: { name: 'event_count', formula: 'COUNT(*)', unit: 'rows' },
  time_basis: 'occurred_at; includes source and fallback event times',
  filters: ['source_id', 'from inclusive', 'to exclusive'],
  max_days: 90, max_rows: 10000, permissions: ['chat.use', 'analytics.read'],
  limitations: ['Mapping versions may produce multiple rows for a source event.',
    'Does not prove source delivery completeness or payment success.', 'No joins; no raw payload or identity export.'],
})

export function runPolars(snapshot, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', [fileURLToPath(new URL('./event-count.py', import.meta.url))], {
      timeout: 10000, maxBuffer: 65536, signal,
      // Do not pass DB credentials, Qwen keys or application environment to Python.
      env: { PATH: process.env.PATH, POLARS_MAX_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
    }, (error, stdout) => {
      if (error) return reject(Error('polars_unavailable'))
      try { resolve(JSON.parse(stdout)) } catch { reject(Error('invalid_tool_result')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(snapshot))
  })
}

export async function loadEventCounts({ actor, scope, execute, readOnly, signal, runner = runPolars }) {
  await assertEvidenceAccess(actor, execute)
  if (signal?.aborted) throw Error('ai_cancelled')
  if (!scope.from || !scope.to || Date.parse(scope.to) <= Date.parse(scope.from)
    || Date.parse(scope.to) - Date.parse(scope.from) > 90 * 86400000) throw Error('invalid_tool_scope')
  const rows = await readOnly(async query => query(
    `SELECT event_type FROM canonical_events
      WHERE source_id=$1 AND occurred_at >= $2 AND occurred_at < $3
      ORDER BY occurred_at, canonical_event_id LIMIT 10001`, [scope.sourceId, scope.from, scope.to]))
  if (rows.length > 10000) throw Error('tool_row_budget_exceeded')
  const types = rows.map(row => row.event_type)
  if (types.some(type => typeof type !== 'string' || type.length > 128 || !/^[a-z][a-z0-9_.]+$/.test(type))) throw Error('invalid_tool_input')
  if (signal?.aborted) throw Error('ai_cancelled')
  const result = await runner({ event_types: types }, signal)
  // Independently check every group; never trust arbitrary subprocess output.
  const expected = new Map()
  for (const type of types) expected.set(type, (expected.get(type) ?? 0) + 1)
  if (!Array.isArray(result.counts) || result.counts.length !== expected.size
    || result.total_events !== types.length) throw Error('invalid_tool_result')
  for (const item of result.counts) {
    if (!expected.has(item.event_type) || expected.get(item.event_type) !== item.count) throw Error('invalid_tool_result')
    expected.delete(item.event_type)
  }
  return { evidence_id: 'event-counts-v1', origin: 'postgres_v2+polars', retrieved_at: new Date().toISOString(),
    scope, tool_version: eventCountMetadata.version, data: {
      total_events: types.length, counts: result.counts.map(({ event_type, count }) => ({ event_type, count })),
    }, limitations: eventCountMetadata.limitations }
}
