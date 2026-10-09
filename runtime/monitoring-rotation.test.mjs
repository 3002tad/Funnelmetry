import test from 'node:test'
import assert from 'node:assert/strict'
import { rotateMonitoring } from './monitoring-rotation.mjs'
function fixture(failure) {
  const calls=[];let pending=null
  const step=name=>async value=>{calls.push(name);if(name===failure)throw Error('fault');return value}
  const deps={current:async()=>({id:'old'}),loadPending:async()=>pending,
    issue:async()=>{calls.push('issue');return {id:'new',token:'secret',expires_at:'later'}},
    savePending:async p=>{await step('save')();pending=p},verify:step('verify'),install:step('install'),
    restart:step('restart'),freshScrape:step('scrape'),revoke:async id=>{calls.push('revoke:'+id)},
    commit:step('commit'),clearPending:async()=>{calls.push('clear');pending=null}}
  return {deps,calls,get pending(){return pending}}
}
test('successful scrape precedes revoke and committed receipt',async()=>{
  const f=fixture();assert.equal(await rotateMonitoring(f.deps),'later')
  assert.deepEqual(f.calls,['issue','save','verify','install','restart','scrape','revoke:old','commit','clear'])
})
test('failed validation, write, restart or scrape never revokes the previous key',async()=>{
  for(const fault of ['verify','install','restart','scrape']){
    const f=fixture(fault);await assert.rejects(rotateMonitoring(f.deps));assert.ok(f.pending)
    assert.ok(!f.calls.includes('revoke:old'))
    f.deps[fault==='scrape'?'freshScrape':fault]=async()=>{}
    await rotateMonitoring(f.deps);assert.equal(f.calls.filter(c=>c==='issue').length,1)
    assert.equal(f.pending,null)
  }
})
test('journal save failure revokes only the unused replacement',async()=>{
  const f=fixture('save');await assert.rejects(rotateMonitoring(f.deps))
  assert.deepEqual(f.calls,['issue','save','revoke:new']);assert.equal(f.pending,null)
})
test('crash after revoke can resume idempotently with the same replacement',async()=>{
  const f=fixture('commit');await assert.rejects(rotateMonitoring(f.deps))
  f.deps.commit=async()=>{};await rotateMonitoring(f.deps)
  assert.equal(f.calls.filter(c=>c==='issue').length,1)
  assert.equal(f.calls.filter(c=>c==='revoke:old').length,2)
})
