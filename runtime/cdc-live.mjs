// CDC-14 operator launcher. The old target must be stopped before this stack
// takes ownership of the same replication slots, Kafka groups and mapper DB.
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.argv[2]
if (!['check', 'deploy'].includes(command)) {
  throw Error('usage: node runtime/cdc-live.mjs check|deploy [env-file]')
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(root, process.argv[3] || 'runtime/cdc-live.env')
const config = parseEnv(await readFile(envFile, 'utf8'))
const required = [
  'CDC_STACK_NAME', 'CDC_WORKERS_IMAGE', 'CDC_CONNECT_IMAGE', 'CDC_POSTGRES_IMAGE',
  'CDC_SOURCE_ID', 'CDC_ORDER_EPOCH', 'CDC_PREVIOUS_ORDER_EPOCH',
  'CDC_CATALOG_EPOCH', 'CDC_INVENTORY_PRICE_EPOCH', 'CDC_ORDER_TOPIC_PREFIX',
  'CDC_CART_EPOCH', 'CDC_CART_TOPIC_PREFIX', 'CDC_CART_GROUP_ID', 'CDC_CANONICAL_TOPIC',
  'CDC_ORDER_FACT_TOPIC', 'CDC_CATALOG_TOPIC_PREFIX', 'CDC_INVENTORY_PRICE_TOPIC_PREFIX',
  'CDC_CONNECT_GROUP_ID', 'CDC_CONNECT_CONFIG_TOPIC', 'CDC_CONNECT_OFFSET_TOPIC',
  'CDC_CONNECT_STATUS_TOPIC', 'CDC_CATALOG_GROUP_ID', 'CDC_INVENTORY_PRICE_GROUP_ID',
  'CDC_ORDER_MAPPER_GROUP_ID', 'CDC_ORDER_SINK_GROUP_ID',
  'CDC_PIPELINE_DB_PASSWORD_SECRET', 'CDC_MAPPER_DB_PASSWORD_SECRET',
  'CDC_PIPELINE_DATA_NETWORK', 'CDC_SOURCE_NETWORK', 'CDC_MAPPER_DATA_VOLUME',
]
for (const key of required) if (!config[key]?.trim()) throw Error(`${key} missing`)
if (config.CDC_STACK_NAME !== 'funnelmetry_cdc' ||
    config.CDC_MAPPER_DATA_VOLUME !== 'funnelmetry_cdc_target_shadow_order-mapper-data' ||
    config.CDC_SOURCE_ID !== 'medusa-reference') {
  throw Error('CDC-14 identity/mapper-volume guard failed')
}
for (const key of ['CDC_WORKERS_IMAGE', 'CDC_CONNECT_IMAGE', 'CDC_POSTGRES_IMAGE']) {
  if (!/^[-\w./]+@sha256:[a-f0-9]{64}$/.test(config[key])) throw Error(`${key} must pin a digest`)
}
const env = { ...process.env, ...config }
const stackFile = resolve(root, 'infra/swarm-cdc-live.yml')
async function docker(args) {
  return await new Promise((done, fail) => {
    const child = spawn('docker', args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', fail)
    child.once('close', code => code === 0 ? done(stdout.trim()) :
      fail(Error(`docker ${args[0]} failed: ${stderr.trim().slice(0, 300)}`)))
  })
}
await docker(['stack', 'config', '-c', stackFile])
if (command === 'check') {
  process.stdout.write('CDC-14 stack renders with pinned images and preserved mapper volume; runtime unverified\n')
} else {
  const old = 'funnelmetry_cdc_target_shadow'
  const services = (await docker(['service', 'ls', '--format', '{{.Name}}|{{.Replicas}}'])).split('\n')
    .filter(line => line.startsWith(`${old}_`))
  if (services.some(line => !line.endsWith('|0/0'))) {
    throw Error('old CDC target still has running or desired replicas; stop-first required')
  }
  await docker(['stack', 'deploy', '--with-registry-auth', '-c', stackFile, config.CDC_STACK_NAME])
  process.stdout.write('CDC stack submitted; verify seven replicas, offsets and quality leases\n')
}
