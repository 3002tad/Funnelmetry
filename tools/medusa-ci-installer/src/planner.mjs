import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const paths = {
  rootPackage: "package.json",
  backendPackage: "apps/backend/package.json",
  storefrontPackage: "apps/storefront/package.json",
  storefrontTsConfig: "apps/storefront/tsconfig.json",
  storefrontLayout: "apps/storefront/src/app/layout.tsx",
  productPage: "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  productActions: "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  checkoutPage: "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
  subscriberDirectory: "apps/backend/src/subscribers",
}

const packageVersions = {
  browserSdk: "0.1.0",
  backendIntegrationKit: "0.1.0",
}

function generatedClient(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const allowedEvents = JSON.stringify(manifest.frontend.events)
  const reliability = JSON.stringify(manifest.reliability)
  return `"use client"\n\nimport { useEffect } from "react"\nimport { createBrowserSdk } from "@funnelmetry/browser-sdk"\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst allowedEventTypes = ${allowedEvents}\nconst reliability = ${reliability}\n\ntype EventPayload = Record<string, unknown>\ntype BrowserSdk = ReturnType<typeof createBrowserSdk>\n\ndeclare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }\n\nlet sdk: BrowserSdk | null | undefined\n\nfunction getSdk(): BrowserSdk | null {\n  if (sdk !== undefined) return sdk\n  try {\n    sdk = createBrowserSdk({\n      sourceId,\n      sourceKeyId,\n      endpoint: process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL ?? "",\n      writeKey: process.env.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY ?? "",\n      allowedEventTypes,\n      maxAttempts: reliability.retry.maxAttempts,\n      maxQueueSize: reliability.maxQueueSize,\n      hasConsent: () => typeof window !== "undefined" && window.__FUNNELMETRY_CONSENT__ === true,\n    })\n  } catch (error) {\n    sdk = null\n    console.warn("Funnelmetry browser integration is inactive", error)\n  }\n  return sdk\n}\n\nfunction track(eventType: string, payload: EventPayload) {\n  const currentSdk = getSdk()\n  return currentSdk ? currentSdk.track(eventType, payload) : Promise.resolve({ status: "inactive" })\n}\n\nexport function FunnelmetryBootstrap() {\n  useEffect(() => getSdk()?.attachLifecycle(), [])\n  return null\n}\n\nexport function FunnelmetryProductViewed({ productId }: { productId: string }) {\n  useEffect(() => { void track("behavior.product_viewed", { product_id: productId }) }, [productId])\n  return null\n}\n\nexport function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {\n  useEffect(() => { void track("checkout.started", { cart_id: cartId, step }) }, [cartId, step])\n  return null\n}\n\nexport function trackCartAddClicked(input: { productId: string; variantId: string; quantity: number }) {\n  return track("cart.add_clicked", { product_id: input.productId, variant_id: input.variantId, quantity: input.quantity })\n}\n`
}

function generatedSubscriber(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const reliability = JSON.stringify(manifest.reliability)
  return `import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"\nimport { createBackendForwarder } from "@funnelmetry/backend-integration-kit"\n\ntype OrderPlacedData = { id: string }\ntype OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: number }\ntype Order = { id: string; created_at?: string; currency_code?: string; total?: number; items?: OrderItem[] }\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst reliability = ${reliability}\n\nexport default async function funnelmetryOrderPlaced({ event, container }: SubscriberArgs<OrderPlacedData>) {\n  const logger = container.resolve("logger") as { warn: (message: string) => void }\n  try {\n    const orderModuleService = container.resolve("order") as { retrieveOrder: (id: string, options: Record<string, unknown>) => Promise<Order> }\n    const order = await orderModuleService.retrieveOrder(event.data.id, { relations: ["items"] })\n    if (!order.created_at || !order.currency_code) throw new Error("Missing authoritative order time/currency")\n    const forwarder = createBackendForwarder({\n      sourceId,\n      sourceKeyId,\n      endpoint: process.env.FUNNELMETRY_INGEST_URL ?? "",\n      signingKey: process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? "",\n      timeoutMs: reliability.timeoutMs,\n      maxAttempts: reliability.retry.maxAttempts,\n      logger: { warn: (entry: unknown) => logger.warn(JSON.stringify(entry)) },\n    })\n    await forwarder.forward({\n      eventId: \`medusa:order.placed:\${event.data.id}\`,\n      sourceEventType: "medusa.order_placed",\n      occurredAt: order.created_at,\n      aggregate: { type: "order", id: order.id },\n      sourcePayload: { order_id: order.id, currency_code: order.currency_code, total_minor: order.total, items: (order.items ?? []).map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: item.unit_price })) },\n    })\n  } catch (error) {\n    logger.warn(\`Funnelmetry order forward failed open: \${error instanceof Error ? error.message : "unknown error"}\`)\n  }\n}\n\nexport const config: SubscriberConfig = { event: "order.placed" }\n`
}

