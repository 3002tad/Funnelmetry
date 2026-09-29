import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {saveCatalog} from '../../../workers/catalog-sync/src/catalog.js'
import {attachProductReferences} from '../../../apps/dashboard-api/src/lib/product-reference.js'
const require=createRequire(new URL('../../../apps/dashboard-api/package.json',import.meta.url))
const {Client}=require('pg')
test('PG snapshot migration, source isolation, history, no fanout and rollback', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL)
  assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/medusa_contract_test')
  const client=new Client({connectionString:url.href});await client.connect()
  const tx=async(sql,params)=>(await client.query(sql,params)).rows
  try {
    const migration=await readFile(new URL('../../../infra/postgres/v2/020_product_reference.sql',import.meta.url),'utf8')
    await client.query(migration);await client.query(migration)
    const first=randomUUID(),second=randomUUID()
    const write=(sourceId,snapshotId,products)=>saveCatalog(client,{sourceId,snapshotId,products})
    await write('catalog-a',first,[{product_id:'shared',title:'Old name'},{product_id:'missing-later',title:'Old'}])
    await write('catalog-b',randomUUID(),[{product_id:'shared',title:'Other source'}])
    await write('catalog-a',second,[{product_id:'shared',title:'Áo mới'}])
    const rows=await attachProductReferences(tx,'catalog-a',[{product_id:'shared',views:'123'},{product_id:'missing-later',views:'4'}])
    assert.equal(rows.length,2);assert.equal(rows[0].views,'123');assert.equal(rows[0].reference.title,'Áo mới')
    assert.equal(rows[0].reference.snapshot_id,second);assert.equal(rows[1].reference,null)
    assert.equal((await attachProductReferences(tx,'catalog-b',[{product_id:'shared'}]))[0].reference.title,'Other source')
    assert.equal((await tx('SELECT title FROM product_reference_names WHERE snapshot_id=$1 AND product_id=$2',[first,'shared']))[0].title,'Old name')
    const failed=randomUUID()
    await assert.rejects(write('catalog-a',failed,[{product_id:'dup',title:'1'},{product_id:'dup',title:'2'}]))
    assert.equal((await tx('SELECT count(*)::int AS n FROM product_reference_snapshots WHERE snapshot_id=$1',[failed]))[0].n,0)
    assert.equal((await attachProductReferences(tx,'catalog-a',[{product_id:'shared'}]))[0].reference.snapshot_id,second)
    await write('catalog-a',randomUUID(),[])
    assert.equal((await attachProductReferences(tx,'catalog-a',[{product_id:'shared'}]))[0].reference,null)
  }finally {await client.end()}
})
