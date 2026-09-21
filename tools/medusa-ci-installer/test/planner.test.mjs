import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { validateManifest } from "../src/manifest.mjs"
import { createPlan } from "../src/planner.mjs"

const rawManifest = {
  apiVersion: "funnelmetry.io/v2",
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
  bindings: {
    browser: [
      "behavior.page_viewed",
      "behavior.scroll_depth_reached",
      "promotion.banner_impression",
      "promotion.banner_clicked",
      "behavior.filter_applied",
      "behavior.product_viewed",
      "checkout.started",
    ],
    storefront_server: ["behavior.search_submitted", "cart.item_added"],
    medusa_backend: ["medusa.order_placed"],
  },
}
const manifest = validateManifest(rawManifest)

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
  assert.deepEqual(plan.manifest.bindings.storefrontServer, ["behavior.search_submitted", "cart.item_added"])
  assert.deepEqual(plan.manifest.bindings.medusaBackend, ["medusa.order_placed"])
  assert.equal(plan.capabilities.behavior, "ENABLED")
  assert.equal(plan.capabilities.orderPlaced, "ENABLED")
  assert.equal(plan.capabilities.orderCreated, "ENABLED")
  assert.equal(plan.capabilities.cartItemPersisted, "NOT_SUPPORTED")
  assert.equal(plan.capabilities.orderAccepted, "NOT_SUPPORTED")
  assert.equal(plan.capabilities.commerceConversion, "IN_PROGRESS")
  assert.match(plan.patch, /apps\/backend\/src\/subscribers\/funnelmetry-order-placed\.ts/)
  assert.match(plan.patch, /apps\/backend\/src\/funnelmetry\/managed-delivery-dispatcher\.ts/)
  assert.match(plan.patch, /apps\/backend\/src\/funnelmetry\/occurred-at\.ts/)
  assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/client\.tsx/)
  assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/consent-notice\.tsx/)
  assert.match(plan.patch, /apps\/storefront\/src\/funnelmetry\/server-delivery\.ts/)
  assert.match(plan.patch, /FunnelmetryCheckoutStarted/)
  assert.match(plan.patch, /"behavior\.product_viewed"/)
  assert.match(plan.patch, /"behavior\.page_viewed"/)
  assert.match(plan.patch, /"behavior\.scroll_depth_reached"/)
  assert.match(plan.patch, /"promotion\.banner_impression"/)
  assert.match(plan.patch, /"promotion\.banner_clicked"/)
  assert.match(plan.patch, /"behavior\.filter_applied"/)
  assert.match(plan.patch, /"checkout\.started"/)
  assert.match(plan.patch, /sourceEventType: "medusa\.order_placed"/)
  assert.doesNotMatch(plan.patch, /commerce\.cart\.item_added/)
  assert.match(plan.patch, /"@3002tad\/funnelmetry-browser-sdk": "0\.2\.2"/)
  assert.match(plan.patch, /"@funnelmetry\/\*"/)
  assert.match(plan.patch, /"funnelmetry\/\*"/)
  assert.match(plan.patch, /"@3002tad\/funnelmetry-backend-integration-kit": "0\.2\.2"/)
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
  assert.match(plan.patch, /trackPageView/)
  assert.match(plan.patch, /attachScrollDepthObserver/)
  assert.match(plan.patch, /FunnelmetryPromotionBanner/)
  assert.match(plan.patch, /trackFilterApplied/)
  assert.match(plan.patch, /trackBehaviorOnce\(`checkout\.started:\$\{cartId\}`/)
  assert.match(plan.patch, /step: "address"/)
  assert.doesNotMatch(plan.patch, /step=\{currentStep\}/)
  assert.doesNotMatch(plan.patch, /cart\.add_clicked/)
  assert.doesNotMatch(plan.patch, /trackCartAddClicked/)
  assert.match(plan.patch, /sourceEventType: "behavior\.search_submitted"/)
  assert.doesNotMatch(plan.patch, /trackSearchSubmitted/)
  assert.doesNotMatch(plan.patch, /query_length_bucket/)
  assert.match(plan.patch, /sourceEventType: "cart\.item_added"/)
  assert.match(plan.patch, /normalizeSearchQuery/)
  assert.match(plan.patch, /FunnelmetryConsentNotice/)
  assert.match(plan.patch, /normalizeOccurredAt/)
  assert.doesNotMatch(plan.patch, /commerce\.cart\.item_added/)
  assert.match(plan.patch, /endpoint: "https:\/\/browser-ingest\.example\.test\/v1\/ingress\/events"/)
  assert.match(plan.patch, /endpoint: "https:\/\/backend-ingest\.example\.test\/v1\/ingress\/events"/)
  assert.match(plan.patch, /process\.env\.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY/)
  assert.match(plan.patch, /process\.env\.FUNNELMETRY_BACKEND_SIGNING_KEY/)
  assert.doesNotMatch(plan.patch, /process\.env\[/)
  assert.doesNotMatch(plan.patch, /createHmac/)
})

test("manifest rejects a browser secret reference that looks like a secret value", () => {
  const bad = structuredClone(rawManifest)
  bad.auth.browser_write_key_ref = "not-a-secret-reference"
  assert.throws(() => validateManifest(bad), /environment\/secret reference/)
})

test("manifest only accepts fail-open reliability settings", () => {
  const bad = structuredClone(rawManifest)
  bad.reliability = { failure_mode: "fail_closed" }
  assert.throws(() => validateManifest(bad), /fail_open/)
})

