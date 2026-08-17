import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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
  ingest: { url: "https://ingest.example.test/v1/ingress/events" },
  auth: {
    source_key_id: "medusa-reference-dev",
    browser_write_key_ref: "FUNNELMETRY_BROWSER_WRITE_KEY",
    backend_signing_key_ref: "FUNNELMETRY_BACKEND_SIGNING_KEY",
  },
  frontend: { enabled: true, events: ["commerce.product.viewed", "commerce.cart.item_added", "commerce.checkout.started"] },
  backend: { enabled: true, binding: "medusa.order_placed" },
})

const fixtureRoot = fileURLToPath(new URL("./fixtures/medusa-dtc/", import.meta.url))
const fixtureFiles = [
  "package.json",
  "apps/backend/package.json",
  "apps/storefront/package.json",
  "apps/storefront/src/app/layout.tsx",
  "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
]

test("planner creates PR-ready artifacts without mutating the Medusa checkout", async () => {
  const before = await Promise.all(fixtureFiles.map(async (file) => [file, await readFile(path.join(fixtureRoot, file), "utf8")]))
  const plan = await createPlan(fixtureRoot, manifest)
  const after = await Promise.all(fixtureFiles.map(async (file) => [file, await readFile(path.join(fixtureRoot, file), "utf8")]))

  assert.deepEqual(after, before)
  assert.equal(plan.sourceMutation, false)
  assert.equal(plan.mode, "plan-only")
  assert.equal(plan.capabilities.behavior, "ENABLED")
  assert.equal(plan.capabilities.orderPlaced, "ENABLED")
  assert.match(plan.patch, /apps\/backend\/src\/subscribers\/funnelmetry-order-placed\.ts/)
  assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/client\.tsx/)
  assert.match(plan.patch, /FunnelmetryCheckoutStarted/)
})

test("manifest rejects a browser secret reference that looks like a secret value", () => {
  const bad = structuredClone(manifest)
  bad.auth.browserWriteKeyRef = undefined
  assert.throws(() => validateManifest({
    apiVersion: "funnelmetry.io/v1",
    kind: "InputIntegration",
    host: { type: "medusa-v2-dtc-starter", medusa_version: "2.19.0" },
    source: { id: "medusa-reference" },
    ingest: { url: "https://ingest.example.test" },
    auth: { source_key_id: "source", browser_write_key_ref: "not-a-secret-reference" },
    frontend: { enabled: true, events: ["commerce.product.viewed"] },
    backend: { enabled: false },
  }), /environment\/secret reference/)
})
