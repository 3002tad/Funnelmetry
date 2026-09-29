// Read-only operator diagnostic. Never publishes or updates the live cursor.
import pg from 'pg'
import {loadConfig} from './config.js'
import {createFeedClient} from './feed-client.js'
import {validateFeed,toRawMessage} from './connector.js'

const config=loadConfig()
const pool=new pg.Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:10000,query_timeout:10000})
try {
  const {rows:[saved]}=await pool.query('SELECT event_feed_id,after_seq FROM source_connector_cursors WHERE connector_id=$1',[config.id])
  if(!saved || saved.event_feed_id!==config.initialCursor.event_feed_id)throw Error('cursor unavailable')
  const {rows}=await pool.query("SELECT source_id,source_event_id FROM canonicalization_latest_outcomes WHERE status='unsupported' LIMIT 10001")
  if(rows.length>10000)throw Error('diagnostic limit')
  const wanted=new Set(rows.map(r=>JSON.stringify([r.source_id,r.source_event_id])))
  const found=new Set(),groups=new Map()
  const dryRunInput=process.argv.includes('--normalizer-input')
  const messages=[]
  const end=Number(saved.after_seq)
  let cursor={event_feed_id:saved.event_feed_id,after_seq:0}
  const client=createFeedClient({...config,waitSeconds:0})
  for(let page=0;page<20&&cursor.after_seq<end;page++){
    const response=await client.read({...cursor,limit:config.limit})
    const records=validateFeed(response,cursor,config.limit)
    if(!records.length)break
    for(const record of records){
      if(record.ingress_seq>end)break
      const id=JSON.stringify([record.source_id,record.event_id])
      if(wanted.has(id)&&!found.has(id)){
        if(dryRunInput){
          const {rows:[receipt]}=await pool.query('SELECT received_at,ingestion_id FROM ingress_accepted_receipts WHERE source_id=$1 AND event_id=$2',[record.source_id,record.event_id])
          if(!receipt)throw Error('missing receipt')
          const raw=toRawMessage(record,receipt.received_at.toISOString())
          if(JSON.parse(raw.value).ingestion_id!==receipt.ingestion_id)throw Error('identity mismatch')
          messages.push(raw)
        }
        found.add(id)
        const key=JSON.stringify([record.source_id,record.source_event_type,record.source_schema_version,record.producer])
        groups.set(key,(groups.get(key)||0)+1)
      }
      cursor={...cursor,after_seq:record.ingress_seq}
    }
  }
  if(dryRunInput){
    if(cursor.after_seq!==end||found.size!==wanted.size)throw Error('incomplete diagnostic')
    // Sensitive data: pipe directly to dry-normalize-stdin.mjs; never log to disk.
    console.log(JSON.stringify({schema:'unsupported-dry-run.v1',messages}))
  } else console.log(JSON.stringify({scope:'retained_feed_metadata',unsupported:rows.length,matched:found.size,
    complete_prefix_scan:cursor.after_seq===end,groups:[...groups].map(([key,count])=>({selectors:JSON.parse(key),count})),cursor_unchanged:true}))
}catch(error){
  const code=typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'DIAGNOSTIC_FAILED'
  console.error(JSON.stringify({status:'unverified',code}));process.exitCode=1
}finally{await pool.end()}
