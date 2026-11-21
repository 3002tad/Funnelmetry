import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readControllerObservation } from '../src/lib/controller-observation.js'
import { pathToFileURL } from 'node:url'

test('live controller uses fresh runtime evidence, preserves action results and fails closed', async () => {
 const dir=await mkdtemp(join(tmpdir(),'controller-live-')), file=join(dir,'snapshot.json'), now=Date.now()
 try {
  const config=JSON.parse(await readFile(new URL('../../../tools/swarm-controllers/config.example.json',import.meta.url),'utf8'))
  const state={version:1,pending:null,fingerprint:createHash('sha256').update(JSON.stringify(config)).digest('hex'),audit:[{kind:'RELEASE_EVIDENCE_ATTESTATION',at:now-1000,result:'MIGRATED_OBSERVATIONS_RESET'},{at:now-500,signal:'kafka_lag',reason:'SUSTAINED_BACKLOG',result:'ACCEPTED_AWAITING_READINESS',previousReplicas:1,desiredReplicas:2}]}
  const completion={scope:{stack:config.stack,service:config.service},checkedAt:new Date(now).toISOString(),enabled:true,running_replicas:1,image_matches:true}
  const env={DASHBOARD_CONTROLLER_LIVE_SNAPSHOT_PATH:file,DASHBOARD_SCALING_STACK:config.stack}
  const read=async(s=state,c=completion)=>{await writeFile(file,JSON.stringify({config,state:s,completion:c}));return readControllerObservation(env,now)}
  const active=await read();assert.equal(active.status,'ACTIVE');assert.equal(active.history.length,1);assert.equal(active.last_decision.result,'ACCEPTED_AWAITING_READINESS');assert.equal(active.last_decision.action,'SCALE_UP')
  assert.equal((await read(state,{...completion,checkedAt:new Date(now-100000).toISOString()})).status,'UNVERIFIED')
  assert.equal((await read({...state,audit:[{...state.audit[1],at:now-100000}]},{...completion,checkedAt:new Date(now-95000).toISOString()})).status,'STALE')
  assert.equal((await read(state,{...completion,enabled:false})).status,'STOPPED')
  assert.equal((await read(state,{...completion,image_matches:false})).status,'IMAGE_MISMATCH')
  assert.equal((await read({...state,pending:{}})).status,'NEEDS_REVIEW')
  assert.equal((await read({...state,fingerprint:'wrong'})).status,'UNVERIFIED')
 } finally {await rm(dir,{recursive:true,force:true})}
})

test('completed observe-only audit projects policy and historic series without secrets or live claims', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'controller-view-'))
 try {
  const config = JSON.parse(await readFile(new URL('../../../tools/swarm-controllers/config.example.json', import.meta.url), 'utf8'))
  const now = Date.now(), at = now - 120000
  const state = { version: 1, pending: null, fingerprint: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
   audit: [{ at, result: 'OBSERVE_ONLY', signal: 'kafka_lag', reason: 'REPLICA_SAFETY_UNVERIFIED', observedValue: '0', rawOffsetLag: '2', observedMemoryPercent: 9.64, previousReplicas: 1, desiredReplicas: 1, secret: 'must-not-return' }] }
  await writeFile(join(directory, 'config.json'), JSON.stringify(config))
  await writeFile(join(directory, 'state.json'), JSON.stringify(state))
  await writeFile(join(directory, 'status.json'), JSON.stringify({ scope: { stack: config.stack, service: config.service }, checkedAt: new Date(at + 1000).toISOString(), recovery: { persistedStatus: 'HEALTHY' } }))
  const env = { DASHBOARD_CONTROLLER_OBSERVATION_DIR: directory, DASHBOARD_SCALING_STACK: config.stack }
  const result = await readControllerObservation(env, now)
  assert.equal(result.status, 'COMPLETED_OBSERVATION'); assert.equal(result.stale, true)
  assert.equal(result.policy.min_replicas, 1); assert.equal(result.series[0].consumable_lag, '0')
  assert.equal(result.history[0].result, 'OBSERVE_ONLY'); assert.ok(!JSON.stringify(result).includes('must-not-return'))
  // Simulate the API image: this read-model module must load without tools/.
  const isolatedModule = join(directory, 'standalone-reader.mjs')
  await writeFile(isolatedModule, await readFile(new URL('../src/lib/controller-observation.js', import.meta.url), 'utf8'))
  const isolated = await import(pathToFileURL(isolatedModule).href)
  assert.equal((await isolated.readControllerObservation(env, now)).status, 'COMPLETED_OBSERVATION')
  for (const change of [{ fingerprint: 'wrong' }, { pending: {} }, { audit: [{ ...state.audit[0], result: 'APPLIED' }] }]) {
   await writeFile(join(directory, 'state.json'), JSON.stringify({ ...state, ...change }))
   assert.equal((await readControllerObservation(env, now)).status, 'UNVERIFIED')
  }
 } finally { await rm(directory, { recursive: true, force: true }) }
})
