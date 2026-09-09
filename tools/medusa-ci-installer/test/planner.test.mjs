import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { validateManifest } from "../src/manifest.mjs"
import { createPlan } from "../src/planner.mjs"

const manifest = validateManifest({
  apiVersion: "funnelmetry.io/v1",
  kind: "InputIntegration",
  host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
  source: { id: "medusa-reference" },
  ingest: {
    browser_url: "https://browser-ingest.example.test/v1/ingress/events",
    backend_url: "https://backend-ingest.example.test/v1/ingress/events",
  },
  auth: {
    source_key_id: "medusa-reference-dev",
    browser_write_key_ref: "FUNNELMETRY_BROWSER_WRITE_KEY",
    backend_signing_key_ref: "FUNNELMETRY_BACKEND_SIGNING_KEY",
  },
  frontend: { enabled: true, events: ["behavior.product_viewed", "cart.add_clicked", "checkout.started"] },
  backend: { enabled: true, binding: "medusa.order_placed" },
})

const fixtureRoot = fileURLToPath(new URL("./fixtures/medusa-dtc/", import.meta.url))
const fixtureFiles = [
  "package.json",
  "apps/backend/package.json",
  "apps/storefront/package.json",
  "apps/storefront/tsconfig.json",
  "apps/storefront/src/app/layout.tsx",
  "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
]

async function applyWholeFilePatch(projectRoot, patch) {
  for (const section of patch.split(/(?=diff --git )/)) {
    const match = section.match(/^diff --git a\/(.+) b\/\1/m)
    if (!match) continue
    const output = section
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n")
    const target = path.join(projectRoot, match[1])
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, `${output}\n`)
  }
}

test("planner creates PR-ready artifacts without mutating the Medusa checkout", async () => {
  const before = await Promise.all(fixtureFiles.map(async (file) => [file, await readFile(path.join(fixtureRoot, file), "utf8")]))
  const plan = await createPlan(fixtureRoot, manifest)
  const after = await Promise.all(fixtureFiles.map(async (file) => [file, await readFile(path.join(fixtureRoot, file), "utf8")]))

  assert.deepEqual(after, before)
  assert.equal(plan.sourceMutation, false)
  assert.equal(plan.mode, "plan-only")
  assert.equal(plan.capabilities.behavior, "ENABLED")
  assert.equal(plan.capabilities.orderPlaced, "ENABLED")
  assert.equal(plan.capabilities.orderCreated, "ENABLED")
  assert.equal(plan.capabilities.cartItemPersisted, "NOT_SUPPORTED")
  assert.equal(plan.capabilities.orderAccepted, "NOT_SUPPORTED")
  assert.equal(plan.capabilities.commerceConversion, "IN_PROGRESS")
  assert.match(plan.patch, /apps\/backend\/src\/subscribers\/funnelmetry-order-placed\.ts/)
  assert.match(plan.patch, /apps\/backend\/src\/funnelmetry\/managed-delivery-dispatcher\.ts/)
  assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/client\.tsx/)
  assert.match(plan.patch, /FunnelmetryCheckoutStarted/)
  assert.match(plan.patch, /"behavior\.product_viewed"/)
  assert.match(plan.patch, /"cart\.add_clicked"/)
  assert.match(plan.patch, /"checkout\.started"/)
  assert.match(plan.patch, /sourceEventType: "medusa\.order_placed"/)
  assert.match(plan.patch, /void trackCartAddClicked\([\s\S]*?await addToCart/)
  assert.doesNotMatch(plan.patch, /commerce\.cart\.item_added/)
  assert.match(plan.patch, /"@3002tad\/funnelmetry-browser-sdk": "0\.1\.0"/)
  assert.match(plan.patch, /"@funnelmetry\/\*"/)
  assert.match(plan.patch, /"funnelmetry\/\*"/)
  assert.match(plan.patch, /"@3002tad\/funnelmetry-backend-integration-kit": "0\.1\.0"/)
  assert.match(plan.patch, /createBrowserSdk/)
  assert.match(plan.patch, /createBackendForwarder/)
  assert.match(plan.patch, /createManagedDeliveryDispatcher/)
  assert.match(plan.patch, /export default async function funnelmetryOrderPlaced/)
  assert.match(plan.patch, /void enqueueOrderPlaced/)
  assert.match(plan.patch, /circuitOpened/)
  assert.match(plan.patch, /droppedQueueFull/)
  assert.match(plan.patch, /@3002tad\/funnelmetry-browser-sdk/)
  assert.match(plan.patch, /@3002tad\/funnelmetry-backend-integration-kit/)
  assert.match(plan.patch, /await import\("@3002tad\/funnelmetry-backend-integration-kit"\)/)
  assert.match(plan.patch, /ContainerRegistrationKeys\.LOGGER/)
  assert.match(plan.patch, /Modules\.ORDER/)
  assert.match(plan.patch, /track\("behavior\.product_viewed"/)
  assert.match(plan.patch, /track\("cart\.add_clicked"/)
  assert.match(plan.patch, /track\("checkout\.started"/)
  assert.doesNotMatch(plan.patch, /commerce\.cart\.item_added/)
  assert.match(plan.patch, /endpoint: "https:\/\/browser-ingest\.example\.test\/v1\/ingress\/events"/)
  assert.match(plan.patch, /endpoint: "https:\/\/backend-ingest\.example\.test\/v1\/ingress\/events"/)
  assert.match(plan.patch, /process\.env\.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY/)
  assert.match(plan.patch, /process\.env\.FUNNELMETRY_BACKEND_SIGNING_KEY/)
  assert.doesNotMatch(plan.patch, /process\.env\[/)
  assert.doesNotMatch(plan.patch, /createHmac/)
})

test("manifest rejects a browser secret reference that looks like a secret value", () => {
  const bad = structuredClone(manifest)
  bad.auth.browserWriteKeyRef = undefined
  assert.throws(() => validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { browser_url: "https://ingest.example.test" },
    auth: { source_key_id: "source", browser_write_key_ref: "not-a-secret-reference" },
    frontend: { enabled: true, events: ["behavior.product_viewed"] },
    backend: { enabled: false },
}), /environment\/secret reference/)
})

test("manifest only accepts fail-open reliability settings", () => {
  assert.throws(() => validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { browser_url: "https://ingest.example.test" },
    auth: { source_key_id: "source", browser_write_key_ref: "FUNNELMETRY_BROWSER_WRITE_KEY" },
    frontend: { enabled: true, events: ["behavior.product_viewed"] },
    backend: { enabled: false },
    reliability: { failure_mode: "fail_closed" },
  }), /fail_open/)
})

