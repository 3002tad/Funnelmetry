import test from 'node:test'
import assert from 'node:assert/strict'
import {assessShadowOrderJourney,createShadowOrderJourneyReadPath}
  from '../src/shadow-read-path.js'

const now = new Date('2026-10-29T12:00:00Z')
const quality = {status:'CURRENT_STATE_READY',baseline_complete:true,
  historical_gap_status:'INCOMPLETE',valid_until:'2026-10-29T12:01:00Z'}
const state = {source_instance_id:'medusa-reference-shadow',
  coverage_epoch_id:'epoch2',order_id:'order_1',cart_id:'cart_1',active:true,
  last_record_id:'state_2',last_topic_offset:'19'}
const on = {record_id:'on_1',cart_id:'cart_1',observed_state_at:'2026-10-29T11:59:00Z'}
const transition = {record_id:'on_1',active:true}
const journey = {journey_id:'journey_1',link_confidence:'STRONG'}
const checkout = {canonical_event_id:'checkout_1'}
const assess = overrides => assessShadowOrderJourney({quality,state,lastOn:on,
  lastTransition:transition,journey,checkout,now,...overrides})

test('baseline cannot produce a new terminal, while a post-activation ON can bind', () => {
  assert.equal(assess({lastOn:null,lastTransition:null}).status,'BASELINE_ONLY')
  const bound = assess({})
  assert.equal(bound.status,'BOUND_SHADOW')
  assert.equal(bound.journey_id,'journey_1')
  assert.equal(bound.on_record_id,'on_1')
  assert.equal(bound.historical_gap_status,'INCOMPLETE')
})

test('OFF retracts a prior ON; correction cannot move the terminal to another cart', () => {
  assert.equal(assess({state:{...state,active:false},
    lastTransition:{record_id:'off_1',active:false}}).status,'RETRACTED_SHADOW')
  assert.equal(assess({state:{...state,cart_id:'cart_2'}}).status,
    'CORRECTED_CART_UNVERIFIED')
  assert.equal(assess({lastTransition:{record_id:'off_1',active:false}}).status,
    'BLOCKED_BY_QUALITY')
})

test('missing time, checkout evidence, or strong cart identity cannot bind', () => {
  assert.equal(assess({lastOn:{...on,observed_state_at:null}}).status,'TIME_UNVERIFIED')
  assert.equal(assess({journey:{...journey,link_confidence:'WEAK'}}).status,
    'JOURNEY_UNVERIFIED')
  assert.equal(assess({checkout:null}).status,'CHECKOUT_UNVERIFIED')
})

test('quality lease expiration and missing baseline block the read', () => {
  assert.equal(assess({quality:{...quality,valid_until:'2026-10-29T11:59:00Z'}}).status,
    'BLOCKED_BY_QUALITY')
  assert.equal(assess({quality:{...quality,baseline_complete:false}}).status,
    'BLOCKED_BY_QUALITY')
  assert.equal(assess({quality:{...quality,historical_gap_status:'COMPLETE'}}).status,
    'BLOCKED_BY_QUALITY')
})

test('read path rechecks order revision after cross-database journey lookup', async () => {
  const orderClient = {release(){},async query(sql) {
    if (sql.startsWith('SELECT status,baseline_complete')) return {rows:[quality]}
    if (sql.startsWith('SELECT s.source_instance_id')) return {rows:[{
      ...state,on_record_id:on.record_id,on_cart_id:on.cart_id,
      on_observed_state_at:on.observed_state_at,
      transition_record_id:transition.record_id,transition_active:true}]}
    return {rows:[]}
  }}
  const orderPool = {async connect(){return orderClient},async query(){return {rows:[{
    ...quality,last_record_id:'changed_during_join',last_topic_offset:'20'}]}}}
  const journeyPool = {async query(sql) {
    return sql.includes('FROM journey_entities') ? {rows:[journey],rowCount:1}
      : {rows:[checkout],rowCount:1}
  }}
  const path = createShadowOrderJourneyReadPath({orderPool,journeyPool,now:()=>now})
  assert.deepEqual(await path.read({sourceInstanceId:state.source_instance_id,
    sourceId:'medusa-reference',coverageEpochId:state.coverage_epoch_id,
    orderId:state.order_id}),
  {status:'BLOCKED_BY_QUALITY',reason:'LEASE_OR_STATE_CHANGED'})
})

test('read path requires a strong cart key and matching checkout in one journey snapshot', async () => {
  const orderClient = {release(){},async query(sql) {
    if (sql.startsWith('SELECT status,baseline_complete')) return {rows:[quality]}
    if (sql.startsWith('SELECT s.source_instance_id')) return {rows:[{
      ...state,on_record_id:on.record_id,on_cart_id:on.cart_id,
      on_observed_state_at:on.observed_state_at,
      transition_record_id:transition.record_id,transition_active:true}]}
    return {rows:[]}
  }}
  let journeyReads = 0
  const orderPool = {async connect(){return orderClient},async query(){return {rows:[{
    ...quality,last_record_id:state.last_record_id,
    last_topic_offset:state.last_topic_offset}]}}}
  const journeyPool = {async query(sql,params) {
    journeyReads++
    assert.match(sql,/e\.link_confidence='STRONG'/)
    assert.match(sql,/c\.relations->>'cart_id'=\$2/)
    assert.match(sql,/c\.relations->>'correlation_id'='cart:'\|\|\$2/)
    assert.match(sql,/c\.relations->>'cart_id' IS NULL OR c\.relations->>'cart_id'=\$2/)
    assert.match(sql,/c\.relations->>'correlation_id' IS NULL OR/)
    assert.deepEqual(params,['medusa-reference','cart_1'])
    return {rows:[{...journey,checkout_event_id:checkout.canonical_event_id}],rowCount:1}
  }}
  const path = createShadowOrderJourneyReadPath({orderPool,journeyPool,now:()=>now})
  const result = await path.read({sourceInstanceId:state.source_instance_id,
    sourceId:'medusa-reference',coverageEpochId:state.coverage_epoch_id,
    orderId:state.order_id})
  assert.equal(result.status,'BOUND_SHADOW')
  assert.equal(result.checkout_event_id,'checkout_1')
  assert.equal(journeyReads,1)
})
