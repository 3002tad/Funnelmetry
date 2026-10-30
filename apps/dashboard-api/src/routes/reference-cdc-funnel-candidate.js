import { Router } from 'express'
import { analyticalPool } from '../db.js'
import { config } from '../config.js'
import { createReferenceCdcFunnelCandidateRepository } from
  '../lib/reference-cdc-funnel-candidate.js'
import { ANALYTICS_V2_PATHS } from '../lib/v2-analytics-contract.js'
import { parseV2AnalyticsQuery } from '../lib/v2-analytics-query.js'

export function createReferenceCdcFunnelCandidateRouter(repository =
  createReferenceCdcFunnelCandidateRepository({pool:analyticalPool,
    ...config.cdcReferenceCandidate}), {activeEnabled = false} = {}) {
  const router = Router()
  const handle = reader => async (req,res) => {
    res.set('Cache-Control','no-store')
    let scope
    try { scope = parseV2AnalyticsQuery(req.query) }
    catch (error) { return res.status(400).json({error:'invalid_query',message:error.message}) }
    try {
      const result = await reader(scope)
      if (!result) return res.status(404).json({error:'cdc_reference_source_not_found'})
      if (result.status === 'BLOCKED_BY_QUALITY') return res.status(503).json(result)
      return res.json(result)
    } catch (error) {
      console.error('GET CDC reference current state',error.message)
      return res.status(500).json({error:'query_failed'})
    }
  }
  router.get(ANALYTICS_V2_PATHS.cdcReferenceCandidate,handle(scope=>repository.read(scope)))
  if (activeEnabled) router.get(ANALYTICS_V2_PATHS.cdcReferenceCurrentState,
    handle(scope=>repository.readActive(scope)))
  return router
}
