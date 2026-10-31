// One empty reference-shop cart verifies a post-cutover CDC write without
// placing an order, reserving stock or changing catalog data.
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'

const [envPath, regionId] = process.argv.slice(2)
if (!envPath || !/^reg_[A-Za-z0-9]+$/.test(regionId ?? '')) {
  throw Error('usage: node verify-postcutover-cart.mjs <storefront-env> <region-id>')
}
const vars = parseEnv(await readFile(envPath, 'utf8'))
const key = vars.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
if (!key) throw Error('publishable key missing')
const response = await fetch('http://127.0.0.1:9000/store/carts', {
  method: 'POST',
  signal: AbortSignal.timeout(15000),
  headers: { 'x-publishable-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify({ region_id: regionId }),
})
const data = await response.json().catch(() => ({}))
if (!response.ok || !/^cart_[A-Za-z0-9]+$/.test(data.cart?.id ?? '')) {
  throw Error(`empty cart creation failed: HTTP ${response.status}`)
}
process.stdout.write(`postcutover_empty_cart=${data.cart.id}\n`)