function configureGeneratedClient(content, manifest) {
  return content
    .replace(
      'endpoint: process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL ?? "",',
      `endpoint: ${JSON.stringify(manifest.ingest.url)},`,
    )
    .replace(
      'writeKey: process.env.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY ?? "",',
      // Next.js only inlines public environment variables accessed statically.
      // The manifest validator limits this reference to a safe identifier.
      `writeKey: process.env.NEXT_PUBLIC_${manifest.auth.browserWriteKeyRef} ?? "",`,
    )
}

function configureGeneratedSubscriber(content, manifest) {
  return content
    .replace(
      'endpoint: process.env.FUNNELMETRY_INGEST_URL ?? "",',
      `endpoint: ${JSON.stringify(manifest.ingest.url)},`,
    )
    .replace(
      'signingKey: process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? "",',
      `signingKey: process.env.${manifest.auth.backendSigningKeyRef} ?? "",`,
    )
}

function replaceOnce(content, search, replacement, file) {
  if (!content.includes(search)) throw new Error(`Pinned Medusa layout changed: cannot patch ${file}`)
  return content.replace(search, replacement)
}

function addDependency(content, dependency, version, file) {
  let packageJson
  try {
    packageJson = JSON.parse(content)
  } catch {
    throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`)
  }
  const dependencies = { ...(packageJson.dependencies ?? {}), [dependency]: version }
  return `${JSON.stringify({ ...packageJson, dependencies }, null, 2)}\n`
}

function addFunnelmetryAlias(content, file) {
  let tsConfig
  try {
    tsConfig = JSON.parse(content)
  } catch {
    throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`)
  }
  const compilerOptions = { ...(tsConfig.compilerOptions ?? {}) }
  const paths = { ...(compilerOptions.paths ?? {}), "@funnelmetry/*": ["funnelmetry/*"] }
  return `${JSON.stringify({ ...tsConfig, compilerOptions: { ...compilerOptions, paths } }, null, 2)}\n`
}

function wholeFilePatch(file, before, after) {
  const beforeLines = before === null ? [] : before.replace(/\n$/, "").split("\n")
  const afterLines = after.replace(/\n$/, "").split("\n")
  const header = before === null
    ? `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${afterLines.length} @@\n`
    : `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,${beforeLines.length} +1,${afterLines.length} @@\n`
  const removed = before === null ? [] : beforeLines.map((line) => `-${line}`)
  const added = afterLines.map((line) => `+${line}`)
  return `${header}${[...removed, ...added].join("\n")}\n`
}

async function readProjectFile(projectRoot, relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8")
}

async function assertDirectory(projectRoot, relativePath) {
  const target = path.join(projectRoot, relativePath)
  if (!(await stat(target)).isDirectory()) throw new Error(`Pinned Medusa layout is missing directory ${relativePath}`)
}

export async function inspectMedusa(projectRoot, manifest) {
  await assertDirectory(projectRoot, paths.subscriberDirectory)
  const rootPackage = JSON.parse(await readProjectFile(projectRoot, paths.rootPackage))
  const backendPackage = JSON.parse(await readProjectFile(projectRoot, paths.backendPackage))
  const storefrontPackage = JSON.parse(await readProjectFile(projectRoot, paths.storefrontPackage))
  if (rootPackage.name !== "dtc-starter-monorepo" || !String(rootPackage.packageManager ?? "").startsWith("pnpm@10")) {
    throw new Error("Unsupported host: expected pinned Medusa DTC Starter pnpm workspace")
  }
  const actualMedusa = backendPackage.dependencies?.["@medusajs/medusa"]
  if (actualMedusa !== manifest.host.medusaVersion) {
    throw new Error(`Unsupported Medusa version '${actualMedusa}', expected '${manifest.host.medusaVersion}' from manifest`)
  }
  if (!String(storefrontPackage.dependencies?.next ?? "").startsWith("15.")) {
    throw new Error("Unsupported storefront: expected pinned Next.js 15.x")
  }
  return { actualMedusa, next: storefrontPackage.dependencies.next }
}

