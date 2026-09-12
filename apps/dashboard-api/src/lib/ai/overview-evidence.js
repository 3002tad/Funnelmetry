import { hasPermission } from '../roles.js'
import { parseV2AnalyticsQuery } from '../v2-analytics-query.js'

// Called with server-authenticated identity, never a role/SQL supplied by the model.
// Recheck the current session and capability immediately before the read-only tool.
export async function assertEvidenceAccess(actor, execute) {
  if (!actor?.id || !Number.isInteger(actor.session_version)) throw Error('unauthorized')
  const [account] = await execute('SELECT role,is_active,session_version FROM dashboard_users WHERE id=$1', [actor.id])
  if (!account?.is_active || account.session_version !== actor.session_version) throw Error('session_expired')
  if (!hasPermission(account.role, 'chat.use') || !hasPermission(account.role, 'analytics.read')) throw Error('forbidden')
}

export async function loadOverviewEvidence({ actor, filters, execute, repository }) {
  await assertEvidenceAccess(actor, execute)
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)
    || Object.keys(filters).some(key => !['source_id', 'from', 'to'].includes(key))) throw Error('invalid_evidence_scope')
  const scope = parseV2AnalyticsQuery(filters)
  if (!scope.from || !scope.to || Date.parse(scope.to) - Date.parse(scope.from) > 90 * 86400000) throw Error('bounded_cohort_required')
  const result = await repository.getOverview(scope)
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw Error('evidence_too_large')
  return { evidence_id: 'overview-v2', origin: 'postgres_v2', retrieved_at: new Date().toISOString(),
    scope, data: result, limitations: ['Observed cohort, not a final conversion claim',
      'Not an official insight or recommendation', 'No business-state mutation is supported'] }
}
