import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { CONFIG, generate } from './generator.mjs'
import { buildFoundation, foundationHash } from './foundation.mjs'

test('foundation preserves keys, fixture coverage and an explicitly unverified observed boundary', () => {
  const fixture=generate(), a=buildFoundation(fixture), b=buildFoundation(fixture)
  assert.equal(foundationHash(a),foundationHash(b))
  assert.equal(a.crosswalk.length,64)
  assert.equal(a.coverage.length,8)
  assert.equal(a.cutover_at,CONFIG.end)
  assert.equal(a.cutover_status,'PROVISIONAL_OFFLINE_ONLY')
  assert(a.coverage.filter(x=>x.origin==='OBSERVED_SOURCE').every(x=>x.status==='UNVERIFIED' && x.source_checkpoint===null))
  assert(a.coverage.filter(x=>x.origin==='SYNTHETIC_BACKFILL').every(x=>x.status==='COMPLETE' && x.evidence==='SYNTHETIC_FIXTURE_ONLY'))
  assert(a.crosswalk.every(x=>x.mapping_status==='FIXTURE_ONLY' && x.valid_to===CONFIG.end))
})

test('explicit anchors are one-to-one candidates and never inferred from labels', () => {
  const fixture=generate(), first=fixture.products[0], second=fixture.products[1]
  const a={entity_type:'product',synthetic_id:first.product_id,source_id:'medusa-reference',source_entity_id:'prod_example',mapping_evidence:'operator_mapping_manifest:example'}
  const result=buildFoundation(fixture,[a])
  const observed=result.crosswalk.find(x=>x.source_entity_id==='prod_example')
  assert.equal(observed.demo_entity_key,`demo:product:${first.product_id}`)
  assert.equal(observed.mapping_status,'UNVERIFIED')
  assert.equal(observed.valid_from,CONFIG.end)
  assert.throws(()=>buildFoundation(fixture,[{...a,mapping_evidence:''}]),/invalid_explicit_anchor/)
  assert.throws(()=>buildFoundation(fixture,[{...a,synthetic_id:'unknown'}]),/invalid_explicit_anchor/)
  assert.throws(()=>buildFoundation(fixture,[a,{...a,synthetic_id:second.product_id}]),/duplicate_or_ambiguous_anchor/)
  assert.throws(()=>buildFoundation(fixture,[a,{...a,source_entity_id:'prod_other'}]),/duplicate_or_ambiguous_anchor/)
  assert.throws(()=>buildFoundation({...fixture,config:{...CONFIG,end:'2025-01-01T00:00:00Z'}}),/invalid_fixture_interval/)
  assert.throws(()=>buildFoundation({...fixture,config:{...CONFIG,source_id:'medusa-reference'}}),/invalid_foundation_config/)
})

test('generated manifest validates fixture lineage and detects tampering', async () => {
  const temp=await mkdtemp(resolve(tmpdir(),'funnelmetry-foundation-'))
  const pilot=resolve(temp,'pilot'), output=resolve(temp,'foundation')
  const run=(...args)=>spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8'})
  try {
    assert.equal(run('tools/demo-seed-pilot/pilot.mjs','generate',pilot).status,0)
    const created=run('tools/demo-seed-pilot/foundation-cli.mjs','generate',pilot,output)
    assert.equal(created.status,0,created.stderr)
    assert.equal(run('tools/demo-seed-pilot/foundation-cli.mjs','verify',pilot,output).status,0)
    const original=await readFile(resolve(output,'foundation.json'),'utf8')
    const data=JSON.parse(original)
    data.coverage[1].status='COMPLETE'
    await writeFile(resolve(output,'foundation.json'),JSON.stringify(data))
    assert.notEqual(run('tools/demo-seed-pilot/foundation-cli.mjs','verify',pilot,output).status,0)
    await writeFile(resolve(output,'foundation.json'),original)
    const manifestPath=resolve(output,'manifest.json')
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
    manifest.live_coverage='COMPLETE'
    await writeFile(manifestPath,JSON.stringify(manifest))
    assert.notEqual(run('tools/demo-seed-pilot/foundation-cli.mjs','verify',pilot,output).status,0)
  } finally {
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep + 'funnelmetry-foundation-')) throw Error('unsafe_test_cleanup_target')
    await rm(temp,{recursive:true,force:true})
  }
})