export async function createPlan(projectRoot, manifest) {
  const host = await inspectMedusa(projectRoot, manifest)
  const originals = {}
  for (const [name, relativePath] of Object.entries(paths)) {
    if (name === "subscriberDirectory") continue
    originals[relativePath] = await readProjectFile(projectRoot, relativePath)
  }

  const changes = []
  if (manifest.frontend.enabled) {
    const client = configureGeneratedClient(generatedClient(manifest), manifest)
    const storefrontTsConfig = addFunnelmetryAlias(
      originals[paths.storefrontTsConfig],
      paths.storefrontTsConfig,
    )
    const storefrontPackage = addDependency(
      originals[paths.storefrontPackage],
      "@funnelmetry/browser-sdk",
      packageVersions.browserSdk,
      paths.storefrontPackage,
    )
    const layout = replaceOnce(
      originals[paths.storefrontLayout],
      'import "styles/globals.css"',
      'import "styles/globals.css"\nimport { FunnelmetryBootstrap } from "@funnelmetry/client"',
      paths.storefrontLayout,
    ).replace('<body>', '<body>\n        <FunnelmetryBootstrap />')
    const productPage = replaceOnce(
      originals[paths.productPage],
      'import ProductTemplate from "@modules/products/templates"',
      'import ProductTemplate from "@modules/products/templates"\nimport { FunnelmetryProductViewed } from "@funnelmetry/client"',
      paths.productPage,
    ).replace(
      '  return (\n    <ProductTemplate',
      '  return (\n    <>\n      <FunnelmetryProductViewed productId={pricedProduct.id} />\n      <ProductTemplate',
    ).replace(
      '    />\n  )\n}',
      '      />\n    </>\n  )\n}',
    )
    const actions = replaceOnce(
      originals[paths.productActions],
      'import { addToCart } from "@lib/data/cart"',
      'import { addToCart } from "@lib/data/cart"\nimport { trackCartAddClicked } from "@funnelmetry/client"',
      paths.productActions,
    ).replace(
      '    await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })',
      '    void trackCartAddClicked({ productId: product.id, variantId: selectedVariant.id, quantity: 1 })\n\n    await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })',
    )
    const checkout = replaceOnce(
      originals[paths.checkoutPage],
      'import CheckoutProgress from "@modules/checkout/components/checkout-progress"',
      'import CheckoutProgress from "@modules/checkout/components/checkout-progress"\nimport { FunnelmetryCheckoutStarted } from "@funnelmetry/client"',
      paths.checkoutPage,
    ).replace(
      '  return (\n    <div className="content-container py-10 small:py-14">',
      '  return (\n    <>\n      <FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />\n      <div className="content-container py-10 small:py-14">',
    ).replace(
      '    </div>\n  )\n}',
      '      </div>\n    </>\n  )\n}',
    )
    changes.push(
      { path: paths.storefrontTsConfig, before: originals[paths.storefrontTsConfig], after: storefrontTsConfig },
      { path: paths.storefrontPackage, before: originals[paths.storefrontPackage], after: storefrontPackage },
      { path: "apps/storefront/src/funnelmetry/client.tsx", before: null, after: client },
      { path: paths.storefrontLayout, before: originals[paths.storefrontLayout], after: layout },
      { path: paths.productPage, before: originals[paths.productPage], after: productPage },
      { path: paths.productActions, before: originals[paths.productActions], after: actions },
      { path: paths.checkoutPage, before: originals[paths.checkoutPage], after: checkout },
    )
  }
  if (manifest.backend.enabled) {
    const subscriber = configureGeneratedSubscriber(generatedSubscriber(manifest), manifest)
    const backendPackage = addDependency(
      originals[paths.backendPackage],
      "@funnelmetry/backend-integration-kit",
      packageVersions.backendIntegrationKit,
      paths.backendPackage,
    )
    changes.push(
      { path: paths.backendPackage, before: originals[paths.backendPackage], after: backendPackage },
      { path: "apps/backend/src/subscribers/funnelmetry-order-placed.ts", before: null, after: subscriber },
    )
  }

  const fingerprint = createHash("sha256")
  for (const relativePath of Object.keys(originals).sort()) {
    fingerprint.update(relativePath).update("\0").update(originals[relativePath])
  }
  return {
    schemaVersion: "funnelmetry-ci-plan.v1",
    mode: "plan-only",
    sourceMutation: false,
    host,
    manifest,
    sourceFingerprint: fingerprint.digest("hex"),
    capabilities: {
      behavior: manifest.frontend.enabled ? "ENABLED" : "DISABLED",
      orderPlaced: manifest.backend.enabled ? "ENABLED" : "DISABLED",
      cartItemPersisted: "NOT_SUPPORTED",
      orderCreated: manifest.backend.enabled ? "ENABLED" : "DISABLED",
      orderAccepted: "NOT_SUPPORTED",
      commerceConversion: "IN_PROGRESS",
      payment: "NOT_REQUESTED",
      refund: "NOT_REQUESTED",
    },
    changes: changes.map(({ path: file }) => ({ path: file, ownership: "funnelmetry-installer" })),
    patch: changes.map(({ path: file, before, after }) => wholeFilePatch(file, before, after)).join(""),
  }
}
