import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = new URL('../../', import.meta.url)
const rootPath = decodeURIComponent(root.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1')
const failures = []
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yaml', '.yml'])
const ignoredSegments = new Set(['.git', 'node_modules', 'archive'])

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, visit)
    else visit(path)
  }
}
function fail(path, reason) {
  failures.push(`${relative(rootPath, path)}: ${reason}`)
}
function read(path) { return readFileSync(path, 'utf8') }

for (const directory of ['apps', 'packages', 'workers', 'infra', 'runtime', 'integrations', 'tools']) {
  const absolute = join(rootPath, directory)
  if (!existsSync(absolute)) continue
  walk(absolute, path => {
    if (!textExtensions.has(extname(path))) return
    const relativePath = relative(rootPath, path).replaceAll('\\', '/')
    if (relativePath === 'tools/ci/check-backend-integration-retired.mjs') return
    const source = read(path)
    if (/\b(?:import|require)\s*\(?[^\n]*backend-integration-kit/.test(source)) {
      fail(path, 'imports retired Backend Integration Kit')
    }
    if (/FUNNELMETRY_BACKEND_SIGNING_KEY|SOURCE_INGRESS_BACKEND_KEYS_JSON|INPUT_GATEWAY_BACKEND_KEYS_JSON/.test(source)) {
      fail(path, 'contains retired backend credential')
    }
    const cleanupOnly = relativePath === 'tools/medusa-ci-installer/src/planner.mjs' ||
      relativePath === 'tools/medusa-ci-installer/test/planner.test.mjs'
    const admissionOnly = relativePath === 'apps/edge-relay/src/relay-handler.js' ||
      relativePath === 'apps/edge-relay/test/source-ingress-handler.test.js'
    const rejectionOnly = admissionOnly || [
      'packages/behavior-event-catalog/test/behavior-event-catalog.test.js',
      'packages/browser-sdk/test/browser-sdk.test.js',
      'workers/canonical-normalizer/test/mapping-registry.test.js',
      'workers/canonical-normalizer/test/normalizer.test.js',
    ].includes(relativePath)
    if (!cleanupOnly && !rejectionOnly &&
      /(?:source_event_type|sourceEventType|eventType)\s*[:=]\s*['"]medusa\.order_placed['"]/.test(source)) {
      fail(path, 'produces or fixtures retired Medusa order event')
    }
    if (!cleanupOnly && !rejectionOnly &&
      /(?:source_event_type|sourceEventType|eventType)\s*[:=]\s*['"]behavior\.search_submitted['"]/.test(source)) {
      fail(path, 'produces or fixtures retired server search event')
    }
  })
}

const catalog = read(join(rootPath, 'packages/behavior-event-catalog/src/index.js'))
if (catalog.includes('behavior.search_submitted')) {
  fail(join(rootPath, 'packages/behavior-event-catalog/src/index.js'), 'retired server search remains in current Catalog')
}
const mappingPath = join(rootPath, 'integrations/medusa/canonical-mappings.v2.json')
const mapping = JSON.parse(read(mappingPath))
if (mapping.schema_version !== 'canonical-mappings.v2' || mapping.mappings?.length !== 0) {
  fail(mappingPath, 'Medusa producer mapping must be version 2 with an empty mapping list')
}
for (const retiredPath of [
  'packages/backend-integration-kit',
  'tools/v2-e2e',
  'tools/medusa-reference-simulator',
  'tools/medusa-reference-cdc-shadow/shadow-order-placed-wal.cjs',
]) {
  const absolute = join(rootPath, retiredPath)
  if (existsSync(absolute)) {
    const hasFiles = !readdirSync(absolute, { recursive: true, withFileTypes: true })
      .every(entry => entry.isDirectory())
    if (hasFiles) fail(absolute, 'retired active path still exists')
  }
}
const manifest = read(join(rootPath, 'tools/medusa-ci-installer/examples/funnelmetry.integration.v3.yaml'))
if (!/^\s*storefront_server:\s*\[\]\s*$/m.test(manifest) ||
    !/^\s*medusa_backend:\s*\[\]\s*$/m.test(manifest)) {
  fail(join(rootPath, 'tools/medusa-ci-installer/examples/funnelmetry.integration.v3.yaml'),
    'server/backend bindings must both be empty')
}
const sourceIngressEnvExample = join(rootPath, 'apps/edge-relay/deploy/source-ingress.server.env.example')
if (/SOURCE_INGRESS_BACKEND_KEYS_JSON|SOURCE_INGRESS_MAX_CLOCK_SKEW_MS/.test(read(sourceIngressEnvExample))) {
  fail(sourceIngressEnvExample, 'retired backend authentication remains in Source Ingress env example')
}

if (failures.length) {
  console.error(['Backend Integration retirement guard failed:', ...failures.map(value => `- ${value}`)].join('\n'))
  process.exit(1)
}
console.log('PASS: Backend Integration retired; Browser SDK + CDC are the only active acquisition paths')
