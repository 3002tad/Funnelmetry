import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const paths = {
  rootPackage: "package.json",
  backendPackage: "apps/backend/package.json",
  storefrontPackage: "apps/storefront/package.json",
  storefrontLayout: "apps/storefront/src/app/layout.tsx",
  productPage: "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  productActions: "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  checkoutPage: "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
  subscriberDirectory: "apps/backend/src/subscribers",
}

function generatedClient(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const allowedEvents = JSON.stringify(manifest.frontend.events)
  return `"use client"\n\nimport { useEffect } from "react"\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst allowedEvents = new Set(${allowedEvents})\nconst endpoint = process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL\nconst writeKey = process.env.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY\nconst maxAttempts = 3\nconst maxQueueSize = 200\n\ntype EventPayload = Record<string, unknown>\ntype Envelope = { specversion: string; source_id: string; source_event_id: string; event_type: string; occurred_at: string; producer: string; payload: EventPayload }\n\ndeclare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }\n\nconst queue: Envelope[] = []\nlet flushing = false\nconst sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))\n\nfunction hasConsent() { return typeof window !== "undefined" && window.__FUNNELMETRY_CONSENT__ === true }\n\nasync function deliver(envelope: Envelope): Promise<boolean> {\n  if (!endpoint || !writeKey || !hasConsent()) return true\n  const body = JSON.stringify(envelope)\n  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {\n    try {\n      const response = await fetch(endpoint, {\n        method: "POST", keepalive: true,\n        headers: { "content-type": "application/json", "x-funnelmetry-source-key-id": sourceKeyId, "x-funnelmetry-write-key": writeKey },\n        body,\n      })\n      if (response.ok || (response.status >= 400 && response.status < 500)) return true\n    } catch { /* fail-open: retry below, never block storefront */ }\n    await sleep(100 * (attempt + 1))\n  }\n  return false\n}\n\nasync function flush() {\n  if (flushing) return\n  flushing = true\n  while (queue.length) {\n    const delivered = await deliver(queue[0])\n    queue.shift() // bounded queue: exhausted delivery is observable at gateway/client metrics, never blocks commerce\n    if (!delivered) continue\n  }\n  flushing = false\n}\n\nfunction send(eventType: string, payload: EventPayload) {\n  if (!allowedEvents.has(eventType)) return Promise.resolve()\n  const envelope: Envelope = {\n    specversion: "ingress-event.v1", source_id: sourceId,\n    source_event_id: \`browser:\${crypto.randomUUID()}\`, event_type,\n    occurred_at: new Date().toISOString(), producer: "browser_sdk", payload,\n  }\n  if (queue.length >= maxQueueSize) queue.shift()\n  queue.push(envelope)\n  return flush()\n}\n\nexport function FunnelmetryBootstrap() { return null }\n\nexport function FunnelmetryProductViewed({ productId }: { productId: string }) {\n  useEffect(() => { void send("commerce.product.viewed", { product_id: productId }) }, [productId])\n  return null\n}\n\nexport function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {\n  useEffect(() => { void send("commerce.checkout.started", { cart_id: cartId, step }) }, [cartId, step])\n  return null\n}\n\nexport function trackCartItemAdded(input: { productId: string; variantId: string; quantity: number }) {\n  return send("commerce.cart.item_added", { product_id: input.productId, variant_id: input.variantId, quantity: input.quantity })\n}\n`
}

function generatedSubscriber(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  return `import { createHmac, randomUUID } from "node:crypto"\nimport type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"\n\ntype OrderPlacedData = { id: string }\ntype OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: number }\ntype Order = { id: string; created_at?: string; currency_code?: string; total?: number; items?: OrderItem[] }\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\n\nexport default async function funnelmetryOrderPlaced({ event, container }: SubscriberArgs<OrderPlacedData>) {\n  const logger = container.resolve("logger") as { warn: (message: string) => void }\n  try {\n    const orderModuleService = container.resolve("order") as { retrieveOrder: (id: string, options: Record<string, unknown>) => Promise<Order> }\n    const order = await orderModuleService.retrieveOrder(event.data.id, { relations: ["items"] })\n    if (!order.created_at || !order.currency_code) throw new Error("Missing authoritative order time/currency")\n    const endpoint = process.env.FUNNELMETRY_INGEST_URL\n    const signingKey = process.env.FUNNELMETRY_BACKEND_SIGNING_KEY\n    if (!endpoint || !signingKey) throw new Error("Funnelmetry backend integration is not configured")\n    const body = JSON.stringify({\n      specversion: "ingress-event.v1", source_id: sourceId,\n      source_event_id: \`medusa:order.placed:\${event.data.id}\`, event_type: "commerce.order.placed",\n      occurred_at: order.created_at, producer: "source_bridge",\n      payload: { order_id: order.id, currency_code: order.currency_code, total_minor: order.total, items: (order.items ?? []).map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: item.unit_price })) },\n    })\n    const timestamp = String(Date.now())\n    const signature = createHmac("sha256", signingKey).update(\`\${timestamp}.\${body}\`).digest("hex")\n    for (let attempt = 0; attempt < 3; attempt += 1) {\n      try {\n        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-funnelmetry-source-key-id": sourceKeyId, "x-funnelmetry-timestamp": timestamp, "x-funnelmetry-signature": signature, "x-funnelmetry-request-id": randomUUID() }, body, signal: AbortSignal.timeout(800) })\n        if (response.ok || (response.status >= 400 && response.status < 500)) return\n      } catch { /* fail-open: retry below */ }\n      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))\n    }\n    throw new Error("Funnelmetry delivery exhausted bounded retries")\n  } catch (error) {\n    logger.warn(\`Funnelmetry order forward failed open: \${error instanceof Error ? error.message : "unknown error"}\`)\n  }\n}\n\nexport const config: SubscriberConfig = { event: "order.placed" }\n`
}

function replaceOnce(content, search, replacement, file) {
  if (!content.includes(search)) throw new Error(`Pinned Medusa layout changed: cannot patch ${file}`)
  return content.replace(search, replacement)
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
      'import { addToCart } from "@lib/data/cart"\nimport { trackCartItemAdded } from "@funnelmetry/client"',
      paths.productActions,
    ).replace(
      '    await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })',
      '    await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })\n\n    void trackCartItemAdded({ productId: product.id, variantId: selectedVariant.id, quantity: 1 })',
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
      { path: "apps/storefront/src/funnelmetry/client.tsx", before: null, after: generatedClient(manifest) },
      { path: paths.storefrontLayout, before: originals[paths.storefrontLayout], after: layout },
      { path: paths.productPage, before: originals[paths.productPage], after: productPage },
      { path: paths.productActions, before: originals[paths.productActions], after: actions },
      { path: paths.checkoutPage, before: originals[paths.checkoutPage], after: checkout },
    )
  }
  if (manifest.backend.enabled) {
    changes.push({ path: "apps/backend/src/subscribers/funnelmetry-order-placed.ts", before: null, after: generatedSubscriber(manifest) })
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
      payment: "NOT_REQUESTED",
      refund: "NOT_REQUESTED",
    },
    changes: changes.map(({ path: file }) => ({ path: file, ownership: "funnelmetry-installer" })),
    patch: changes.map(({ path: file, before, after }) => wholeFilePatch(file, before, after)).join(""),
  }
}
