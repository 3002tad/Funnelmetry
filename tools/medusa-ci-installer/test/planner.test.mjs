import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loadManifest, validateManifest } from '../src/manifest.mjs'
import { createPlan, verifyIntegration } from '../src/planner.mjs'
import { parseManifestYaml } from '../src/yaml.mjs'

const fixture = fileURLToPath(new URL('./fixtures/medusa-dtc/', import.meta.url))
const example = fileURLToPath(new URL('../examples/funnelmetry.integration.yaml', import.meta.url))

async function applyPatch(projectRoot, patch) {
  for (const section of patch.split(/(?=diff --git )/)) {
    const match = section.match(/^diff --git a\/(.+) b\/\1/m)
    if (!match) continue
    const target = path.join(projectRoot, match[1])
    if (section.includes('\ndeleted file mode 100644\n')) {
      await rm(target)
      continue
    }
    const added = section.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1)).join('\n')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, `${added}\n`)
  }
}

async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'funnelmetry-cdc-primary-'))
  try {
    await cp(fixture, root, { recursive: true })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('CDC primary manifest refuses backend message bindings, v1 shadow and rollback target', async () => {
  const manifest = await loadManifest(example)
  assert.deepEqual(manifest.bindings.medusaBackend, [])
  assert.equal(manifest.cdcOrderV2Shadow.profile, 'reference.medusa.order_recorded_state.v2')
  const raw = parseManifestYaml(await readFile(example, 'utf8'))
  const message = structuredClone(raw)
  message.bindings.medusa_backend = ['medusa.order_placed']
  assert.throws(() => validateManifest(message), /must be \[\]/)
  const v1 = structuredClone(raw)
  v1.cdc_shadow = {}
  assert.throws(() => validateManifest(v1), /retired/)
  const rollback = structuredClone(raw)
  rollback.cdc_order_v2_shadow.rollback_target = 'native_order_placed'
  assert.throws(() => validateManifest(rollback), /Unsupported.*rollback_target/)
})

test('fresh installer produces storefront and CDC profiles without a backend message producer', async () => {
  const manifest = await loadManifest(example)
  await withFixture(async root => {
    const before = await readFile(path.join(root, 'apps/backend/package.json'), 'utf8')
    const plan = await createPlan(root, manifest)
    assert.equal(plan.sourceMutation, false)
    assert.equal(plan.capabilities.orderPlaced, 'DISABLED')
    assert.equal(plan.capabilities.cdcOrderV2State, 'CDC_PRIMARY_REFERENCE')
    assert.equal(plan.capabilities.searchSubmitted, 'ENABLED')
    assert.equal(plan.capabilities.cartItemPersisted, 'ENABLED')
    assert.match(plan.patch, /funnelmetry\/cdc-order-v2-shadow\.json/)
    assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/client\.tsx/)
    assert.match(plan.patch, /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/apps\/storefront\/src\/modules\/store\/components\/store-search\/index\.tsx/)
    assert.doesNotMatch(plan.patch, /apps\/backend\/src\/subscribers|managed-delivery-dispatcher/)
    assert.equal(await readFile(path.join(root, 'apps/backend/package.json'), 'utf8'), before)
    await applyPatch(root, plan.patch)
    const search = await readFile(path.join(root, 'apps/storefront/src/modules/store/components/store-search/index.tsx'), 'utf8')
    const storePage = await readFile(path.join(root, 'apps/storefront/src/app/[countryCode]/(main)/store/page.tsx'), 'utf8')
    const storeTemplate = await readFile(path.join(root, 'apps/storefront/src/modules/store/templates/index.tsx'), 'utf8')
    const products = await readFile(path.join(root, 'apps/storefront/src/modules/store/templates/paginated-products.tsx'), 'utf8')
    assert.match(search, /fm_search_interaction_id.*createSearchInteractionId\(\)/)
    assert.doesNotMatch(search, /trackSearchSubmitted/)
    assert.match(storePage, /searchInteractionId=\{typeof searchInteractionId/)
    assert.match(storeTemplate, /<StoreSearch initialQuery=\{query\} \/>/)
    assert.match(products, /queryParams\["q"\] = query\.trim\(\)/)
    assert.match(products, /enqueueSearchOutcome\(\{ searchInteractionId, query, outcome: "succeeded", resultCount: count \}\)/)
    assert.match(products, /enqueueSearchOutcome\(\{ searchInteractionId, query, outcome: "failed" \}\)/)
    assert.equal((await verifyIntegration(root, manifest)).status, 'pass')
    assert.equal((await createPlan(root, manifest)).patch, '')
  })
})

test('fresh installer refuses a partially wired search storefront', async () => {
  const manifest = await loadManifest(example)
  await withFixture(async root => {
    const target = path.join(root, 'apps/storefront/src/modules/store/templates/index.tsx')
    const before = await readFile(target, 'utf8')
    await writeFile(target, before.replace('import { Suspense }', 'import StoreSearch from "@modules/store/components/store-search"\nimport { Suspense }'))
    await assert.rejects(() => createPlan(root, manifest), /partial search installation/)
  })
})

test('installer removes only known retired profiles and migrates order v2 authority', async () => {
  const manifest = await loadManifest(example)
  await withFixture(async root => {
    await applyPatch(root, (await createPlan(root, manifest)).patch)
    const v1Path = path.join(root, 'funnelmetry/cdc-reference-shadow.json')
    await writeFile(v1Path, JSON.stringify({ generated_by: 'funnelmetry-medusa-ci',
      schema_version: 'funnelmetry-medusa-cdc-reference-shadow.v1', source_id: manifest.source.id }))
    const v2Path = path.join(root, 'funnelmetry/cdc-order-v2-shadow.json')
    const v2 = JSON.parse(await readFile(v2Path, 'utf8'))
    delete v2.analytical_authority
    v2.order_fact_authority = 'medusa.order_placed'
    v2.canonical_live_event = 'order.placed'
    v2.rollback_target = 'native_order_placed'
    await writeFile(v2Path, JSON.stringify(v2, null, 2) + '\n')
    const helper = path.join(root, 'apps/backend/src/funnelmetry/occurred-at.ts')
    await mkdir(path.dirname(helper), { recursive: true })
    await writeFile(helper, 'export function normalizeOccurredAt() {}\n')
    const plan = await createPlan(root, manifest)
    assert.deepEqual(plan.changes.map(change => change.path).sort(), [
      'apps/backend/src/funnelmetry/occurred-at.ts', 'funnelmetry/cdc-order-v2-shadow.json',
      'funnelmetry/cdc-reference-shadow.json'].sort())
    await applyPatch(root, plan.patch)
    assert.equal((await verifyIntegration(root, manifest)).status, 'pass')
    await writeFile(v1Path, JSON.stringify({ generated_by: 'other',
      schema_version: 'funnelmetry-medusa-cdc-reference-shadow.v1', source_id: manifest.source.id }))
    await assert.rejects(() => createPlan(root, manifest), /not installer-owned/)
  })
})
