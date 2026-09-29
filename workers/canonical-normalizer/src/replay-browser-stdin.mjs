// Bounded operator replay. Default dry-run; never changes connector cursor.
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {Kafka,logLevel} from 'kafkajs'
import {createNormalizer} from './normalizer.js'
import {loadMappingRegistry} from './mapping-loader.js'
let producer,transaction
try{
  const chunks=[];let size=0
  for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error();chunks.push(chunk)}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''))
  if(input.schema!=='unsupported-dry-run.v1'||input.messages?.length!==41)throw Error()
  const normalize=createNormalizer({registry:await loadMappingRegistry(process.env.CANONICAL_NORMALIZER_MAPPING_CONFIG_PATH)})
  const ids=new Set(),manifest=[]
  for(const message of input.messages){
    const result=normalize.normalize(message)
    if(result.status!=='normalized'||result.canonicalEvent.source_id!=='medusa-reference'||result.outcome.mapping_version!=='medusa-browser-schema1-catalog-v2')throw Error()
    if(ids.has(result.canonicalEvent.canonical_event_id))throw Error()
    ids.add(result.canonicalEvent.canonical_event_id)
    manifest.push({source_event_id:result.outcome.source_event_id,canonical_event_id:result.canonicalEvent.canonical_event_id,raw_record_id:result.outcome.raw_record_id})
  }
  const fingerprint=createHash('sha256').update(JSON.stringify(input.messages)).digest('hex')
  if(!process.env.REPLAY_CONFIRM_HASH){console.log(JSON.stringify({mode:'dry_run',count:41,fingerprint}));}
  else{
    if(process.env.REPLAY_CONFIRM_HASH!==fingerprint)throw Error()
    const audit={fingerprint,manifest,started_at:new Date().toISOString(),state:'prepared'}
    const auditPath=`/tmp/browser-replay-${fingerprint}.json`
    await writeFile(auditPath,JSON.stringify(audit),{flag:'wx',mode:0o600})
    producer=new Kafka({clientId:'operator-browser-replay',brokers:process.env.KAFKA_BOOTSTRAP_SERVERS.split(','),logLevel:logLevel.NOTHING}).producer({transactionalId:`browser-replay-${fingerprint.slice(0,32)}`,idempotent:true,maxInFlightRequests:1})
    await producer.connect();transaction=await producer.transaction()
    await transaction.send({topic:process.env.KAFKA_TOPIC_RAW,acks:-1,messages:input.messages.map(({key,value})=>({key,value}))})
    await transaction.commit();transaction=null
    await writeFile(auditPath,JSON.stringify({...audit,state:'broker_committed',committed_at:new Date().toISOString()}),{mode:0o600})
    console.log(JSON.stringify({state:'broker_committed',count:41,fingerprint,auditPath,downstream_verified:false}))
  }
}catch{
  if(transaction)await transaction.abort().catch(()=>{})
  console.error(JSON.stringify({error:'REPLAY_STOPPED_INSPECT_AUDIT_BEFORE_RETRY'}));process.exitCode=1
}finally{if(producer)await producer.disconnect().catch(()=>{})}
