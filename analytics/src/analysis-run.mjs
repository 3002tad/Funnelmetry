import { randomUUID } from 'node:crypto'
import { executeStagingMetricSummary } from './semantic-registry.mjs'
import { rankOrders } from './order-ranking.mjs'
import { assertEvidenceAccess } from '../../apps/dashboard-api/src/lib/ai/overview-evidence.js'

// Server-only orchestration. actor must come from verified authentication middleware.
// authQuery implements the existing dashboard query interface (returns row array).
export function createStagingAnalysisRunner({ pool, authQuery, statementTimeoutMs }) {
  if (typeof authQuery !== 'function') throw Error('Live authorization query required')
  async function authorize(actor) { await assertEvidenceAccess(actor, authQuery) }
  return {
    async run({ actor, request }) {
      actor = { id: actor?.id, session_version: actor?.session_version }
      // Freeze the request boundary against caller mutation while awaiting DB I/O.
      const input = structuredClone(request)
      await authorize(actor)
      const executeTool = input?.tool_id === 'tool.order_ranking' ? rankOrders : executeStagingMetricSummary
      const outcome = await executeTool({ pool, request: input, statementTimeoutMs })
      await authorize(actor)
      const ids = { evidence_id: randomUUID(), analysis_run_id: randomUUID(), tool_call_id: randomUUID() }
      // Store only validated execution output/provenance, never raw prompt or request.
      // Invalid requests may contain secrets/arbitrary fields; they are not persisted.
      const evidence = { ...ids, ...outcome, evidence_contract_version: 'staging-1.0.0',
        official: false, reproducibility: 'RESULT_SNAPSHOT_ONLY_NO_DURABLE_DATA_SNAPSHOT' }
      try {
        await pool.query(`INSERT INTO analytical_execution_evidence
          (evidence_id,analysis_run_id,tool_call_id,actor_id,status,document)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [ids.evidence_id, ids.analysis_run_id, ids.tool_call_id, actor.id, outcome.status, JSON.stringify(evidence)])
      } catch {
        // Never present unpersisted computed values as durable evidence.
        return { status: 'ERROR', code: 'EVIDENCE_PERSIST_FAILED', result: null }
      }
      await authorize(actor) // Do not disclose if access was revoked while persisting.
      return evidence
    },
    async get({ actor, evidenceId }) {
      actor = { id: actor?.id, session_version: actor?.session_version }
      await authorize(actor)
      if (typeof evidenceId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(evidenceId)) throw Error('invalid_evidence_id')
      const { rows: [row] } = await pool.query(`SELECT document FROM analytical_execution_evidence
        WHERE evidence_id=$1 AND actor_id=$2`, [evidenceId, actor.id])
      await authorize(actor)
      return row?.document ?? null
    },
  }
}
