import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRecord} from '../src/contract.js'

const context = {epoch:'cdc10-epoch2', sourceId:'medusa-reference-shadow'}
const base = {
  contract_id:'reference.medusa.order_recorded_state.v2',
  coverage_epoch_id:context.epoch, source_instance_id:context.sourceId,
  historical_gap_status:'INCOMPLETE', coverage:'CURRENT_STATE_FROM_REBASELINE',
  quality:'REFERENCE_APPROXIMATE', record_id:'a'.repeat(64),
}

test('accepts baseline marker and current-state row in the exact epoch', () => {
  const marker = {...base,record_type:'BASELINE_COMPLETE',order_id:'__baseline__',
    baseline_orders:105,baseline_active_orders:105,baseline_digest:'b'.repeat(64)}
  assert.equal(validateRecord(marker,context),marker)
  const row = {...base,record_type:'BASELINE',order_id:'order_123',cart_id:'cart_123',
    active:true,revision_end_id:null}
  assert.equal(validateRecord(row,context),row)
})

test('rejects a foreign epoch, source or canonical placement alias', () => {
  const row = {...base,record_type:'BASELINE',order_id:'order_123',cart_id:'cart_123',
    active:true,revision_end_id:null}
  assert.throws(()=>validateRecord({...row,coverage_epoch_id:'other'},context),/record_invalid/)
  assert.throws(()=>validateRecord({...row,source_instance_id:'other'},context),/record_invalid/)
  assert.throws(()=>validateRecord({...row,contract_id:'order.placed'},context),/record_invalid/)
  assert.throws(()=>validateRecord({...row,historical_gap_status:'COMPLETE'},context),/record_invalid/)
})

test('rejects fabricated ON from baseline and active state without a cart', () => {
  const row = {...base,record_type:'BASELINE',order_id:'order_123',cart_id:'cart_123',
    active:true,revision_end_id:null}
  assert.throws(()=>validateRecord({...row,revision_end_id:'1:1'},context),/state_invalid/)
  assert.throws(()=>validateRecord({...row,cart_id:null},context),/state_invalid/)
  assert.equal(validateRecord({...row,record_type:'TRANSITION',revision_end_id:'1:1'},context)
    .record_type,'TRANSITION')
})