test("manifest normalizes a bounded circuit breaker for managed backend delivery", () => {
  assert.deepEqual(manifest.reliability.circuitBreaker, {
    failureThreshold: 3,
    cooldownMs: 30000,
  })

  const bad = structuredClone(rawManifest)
  bad.reliability = { circuit_breaker: { failure_threshold: 0 } }
  assert.throws(() => validateManifest(bad), /circuit_breaker\.failure_threshold must be a positive integer/)
})

test("planner emits a static Next.js public-key reference from the manifest", async () => {
  const configured = structuredClone(manifest)
  configured.auth.browserWriteKeyRef = "FUNNELMETRY_ALT_BROWSER_WRITE_KEY"

  const plan = await createPlan(fixtureRoot, configured)

  assert.match(plan.patch, /process\.env\.NEXT_PUBLIC_FUNNELMETRY_ALT_BROWSER_WRITE_KEY/)
  assert.doesNotMatch(plan.patch, /process\.env\[/)
})

test("manifest requires every explicit Medusa V2 binding and endpoint", () => {
  const missingCart = structuredClone(rawManifest)
  missingCart.bindings.storefront_server = ["behavior.search_submitted"]
  assert.throws(() => validateManifest(missingCart), /missing required binding\(s\): cart\.item_added/)

  const missingBackendUrl = structuredClone(rawManifest)
  delete missingBackendUrl.ingest.backend_url
  assert.throws(() => validateManifest(missingBackendUrl), /ingest\.backend_url is required/)

  const unknownBackend = structuredClone(rawManifest)
  unknownBackend.bindings.medusa_backend = ["payment.captured"]
  assert.throws(() => validateManifest(unknownBackend), /Unsupported bindings\.medusa_backend binding/)
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

test("planner refreshes managed files when manifest configuration changes", async (t) => {
  let temporaryRoot
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "funnelmetry-medusa-config-refresh-"))
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

    const changedRaw = structuredClone(rawManifest)
    changedRaw.ingest.backend_url = "http://source-ingress:32000/v1/ingress/events"
    changedRaw.bindings.browser = changedRaw.bindings.browser.filter((event) => event !== "promotion.banner_clicked")
    const refresh = await createPlan(temporaryRoot, validateManifest(changedRaw))

    assert.equal(refresh.integrationState, "v2-compatible")
    assert.ok(refresh.changes.some((change) => change.path === "apps/storefront/src/funnelmetry/client.tsx"))
    assert.ok(refresh.changes.some((change) => change.path === "apps/backend/src/subscribers/funnelmetry-order-placed.ts"))
    assert.match(refresh.patch, /http:\/\/source-ingress:32000\/v1\/ingress\/events/)
    assert.match(refresh.patch, /^\+const allowedEventTypes = \["behavior\.page_viewed","behavior\.scroll_depth_reached","promotion\.banner_impression","behavior\.filter_applied"/m)
    assert.ok(!refresh.changes.some((change) => change.path === "apps/storefront/src/lib/data/cart.ts"))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("planner upgrades the prior V2 checkout binding without reapplying host hooks", async (t) => {
  let temporaryRoot
  try {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "funnelmetry-medusa-checkout-upgrade-"))
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

    const browserClientPath = path.join(temporaryRoot, "apps/storefront/src/funnelmetry/client.tsx")
    const browserClient = await readFile(browserClientPath, "utf8")
    const modernCheckoutBinding = `export function FunnelmetryCheckoutStarted({ cartId }: { cartId: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    const currentSdk = getSdk()
    if (!currentSdk || !page || !enabled("checkout.started")) return
    void currentSdk.trackBehaviorOnce(\`checkout.started:\${cartId}\`, "checkout.started", { cart_id: cartId, step: "address", page_instance_id: page.page_instance_id })
  }, [cartId, pathname])
  return null
}`
    const legacyCheckoutBinding = `export function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    void track("checkout.started", { cart_id: cartId, step, ...(page ? { page_instance_id: page.page_instance_id } : {}) })
  }, [cartId, pathname, step])
  return null
}`
    assert.ok(browserClient.includes(modernCheckoutBinding))
    await writeFile(browserClientPath, browserClient.replace(modernCheckoutBinding, legacyCheckoutBinding))

    const checkoutPath = path.join(temporaryRoot, "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx")
    await writeFile(
      checkoutPath,
      (await readFile(checkoutPath, "utf8")).replace(
        "<FunnelmetryCheckoutStarted cartId={cart.id} />",
        "<FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />",
      ),
    )
    const storefrontPackagePath = path.join(temporaryRoot, "apps/storefront/package.json")
    await writeFile(
      storefrontPackagePath,
      (await readFile(storefrontPackagePath, "utf8")).replace('"@3002tad/funnelmetry-browser-sdk": "0.2.2"', '"@3002tad/funnelmetry-browser-sdk": "0.2.0"'),
    )

    const upgrade = await createPlan(temporaryRoot, manifest)

    assert.equal(upgrade.integrationState, "upgradeable")
    assert.ok(upgrade.changes.some((change) => change.path.endsWith("checkout/page.tsx")))
    assert.match(upgrade.patch, /trackBehaviorOnce\(`checkout\.started:\$\{cartId\}`/)
    assert.match(upgrade.patch, /<FunnelmetryCheckoutStarted cartId=\{cart\.id\} \/>/)
    assert.doesNotMatch(upgrade.patch, /^\+.*step=\{currentStep\}/m)
    assert.ok(!upgrade.changes.some((change) => change.path === "apps/storefront/src/lib/data/cart.ts"))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
