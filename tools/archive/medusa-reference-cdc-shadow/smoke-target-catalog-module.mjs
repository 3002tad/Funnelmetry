// Feed to `docker exec -i <dashboard-api-container> node --input-type=module`.
// Executes the deployed Dashboard module against its own DB in a read-only
// transaction; does not require changing an account's permissions.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

assert.equal(process.env.PRODUCT_REFERENCE_PROVIDER, 'catalog_cdc')
const require = createRequire('/workspace/apps/dashboard-api/package.json')
const pg = require('pg')
const { attachProductReferences } = await import(
  'file:///workspace/apps/dashboard-api/src/lib/product-reference.js')
const password = (await readFile('/run/secrets/db_password', 'utf8')).replace(/\r?\n$/, '')
const client = new pg.Client({ host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password })
try {
  await client.connect()
  await client.query('BEGIN READ ONLY')
  const { rows: products } = await client.query(`SELECT product_id,title
    FROM catalog_cdc_products_current
    WHERE source_id='medusa-reference' AND coverage_epoch_id='cdc11_catalog_epoch1'
      AND NOT soft_deleted ORDER BY product_id`)
  assert.ok(products.length > 0)
  const references = await attachProductReferences(
    async (sql, params) => (await client.query(sql, params)).rows,
    'medusa-reference', products.map(({ product_id }) => ({ product_id })))
  assert.equal(references.length, products.length)
  for (let index = 0; index < products.length; index++) {
    assert.equal(references[index].reference?.title, products[index].title)
    assert.equal(references[index].reference?.provider, 'medusa-postgres-cdc-v1')
    assert.equal(references[index].reference?.coverage_epoch_id, 'cdc11_catalog_epoch1')
  }
  await client.query('COMMIT')
  console.log(JSON.stringify({ status: 'PASS_CATALOG_CDC_MODULE',
    products: products.length, missing_references: 0,
    provider: 'medusa-postgres-cdc-v1' }))
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  await client.end().catch(() => {})
}
