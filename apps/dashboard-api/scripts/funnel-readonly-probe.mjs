// Read-only VPS diagnostic over existing SSH. No credential file access.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createV2AnalyticsRepository } from '../src/lib/v2-analytics-repository.js'

const container = process.argv[2]
if (!/^funnelmetry_vps_live_postgres\.1\.[a-z0-9]+$/.test(container || '')) throw Error('Expected inspected PostgreSQL container name')
const scope = { sourceId: 'medusa-reference', from: '2026-10-16T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }
const statements = []
const repository = createV2AnalyticsRepository({ query: async (sql, params) => {
  statements.push({ sql, params })
  if (sql.includes('FROM funnel_profiles p')) return [{ funnel_profile_id: 'commerce-conversion', profile_version: '2.0.0', conversion_horizon_seconds: null, late_arrival_grace_seconds: null }]
  return []
} })
await repository.getFunnel(scope, { profileId: 'commerce-conversion', version: '2.0.0' })
await repository.getDataHealth(scope)
const literal = v => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`
const sql = [
  '\\pset pager off', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
  "SET LOCAL statement_timeout='15s';", "SET LOCAL lock_timeout='2s';",
  "SELECT json_build_object('checked_at',now(),'database',current_database(),'read_only',current_setting('transaction_read_only'));",
  "SELECT json_build_object('snapshots_all_sources',count(*),'snapshot_sources',count(DISTINCT source_id)) FROM reconciliation_snapshots;",
  `SELECT json_build_object('source',${literal(scope.sourceId)},'snapshots_all_time',count(*),'earliest_coverage_end',min(coverage_end_at),'latest_coverage_end',max(coverage_end_at),'snapshots_selected_window',count(*) FILTER (WHERE coverage_end_at >= ${literal(scope.from)}::timestamptz AND coverage_end_at < ${literal(scope.to)}::timestamptz)) FROM reconciliation_snapshots WHERE source_id=${literal(scope.sourceId)};`,
  "SELECT json_build_object('comparisons_all_sources',count(*)) FROM reconciliation_comparisons;",
  "SELECT json_build_object('profile',p.funnel_profile_id,'version',p.profile_version,'horizon',p.conversion_horizon_seconds,'grace',p.late_arrival_grace_seconds,'disabled_at',a.disabled_at) FROM funnel_profiles p JOIN funnel_profile_activations a USING(funnel_profile_id,profile_version) WHERE a.source_id='medusa-reference';",
  ...statements.flatMap(({sql,params},i) => {
    const bound = sql.replace(/\$(\d+)\b/g, (_,n) => literal(params[Number(n)-1]))
    return [`SELECT 'QUERY_${i+1}';`, ...(i < 3 || sql.includes('AS snapshots') ? [bound + ';'] : []), `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${bound};`]
  }),
  'ROLLBACK;',
].join('\n')
const out = new URL('../../../docs/current/evidence/funnel-db-2026-11-14/', import.meta.url)
await mkdir(out,{recursive:true})
await writeFile(new URL('probe.sql',out),sql)
await writeFile(new URL('query-map.json',out),JSON.stringify({scope,statements},null,2))
const result = execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','myvps',`docker exec -i ${container} psql -X -qAt -v ON_ERROR_STOP=1 -U funnelmetry -d funnelmetry_handoff`], {input:sql,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024})
await writeFile(new URL('probe-output.txt',out),result)
console.log(result.split('\n').filter(l=>l.startsWith('{') || l.startsWith('QUERY_')).join('\n'))
