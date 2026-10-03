import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'

export function inspectMappingDocument(document) {
  const token=v=>typeof v==='string'&&/^[A-Za-z0-9*][A-Za-z0-9._:*\-]{0,191}$/.test(v)
  if(document?.schema_version!=='canonical-mappings.v1'||!token(document.source_id)
    ||!Array.isArray(document.mappings)||!document.mappings.length||document.mappings.length>500) throw Error('invalid_mapping_document')
  const selectors=new Set()
  const mappings=document.mappings.map(row=>{
    const keys=['source_event_type','source_schema_version','event_type','event_class','mapping_version']
    if(!row||keys.some(k=>!token(row[k]))||(row.payload_contract!==undefined&&!token(row.payload_contract))) throw Error('invalid_mapping_entry')
    const selector=JSON.stringify([row.source_event_type,row.source_schema_version])
    if(selectors.has(selector))throw Error('duplicate_mapping_selector')
    selectors.add(selector)
    return {...Object.fromEntries(keys.map(k=>[k,row[k]])),...(row.payload_contract?{payload_contract:row.payload_contract}:{})}
  })
  return {source_id:document.source_id,schema_version:document.schema_version,mappings}
}
export async function loadMappingInspection(){
  // Fixed allowlisted artifact, never a user-controlled path or uploaded document.
  const buffer=await readFile(new URL('../../../../integrations/medusa/canonical-mappings.v1.json',import.meta.url))
  if(buffer.length>262144)throw Error('mapping_document_too_large')
  return {...inspectMappingDocument(JSON.parse(buffer.toString('utf8'))),
    artifact:'integrations/medusa/canonical-mappings.v1.json',sha256:createHash('sha256').update(buffer).digest('hex'),
    checked_at:new Date().toISOString(),scope:'SOURCE_NATIVE_ARTIFACT_ONLY',runtime_status:'UNVERIFIED',read_only:true}
}
