import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { loadManifest, validateManifest } from "../src/manifest.mjs"
import { createPlan, verifyIntegration } from "../src/planner.mjs"
import { parseManifestYaml } from "../src/yaml.mjs"

const fixture = fileURLToPath(new URL("./fixtures/medusa-dtc/", import.meta.url))
const example = fileURLToPath(new URL("../examples/funnelmetry.integration.v3.yaml", import.meta.url))
async function applyPatch(root, patch) {
  for (const section of patch.split(/(?=diff --git )/)) {
    const match = section.match(/^diff --git a\/(.+) b\/\1/m); if (!match) continue
    const target = path.join(root, match[1])
    if (section.includes("\ndeleted file mode 100644\n")) { await rm(target); continue }
    const added = section.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++"))
      .map(line => line.slice(1)).join("\n")
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${added}\n`)
  }
}
async function withFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "funnelmetry-v4-"))
  try { await cp(fixture, root, { recursive: true }); await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test("manifest accepts only V3 with browser search, CDC cart and no server/backend binding", async () => {
  const raw = parseManifestYaml(await readFile(example, "utf8"))
  assert.equal(validateManifest(raw).apiVersion, "funnelmetry.io/v3")
  for (const mutate of [
    value => { value.apiVersion = "funnelmetry.io/v2" },
    value => { value.bindings.storefront_server = ["cart.item_added"] },
    value => { value.bindings.medusa_backend = ["legacy"] },
  ]) { const value = structuredClone(raw); mutate(value); assert.throws(() => validateManifest(value)) }
})

test("fresh installer emits only Browser SDK and CDC integration", async () => {
  const manifest = await loadManifest(example)
  await withFixture(async root => {
    const plan = await createPlan(root, manifest)
    assert.equal(plan.schemaVersion, "funnelmetry-ci-plan.v4")
    assert.doesNotMatch(plan.patch, /server-delivery\.ts|managed-delivery-dispatcher|funnelmetry-order-placed|backend-integration-kit|enqueueSearchOutcome|enqueueCartItemAdded/)
    assert.match(plan.patch, /behavior\.search_query_submitted/)
    assert.match(plan.patch, /cdc-cart-line-item\.json/)
    await applyPatch(root, plan.patch)
    assert.equal((await verifyIntegration(root, manifest)).status, "pass")
    assert.equal((await createPlan(root, manifest)).patch, "")
  })
})

test("upgrade removes retired files and dependencies without regenerating a producer", async () => {
  const manifest = await loadManifest(example)
  await withFixture(async root => {
    const backendPackage = path.join(root, "apps/backend/package.json")
    const storefrontPackage = path.join(root, "apps/storefront/package.json")
    for (const file of [backendPackage, storefrontPackage]) {
      const document = JSON.parse(await readFile(file, "utf8"))
      document.dependencies["@3002tad/funnelmetry-backend-integration-kit"] = "0.2.3"
      await writeFile(file, `${JSON.stringify(document)}\n`)
    }
    const retired = ["apps/storefront/src/funnelmetry/server-delivery.ts", "apps/backend/src/funnelmetry/managed-delivery-dispatcher.ts", "apps/backend/src/funnelmetry/occurred-at.ts", "apps/backend/src/subscribers/funnelmetry-order-placed.ts"]
    for (const file of retired) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "// installer-owned retired file\n") }
    const plan = await createPlan(root, manifest)
    for (const file of retired) assert.ok(plan.changes.some(change => change.path === file))
    assert.doesNotMatch(plan.patch, /createManagedDeliveryDispatcher|sourceEventType/)
    await applyPatch(root, plan.patch)
    assert.equal((await verifyIntegration(root, manifest)).status, "pass")
    for (const file of [backendPackage, storefrontPackage]) assert.equal(JSON.parse(await readFile(file,"utf8")).dependencies["@3002tad/funnelmetry-backend-integration-kit"], undefined)
  })
})
