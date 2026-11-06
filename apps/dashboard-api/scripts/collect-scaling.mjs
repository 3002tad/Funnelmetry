// Separate read-only collector; the HTTP API does not get Docker access.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { KAFKA_PROBE, summarizeOffsets } from '../../../tools/autoscaler/observe.mjs'
const exec = promisify(execFile)
const [stack, output] = process.argv.slice(2)
if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(stack || '') || !output) throw Error('Usage: node collect-scaling.mjs STACK OUTPUT_FILE')
const service = `${stack}_canonical-normalizer`
const run = async args => (await exec('docker', args, { timeout: 8000, maxBuffer: 65536, windowsHide: true })).stdout.trim()
const desired = Number(await run(['service', 'inspect', service, '--format', '{{.Spec.Mode.Replicated.Replicas}}']))
const tasks = (await run(['service', 'ps', service, '--filter', 'desired-state=running', '--format', '{{.CurrentState}}'])).split('\n').filter(row => row.startsWith('Running '))
const ids = (await run(['ps', '--filter', `label=com.docker.swarm.service.name=${service}`, '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean)
if (ids.length > 128 || ids.some(id => !/^[a-f0-9]{12,64}$/.test(id)) || !Number.isSafeInteger(desired) || desired < 0) throw Error('Invalid observation')
const nodes = (await run(['node', 'ls', '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean)
let memory = null
if (nodes.length === 1 && ids.length === tasks.length && ids.length) {
  const values = (await run(['stats', '--no-stream', '--format', '{{.MemPerc}}', ...ids])).split(/\s+/)
  if (values.length === ids.length && values.every(value => /^(?:\d{1,2}(?:\.\d+)?|100(?:\.0+)?)%$/.test(value))) memory = Math.max(...values.map(value => Number(value.slice(0, -1))))
}
const result = { stack, service: 'canonical-normalizer', observed_at: new Date().toISOString(), desired_replicas: desired, running_replicas: tasks.length, memory_percent_max: memory }
const workerNames = ['canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer', 'traffic-source-writer', 'journey-processor', 'funnel-processor', 'kpi-projector']
const healthCode = `const worker=process.argv[1];(async()=>{try{const r=await fetch('http://127.0.0.1:32110/readyz',{signal:AbortSignal.timeout(2500)});const text=await r.text();if(text.length>4096)throw Error();const d=JSON.parse(text);if(d.worker!==worker||d.scope!=='local_kafka_runtime_flag'||!['READY','DEGRADED','STARTING','STOPPING'].includes(d.status)||d.ready!==(d.status==='READY')||(r.status===200)!==d.ready)throw Error();console.log(JSON.stringify({worker,status:d.status,ready:d.ready,checked_at:new Date().toISOString(),scope:d.scope}))}catch{console.log(JSON.stringify({worker,status:'UNVERIFIED',ready:null,checked_at:new Date().toISOString(),scope:'local_kafka_runtime_flag'}))}})()`
result.workers = await Promise.all(workerNames.map(async worker => {
  const unknown = { worker, status: 'UNVERIFIED', ready: null, checked_at: new Date().toISOString(), scope: 'local_kafka_runtime_flag' }
  try {
    const containers = (await run(['ps', '--filter', `label=com.docker.swarm.service.name=${stack}_${worker}`, '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean)
    // A single-task endpoint must not imply all replicas are ready.
    const taskCount = Number(await run(['service', 'inspect', `${stack}_${worker}`, '--format', '{{.Spec.Mode.Replicated.Replicas}}']))
    if (containers.length !== 1 || taskCount !== 1 || !/^[a-f0-9]{12,64}$/.test(containers[0])) return unknown
    return JSON.parse(await run(['exec', containers[0], 'node', '-e', healthCode, worker]))
  } catch { return unknown }
}))
result.kafka = { status: 'UNVERIFIED', raw_offset_lag: null, consumable_lag: null, partition_count: null, control_only_partitions: null, reason: 'KAFKA_PROBE_UNAVAILABLE' }
if (ids.length) {
  try {
    const identityCode = "import{loadConfig}from'/workspace/workers/canonical-normalizer/src/config.js';const c=loadConfig();console.log(JSON.stringify({group_id:c.consumerGroupId,topic:c.rawTopic}))"
    const identity = JSON.parse(await run(['exec', ids[0], 'node', '--input-type=module', '-e', identityCode]))
    if (![identity.group_id, identity.topic].every(value => typeof value === 'string' && /^[\w.-]{1,200}$/.test(value))) throw Error('invalid_scope')
    const probe = JSON.parse((await exec('docker', ['exec', ids[0], 'node', '--input-type=module', '-e', KAFKA_PROBE, identity.topic, identity.group_id], { timeout: 25000, maxBuffer: 65536, windowsHide: true })).stdout)
    if (probe.probeFailure) throw Error('probe_failed')
    const summary = summarizeOffsets(probe.ends, probe.commits, probe.tails)
    const known = summary.rawOffsetLag !== null
    const consumable = known && probe.stable === true ? summary.lag : null
    result.kafka = { ...identity, status: known ? 'OBSERVED' : 'UNVERIFIED',
      raw_offset_lag: summary.rawOffsetLag, consumable_lag: consumable,
      partition_count: summary.partitions, control_only_partitions: consumable === null ? null : summary.controlOnlyPartitions,
      reason: consumable === null ? 'CONSUMABLE_LAG_UNVERIFIED' : summary.controlOnlyPartitions > 0 ? 'VERIFIED_CONTROL_TAIL_EXCLUDED' : 'RAW_OFFSETS_RETAINED_CONSERVATIVELY' }
  } catch {}
}
result.observed_at = new Date().toISOString()
if (output === '--stdout') {
  console.log(JSON.stringify(result))
} else {
const temporary = `${output}.${randomUUID()}.tmp`
await writeFile(temporary, JSON.stringify(result), { mode: 0o600, flag: 'wx' })
await rename(temporary, output)
console.log('Scaling telemetry snapshot updated (read-only).')
}
