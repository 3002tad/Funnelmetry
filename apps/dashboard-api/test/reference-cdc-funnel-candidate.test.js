import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {createReferenceCdcFunnelCandidateRepository} from
  '../src/lib/reference-cdc-funnel-candidate.js'
import {REFERENCE_CDC_PROFILE_V2 as profile} from
  '../src/lib/reference-cdc-profile-v2.js'

const now = new Date('2026-10-30T12:00:00Z')
const quality = {status:'CURRENT_STATE_READY',baseline_complete:true,
  historical_gap_status:'INCOMPLETE',verified_at:'2026-10-30T11:59:00Z',
  valid_until:'2026-10-30T12:01:00Z'}
const sourceId = 'medusa-reference'
const coverageEpochId = 'cdc11_order_epoch1'
const scope = {sourceId,from:null,to:null}

const binding = {source_instance_id:sourceId,coverage_epoch_id:coverageEpochId,
  activation_at:'2026-10-30T00:00:00Z',state:'ACTIVE',
  activated_at:'2026-10-30T10:00:00Z',updated_at:'2026-10-30T10:00:00Z',
  profile_id:profile.profile_id,profile_version:profile.profile_version,
  contract_id:profile.contract_id,metric_id:profile.metric_id,definition:profile}

function harness({snapshot = quality, after = quality, active = binding,
  bindingAfter = active,
  counts = {entrants:'2',item_added:'2',checkout_started:'1',
    currently_recorded_journeys:'1'}} = {}) {
  let countReads = 0
  const client = {release(){},async query(sql) {
    if (sql.startsWith('SELECT status,baseline_complete')) return {rows:snapshot ? [snapshot] : []}
    if (sql.startsWith('WITH events AS')) {countReads++;return {rows:[counts]}}
    return {rows:[]}
  }}
  let bindingReads = 0
  const pool = {async connect(){return client},async query(sql){
    if (sql.startsWith('SELECT b.source_instance_id')) {
      bindingReads++
      const row = bindingReads === 1 ? active : bindingAfter
      return {rows:row ? [row] : []}
    }
    return {rows:after ? [after] : []}
  }}
  const repository = createReferenceCdcFunnelCandidateRepository({pool,sourceId,
    coverageEpochId,activationAt:'2026-10-30T00:00:00Z',now:()=>now})
  return {repository,get countReads(){return countReads}}
}

test('reference candidate exposes a current-state reach, not a published conversion profile', async () => {
  const fixture = harness()
  const result = await fixture.repository.read(scope)
  assert.equal(result.status,'SHADOW_CURRENT_STATE')
  assert.equal(result.profile_status,'UNPUBLISHED')
  assert.equal(result.historical_gap_status,'INCOMPLETE')
  assert.equal(result.totals.entrants,2)
  assert.equal(result.totals.currently_recorded_journeys,1)
  assert.equal(result.totals.current_state_reach_rate,0.5)
  assert.equal('observed_converted' in result.totals,false)
  assert.equal(fixture.countReads,1)
  const retracted = await harness({counts:{entrants:'2',item_added:'2',
    checkout_started:'1',currently_recorded_journeys:'0'}}).repository.read(scope)
  assert.equal(retracted.totals.currently_recorded_journeys,0)
})

test('missing or changed quality lease suppresses all candidate numbers', async () => {
  const expired = harness({snapshot:{...quality,valid_until:'2026-10-30T11:59:59Z'}})
  assert.deepEqual(await expired.repository.read(scope),
    {status:'BLOCKED_BY_QUALITY',reason:'CDC_QUALITY_UNAVAILABLE'})
  assert.equal(expired.countReads,0)
  const changed = harness({after:{...quality,verified_at:'2026-10-30T12:00:01Z'}})
  assert.deepEqual(await changed.repository.read(scope),
    {status:'BLOCKED_BY_QUALITY',reason:'LEASE_CHANGED_DURING_READ'})
  const invalid = await harness({counts:{entrants:'1',item_added:'1',
    checkout_started:'0',currently_recorded_journeys:'1'}}).repository.read(scope)
  assert.equal(invalid.status,'BLOCKED_BY_QUALITY')
})

test('other source never receives reference candidate data', async () => {
  assert.equal(await harness().repository.read({...scope,sourceId:'another-source'}),null)
})

test('active reference profile is separate and fails closed on binding changes', async () => {
  const ready = await harness().repository.readActive(scope)
  assert.equal(ready.status,'CURRENT_STATE_READY')
  assert.equal(ready.profile_status,'ACTIVE')
  assert.equal(ready.profile_id,'reference-commerce-current-state')
  assert.equal(ready.metric_id,'metric.reference_currently_recorded_journey_count')
  assert.equal(ready.totals.currently_recorded_journeys,1)
  assert.equal((await harness({active:null}).repository.readActive(scope)).status,'BLOCKED_BY_QUALITY')
  const changed = await harness({bindingAfter:{...binding,state:'ROLLED_BACK',
    updated_at:'2026-10-30T12:00:01Z'}}).repository.readActive(scope)
  assert.equal(changed.reason,'REFERENCE_PROFILE_CHANGED_DURING_READ')
})

test('candidate route bounds source/query, suppresses blocked counts and disables caching', async () => {
  Object.assign(process.env,{PORT:'32000',CORS_ORIGIN_DASHBOARD:'http://localhost:5180',
    JWT_SECRET:'cdc-route-test-only',JWT_EXPIRES:'1h',
    DASHBOARD_ADMIN_EMAIL:'admin@example.test',DASHBOARD_ADMIN_PASSWORD:'test-only',
    POSTGRES_HOST:'unused',POSTGRES_PORT:'5432',POSTGRES_DB:'test',
    POSTGRES_USER:'test',POSTGRES_PASSWORD:'test'})
  const {createReferenceCdcFunnelCandidateRouter} =
    await import('../src/routes/reference-cdc-funnel-candidate.js')
  let result = {status:'SHADOW_CURRENT_STATE',totals:{currently_recorded_journeys:1}}
  let calls = 0
  const app = express()
  app.use(createReferenceCdcFunnelCandidateRouter({async read(input){
    calls++
    return input.sourceId === sourceId ? result : null
  },async readActive(input){return input.sourceId === sourceId ?
    {status:'CURRENT_STATE_READY',profile_status:'ACTIVE'} : null}},
  {activeEnabled:true}))
  const server = app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/v2/analytics/reference-cdc-funnel-candidate`
  try {
    const bad = await fetch(`${base}?source_id=x`)
    assert.equal(bad.status,400)
    assert.equal(calls,0)
    const missing = await fetch(`${base}?source_id=another-source`)
    assert.equal(missing.status,404)
    const ok = await fetch(`${base}?source_id=${sourceId}`)
    assert.equal(ok.status,200)
    assert.equal(ok.headers.get('cache-control'),'no-store')
    const active = await fetch(`${base.replace('reference-cdc-funnel-candidate',
      'reference-cdc-current-state')}?source_id=${sourceId}`)
    assert.equal(active.status,200)
    assert.equal((await active.json()).profile_status,'ACTIVE')
    result = {status:'BLOCKED_BY_QUALITY',reason:'CDC_QUALITY_UNAVAILABLE'}
    const blocked = await fetch(`${base}?source_id=${sourceId}`)
    assert.equal(blocked.status,503)
    assert.equal(blocked.headers.get('cache-control'),'no-store')
    assert.equal((await blocked.json()).totals,undefined)
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
