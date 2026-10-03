import {Router} from 'express'
import {query,readOnlyTransaction} from '../db.js'
import {requireAuth} from '../middleware/auth.js'
import {requireLiveSession} from '../middleware/live-session.js'
import {requireLivePermission} from '../middleware/live-permission.js'

const statuses=new Set(['PROVISIONAL','INSUFFICIENT_DATA','BLOCKED_BY_QUALITY','ERROR'])
const tools=new Set(['tool.metric_summary','tool.order_ranking','tool.product_value_ranking'])
const codes=new Set(['INVALID_TOOL_REQUEST','UNVERIFIED_CATALOG','UNVERIFIED_CATALOG_OR_BINDING','UNVERIFIED_RANKING_CATALOG',
  'UNVERIFIED_PRODUCT_CATALOG','UNVERIFIED_PRODUCT_CATALOG_OR_BINDING','ORDER_RANKING_EXECUTION_FAILED',
  'PRODUCT_RANKING_EXECUTION_FAILED','RESULT_BUDGET_EXCEEDED','EVIDENCE_PERSIST_FAILED'])
export function createRunDiagnosticsRouter({execute=query,readOnly=readOnlyTransaction}={}){
  const router=Router()
  router.get('/api/v2/admin/run-diagnostics',requireAuth,requireLiveSession(execute),requireLivePermission('pipeline.monitor',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    const status=req.query.status
    if(Object.keys(req.query).some(k=>k!=='status')||(status!==undefined&&(!statuses.has(status))))return res.status(400).json({error:'invalid_diagnostics_query'})
    try{
      const items=await readOnly(async tx=>{
        const rows=await tx(`SELECT analysis_run_id,tool_call_id,created_at,status,
          document->'semantic_context'->>'tool_id' AS tool_id,
          document->>'code' AS code
          FROM analytical_execution_evidence
          WHERE created_at >= now()-interval '30 days' AND ($1::text IS NULL OR status=$1)
          ORDER BY created_at DESC,analysis_run_id DESC LIMIT 50`,[status??null])
        return rows.map(r=>({analysis_run_id:r.analysis_run_id,tool_call_id:r.tool_call_id,created_at:r.created_at,
          status:statuses.has(r.status)?r.status:'UNVERIFIED',tool_id:tools.has(r.tool_id)?r.tool_id:null,
          code:r.code?(codes.has(r.code)?r.code:'UNCLASSIFIED_ERROR'):null}))
      })
      return requireLiveSession(execute)(req,res,()=>requireLivePermission('pipeline.monitor',execute)(req,res,()=>res.json({items,
        checked_at:new Date().toISOString(),window_days:30,limit:50,scope:'PERSISTED_COMPLETED_EXECUTIONS_ONLY',read_only:true})))
    }catch{return res.status(503).json({error:'run_diagnostics_unavailable'})}
  })
  return router
}
