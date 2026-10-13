import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const config = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8')
const mainConfig = await readFile(new URL('../nginx-main.conf', import.meta.url), 'utf8')

test('API proxy config uses Docker DNS instead of a startup-resolved address', () => {
  assert.match(config, /location \/api\/ \{[\s\S]*?resolver 127\.0\.0\.11 valid=5s ipv6=off;/)
  assert.match(config, /set \$api_upstream dashboard-api:32000;/)
  assert.match(config, /proxy_pass http:\/\/\$api_upstream;/)
  assert.doesNotMatch(config, /proxy_pass http:\/\/dashboard-api:32000;/)
})

test('proxy keeps the original API URI and does not log request query strings', () => {
  assert.match(config, /proxy_pass http:\/\/\$api_upstream;/)
  assert.match(config, /location \/api\/ \{[\s\S]*?access_log off;/)
  assert.match(config, /proxy_set_header X-Forwarded-Proto \$client_scheme;/)
  assert.match(mainConfig, /map \$http_x_forwarded_proto \$client_scheme/)
})