test("manifest normalizes a bounded circuit breaker for managed backend delivery", () => {
  assert.deepEqual(manifest.reliability.circuitBreaker, {
    failureThreshold: 3,
    cooldownMs: 30000,
  })

  assert.throws(() => validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { browser_url: "https://ingest.example.test" },
    auth: { source_key_id: "source", browser_write_key_ref: "FUNNELMETRY_BROWSER_WRITE_KEY" },
    frontend: { enabled: true, events: ["behavior.product_viewed"] },
    backend: { enabled: false },
    reliability: { circuit_breaker: { failure_threshold: 0 } },
  }), /circuit_breaker\.failure_threshold must be a positive integer/)
})

test("planner emits a static Next.js public-key reference from the manifest", async () => {
  const configured = structuredClone(manifest)
  configured.auth.browserWriteKeyRef = "FUNNELMETRY_ALT_BROWSER_WRITE_KEY"

  const plan = await createPlan(fixtureRoot, configured)

  assert.match(plan.patch, /process\.env\.NEXT_PUBLIC_FUNNELMETRY_ALT_BROWSER_WRITE_KEY/)
  assert.doesNotMatch(plan.patch, /process\.env\[/)
})

test("manifest requires only the endpoint used by each enabled binding", () => {
  const browserOnly = validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { browser_url: "https://browser-ingest.example.test" },
    auth: { source_key_id: "source", browser_write_key_ref: "FUNNELMETRY_BROWSER_WRITE_KEY" },
    frontend: { enabled: true, events: ["behavior.product_viewed"] },
    backend: { enabled: false },
  })
  assert.equal(browserOnly.ingest.browserUrl, "https://browser-ingest.example.test")
  assert.equal(browserOnly.ingest.backendUrl, undefined)

  assert.throws(() => validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { browser_url: "https://browser-ingest.example.test" },
    auth: { source_key_id: "source", backend_signing_key_ref: "FUNNELMETRY_BACKEND_SIGNING_KEY" },
    frontend: { enabled: false },
    backend: { enabled: true, binding: "medusa.order_placed" },
  }), /ingest\.backend_url is required/)
})

test("planner returns an empty patch when the exact generated binding already exists", async (t) => {
  let temporaryRoot
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "funnelmetry-medusa-plan-"))
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("The sandbox does not permit temporary-directory writes")
      return
    }
    throw error
  }
  try {
    await cp(fixtureRoot, temporaryRoot, { recursive: true })
    const initial = await createPlan(temporaryRoot, manifest)
    await applyWholeFilePatch(temporaryRoot, initial.patch)
    for (const generatedFile of [
      "apps/storefront/src/funnelmetry/client.tsx",
      "apps/backend/src/funnelmetry/managed-delivery-dispatcher.ts",
      "apps/backend/src/subscribers/funnelmetry-order-placed.ts",
    ]) {
      const target = path.join(temporaryRoot, generatedFile)
      await writeFile(target, (await readFile(target, "utf8")).replace(/\n/g, "\r\n"))
    }

    const rerun = await createPlan(temporaryRoot, manifest)

    assert.deepEqual(rerun.changes, [])
    assert.equal(rerun.patch, "")
    const tsConfig = JSON.parse(await readFile(path.join(temporaryRoot, "apps/storefront/tsconfig.json"), "utf8"))
    assert.deepEqual(tsConfig.compilerOptions.paths["@funnelmetry/*"], ["funnelmetry/*"])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
