import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'

const statuses = ['PROVISIONAL', 'INSUFFICIENT_DATA', 'BLOCKED_BY_QUALITY', 'ERROR']
const reviewKinds=['NOTE','USEFUL','NEEDS_REVIEW','INACCURATE']
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value
export function createEvidenceV2Router(execute = query) {
  const router = Router()
  const auth = [requireAuth, requireLiveSession(execute), requireLivePermission('analytics.read', execute)]
  router.get('/api/v2/analytical-notes',...auth,async(req,res)=>{
    res.set('Cache-Control','no-store')
    const {kind,before}=req.query
    if(Object.keys(req.query).some(k=>!['kind','before'].includes(k)) || (kind!==undefined&&!reviewKinds.includes(kind)) || (before!==undefined&&(typeof before!=='string'||!uuid.test(before)))) return res.status(400).json({error:'invalid_notes_query'})
    try {
      const rows=await execute(`SELECT n.*,e.analysis_run_id,e.status AS evidence_status
        FROM analytical_evidence_notes n JOIN analytical_execution_evidence e ON e.evidence_id=n.evidence_id AND e.actor_id=n.actor_id
        WHERE n.actor_id=$1 AND ($2::text IS NULL OR n.review_kind=$2)
        AND ($3::uuid IS NULL OR (n.created_at,n.note_id)<(SELECT created_at,note_id FROM analytical_evidence_notes WHERE note_id=$3 AND actor_id=$1))
        ORDER BY n.created_at DESC,n.note_id DESC LIMIT 26`,[req.user.id,kind??null,before??null])
      const items=rows.slice(0,25);return res.json({items,next_before:rows.length>25?items.at(-1).note_id:null})
    } catch {return res.status(503).json({error:'notes_unavailable'})}
  })
  router.get('/api/v2/evidence/:id/notes', ...auth, async (req,res) => {
    res.set('Cache-Control','no-store')
    if (!uuid.test(req.params.id) || Object.keys(req.query).some(k=>k!=='before')
      || (req.query.before !== undefined && (typeof req.query.before !== 'string' || !uuid.test(req.query.before)))) return res.status(400).json({error:'invalid_notes_query'})
    try {
      const [owner] = await execute('SELECT evidence_id FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2',[req.params.id,req.user.id])
      if (!owner) return res.status(404).json({error:'evidence_not_found'})
      const rows = await execute(`SELECT note_id,evidence_id,actor_id,content,origin,created_at,review_kind FROM analytical_evidence_notes
        WHERE evidence_id=$1 AND actor_id=$2 AND ($3::uuid IS NULL OR (created_at,note_id) <
          (SELECT created_at,note_id FROM analytical_evidence_notes WHERE note_id=$3 AND evidence_id=$1 AND actor_id=$2))
        ORDER BY created_at DESC,note_id DESC LIMIT 26`,[req.params.id,req.user.id,req.query.before??null])
      const items=rows.slice(0,25)
      return res.json({items,next_before:rows.length>25?items.at(-1).note_id:null})
    } catch { return res.status(503).json({error:'notes_unavailable'}) }
  })
  router.post('/api/v2/evidence/:id/notes', ...auth, requireLivePermission('analytics.notes.write',execute), async (req,res) => {
    res.set('Cache-Control','no-store')
    const body=req.body
    if (!uuid.test(req.params.id) || Object.keys(req.query).length || !body || Array.isArray(body)
      || Object.keys(body).some(k=>!['note_id','content','review_kind'].includes(k)) || !reviewKinds.includes(body.review_kind??'NOTE') || typeof body.note_id!=='string' || !uuid.test(body.note_id)
      || typeof body.content!=='string' || !body.content.trim() || body.content.length>4000 || body.content.includes('\u0000')) return res.status(400).json({error:'invalid_note'})
    const content=body.content.trim()
    try {
      const [row]=await execute(`INSERT INTO analytical_evidence_notes(note_id,evidence_id,actor_id,content,review_kind)
        SELECT $1,evidence_id,actor_id,$4,$5 FROM analytical_execution_evidence WHERE evidence_id=$2 AND actor_id=$3
        ON CONFLICT(note_id) DO NOTHING RETURNING note_id,evidence_id,actor_id,content,origin,created_at,review_kind`,[body.note_id,req.params.id,req.user.id,content,body.review_kind??'NOTE'])
      if(row) return res.status(201).json(row)
      const [prior]=await execute(`SELECT note_id,evidence_id,actor_id,content,origin,created_at,review_kind FROM analytical_evidence_notes
        WHERE note_id=$1 AND evidence_id=$2 AND actor_id=$3`,[body.note_id,req.params.id,req.user.id])
      if(prior?.content===content && prior.review_kind===(body.review_kind??'NOTE')) return res.json(prior)
      return res.status(409).json({error:'note_not_saved'})
    } catch { return res.status(503).json({error:'notes_unavailable'}) }
  })
  // The owner boundary is enforced in SQL, not by hiding links in the UI.
  router.get('/api/v2/evidence', ...auth, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const { status, before, source_id, saved_from, saved_to } = req.query
    if (Object.keys(req.query).some(key => !['status', 'before','source_id','saved_from','saved_to'].includes(key))
      || (source_id !== undefined && (typeof source_id!=='string' || !source_id.trim() || source_id.length>200))
      || (saved_from !== undefined && !validDate(saved_from)) || (saved_to !== undefined && !validDate(saved_to))
      || (saved_from !== undefined && saved_to !== undefined && saved_from>=saved_to)
      || (status !== undefined && !statuses.includes(status))
      || (before !== undefined && (typeof before !== 'string' || !uuid.test(before)))) return res.status(400).json({ error: 'invalid_evidence_query' })
    try {
      const rows = await execute(`SELECT evidence_id,analysis_run_id,tool_call_id,status,created_at,
        document->'semantic_context'->>'tool_id' AS tool_id,
        document->'provenance'->'parameters' AS parameters
        FROM analytical_execution_evidence
        WHERE actor_id=$1 AND ($2::text IS NULL OR status=$2)
        AND ($4::text IS NULL OR document->'provenance'->'parameters'->>'source_id'=$4)
        AND ($5::timestamptz IS NULL OR created_at >= $5::timestamptz)
        AND ($6::timestamptz IS NULL OR created_at < $6::timestamptz)
        AND ($3::uuid IS NULL OR (created_at,evidence_id) < (
          SELECT created_at,evidence_id FROM analytical_execution_evidence WHERE evidence_id=$3 AND actor_id=$1))
        ORDER BY created_at DESC,evidence_id DESC LIMIT 26`, [req.user.id, status ?? null, before ?? null, source_id??null,
          saved_from?`${saved_from}T00:00:00Z`:null,saved_to?`${saved_to}T00:00:00Z`:null])
      const items = rows.slice(0, 25)
      return res.json({ items, next_before: rows.length > 25 ? items.at(-1).evidence_id : null,
        scope: 'own_completed_executions', lifecycle_available: false })
    } catch { return res.status(503).json({ error: 'evidence_unavailable' }) }
  })
  router.get('/api/v2/evidence/:id', ...auth, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!uuid.test(req.params.id) || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_evidence_id' })
    try {
      const [row] = await execute(`SELECT evidence_id,analysis_run_id,tool_call_id,status,created_at,document
        FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2`, [req.params.id, req.user.id])
      return row ? res.json(row) : res.status(404).json({ error: 'evidence_not_found' })
    } catch { return res.status(503).json({ error: 'evidence_unavailable' }) }
  })
  return router
}
