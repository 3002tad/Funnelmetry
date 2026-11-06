import test from 'node:test'
import assert from 'node:assert/strict'
import {navigation,visibleNavigation} from '../src/app/navigation.ts'
const paths=permissions=>visibleNavigation(permissions).flatMap(g=>g.items.map(i=>i.path))
test('analyst menu retains approved modules and hides retired surfaces',()=>{
 assert.deepEqual(paths(['analytics.read']),['/overview','/funnels','/products','/events','/data-health'])
 assert.deepEqual(paths([]),[]);assert.deepEqual(paths(['chat.use']),[])
 for(const p of ['/workspace','/analysis-runs','/evidence','/findings','/reports','/metrics','/assets','/campaigns','/journeys'])assert.ok(!paths(['analytics.read']).includes(p))
})
test('combined capabilities retain both bundles and routes stay unique',()=>{
 const result=paths(['analytics.read','pipeline.monitor']);assert.ok(result.includes('/overview'));assert.ok(result.includes('/admin/pipeline'))
 const items=navigation.flatMap(g=>g.items);assert.equal(new Set(items.map(i=>i.path)).size,items.length)
})
