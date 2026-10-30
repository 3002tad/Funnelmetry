// One authenticated, read-only Dashboard request for the CDC catalog canary.
// Password and bearer token stay in this process; output contains counts only.
import { readFile } from 'node:fs/promises'

const [baseUrl, email, passwordFile, sourceId] = process.argv.slice(2)
if (!baseUrl?.startsWith('https://') || !email || !passwordFile || !sourceId) {
  throw Error('usage: node smoke-target-catalog-canary.mjs https://host email /absolute/password-file source-id')
}
const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '')
const login = await fetch(new URL('/api/auth/login', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
if (!login.ok) throw Error(`catalog_canary_login_http_${login.status}`)
const { token } = await login.json()
if (!token) throw Error('catalog_canary_login_token_missing')

const now = new Date()
const from = new Date(now.getTime() - 89 * 86400000)
const url = new URL('/api/v2/products', baseUrl)
url.searchParams.set('source_id', sourceId)
url.searchParams.set('from', from.toISOString())
url.searchParams.set('to', now.toISOString())
const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
if (!response.ok) throw Error(`catalog_canary_products_http_${response.status}`)
const body = await response.json()
if (!Array.isArray(body.items) || body.items.length === 0) {
  throw Error('catalog_canary_no_observed_products')
}
const references = body.items.map(item => item.reference).filter(Boolean)
if (references.length === 0 || references.some(ref =>
  ref.provider !== 'medusa-postgres-cdc-v1' || ref.coverage_epoch_id !== 'cdc11_catalog_epoch1')) {
  throw Error('catalog_canary_wrong_or_missing_provider')
}
console.log(JSON.stringify({ status: 'PASS_CATALOG_CDC_API',
  observed_products: body.items.length, cdc_references: references.length,
  missing_references: body.items.length - references.length,
  provider: 'medusa-postgres-cdc-v1', coverage_epoch_id: 'cdc11_catalog_epoch1' }))
