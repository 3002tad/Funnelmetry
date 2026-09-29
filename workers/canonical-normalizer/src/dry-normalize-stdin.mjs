// Operator-only: no Kafka clients, writes, or raw output. Input arrives via stdin.
import {createNormalizer} from './normalizer.js'
import {loadMappingRegistry} from './mapping-loader.js'
let bytes=0
const chunks=[]
try {
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>32*1024*1024)throw Error('input limit');chunks.push(chunk)}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''))
  if(input.schema!=='unsupported-dry-run.v1'||!Array.isArray(input.messages)||input.messages.length>10000)throw Error('input shape')
  const registry=await loadMappingRegistry(process.env.CANONICAL_NORMALIZER_MAPPING_CONFIG_PATH)
  const normalizer=createNormalizer({registry,now:()=> '2026-09-29T00:00:00.000Z'})
  const groups=new Map();let stable=true
  for(const message of input.messages){
    const result=normalizer.normalize(message),again=normalizer.normalize(message)
    if(result.status==='normalized')stable=stable&&result.canonicalEvent.canonical_event_id===again.canonicalEvent?.canonical_event_id
    const key=JSON.stringify([result.status,result.outcome.mapping_version,result.outcome.reason_code??null,result.canonicalEvent?.event_type??null])
    groups.set(key,(groups.get(key)||0)+1)
  }
  console.log(JSON.stringify({mode:'dry_run',total:input.messages.length,stable_canonical_ids:stable,
    groups:[...groups].map(([key,count])=>({result:JSON.parse(key),count})),writes:false}))
}catch{console.error(JSON.stringify({mode:'dry_run',error:'NORMALIZATION_DIAGNOSTIC_FAILED',writes:false}));process.exitCode=1}
