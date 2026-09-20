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

const generatedPaths = {
  browserClient: "apps/storefront/src/funnelmetry/client.tsx",
  managedDeliveryDispatcher: "apps/backend/src/funnelmetry/managed-delivery-dispatcher.ts",
  orderPlacedSubscriber: "apps/backend/src/subscribers/funnelmetry-order-placed.ts",
}

const packageVersions = {
  browserSdk: "0.2.0",
  backendIntegrationKit: "0.2.0",
}

function generatedClient(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const allowedEvents = JSON.stringify(manifest.frontend.events)
  const reliability = JSON.stringify(manifest.reliability)
  return `"use client"\n\nimport { useEffect, useRef, type ReactNode } from "react"\nimport { usePathname } from "next/navigation"\nimport { createBrowserSdk } from "@funnelmetry/browser-sdk"\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst allowedEventTypes = ${allowedEvents}\nconst reliability = ${reliability}\n\ntype EventPayload = Record<string, unknown>\ntype BrowserSdk = ReturnType<typeof createBrowserSdk>\ntype PageContext = { page_type: string; path_template: string; page_instance_id: string }\n\ndeclare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }\n\nlet sdk: BrowserSdk | null | undefined\nlet activePage: { pathname: string; context: PageContext } | undefined\n\nfunction enabled(eventType: string) {\n  return allowedEventTypes.includes(eventType)\n}\n\nfunction getSdk(): BrowserSdk | null {\n  if (sdk !== undefined) return sdk\n  try {\n    sdk = createBrowserSdk({\n      sourceId,\n      sourceKeyId,\n      endpoint: process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL ?? "",\n      writeKey: process.env.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY ?? "",\n      allowedEventTypes,\n      maxAttempts: reliability.retry.maxAttempts,\n      maxQueueSize: reliability.maxQueueSize,\n      hasConsent: () => typeof window !== "undefined" && window.__FUNNELMETRY_CONSENT__ === true,\n    })\n  } catch (error) {\n    sdk = null\n    console.warn("Funnelmetry browser integration is inactive", error)\n  }\n  return sdk\n}\n\nfunction pageDescriptor(pathname: string | null) {\n  const safePathname = pathname || "/"\n  const segments = safePathname.split("/").filter(Boolean)\n  const route = segments.length > 0 ? segments.slice(1) : []\n  if (route.length === 0) return { page_type: "home", path_template: "/{countryCode}" }\n  if (route[0] === "store") return { page_type: "catalog", path_template: "/{countryCode}/store" }\n  if (route[0] === "products") return { page_type: "product", path_template: "/{countryCode}/products/{handle}" }\n  if (route[0] === "checkout") return { page_type: "checkout", path_template: "/{countryCode}/checkout" }\n  if (route[0] === "categories") return { page_type: "category", path_template: "/{countryCode}/categories/{category}" }\n  if (route[0] === "collections") return { page_type: "collection", path_template: "/{countryCode}/collections/{handle}" }\n  if (route[0] === "cart") return { page_type: "cart", path_template: "/{countryCode}/cart" }\n  if (route[0] === "account") return { page_type: "account", path_template: "/{countryCode}/account" }\n  return { page_type: "other", path_template: "/{countryCode}/other" }\n}\n\nfunction pageContext(pathname: string | null): PageContext | null {\n  const key = pathname || "/"\n  if (activePage?.pathname === key) return activePage.context\n  const currentSdk = getSdk()\n  if (!currentSdk) return null\n  activePage = { pathname: key, context: currentSdk.createPageContext(pageDescriptor(pathname)) }\n  return activePage.context\n}\n\nfunction activePageContext() {\n  return pageContext(typeof window === "undefined" ? null : window.location.pathname)\n}\n\nfunction track(eventType: string, payload: EventPayload) {\n  if (!enabled(eventType)) return Promise.resolve({ status: "disabled_by_manifest" })\n  const currentSdk = getSdk()\n  return currentSdk ? currentSdk.trackBehavior(eventType, payload) : Promise.resolve({ status: "inactive" })\n}\n\nfunction queryLengthBucket(length: number) {\n  if (length === 0) return "empty"\n  if (length <= 2) return "1-2"\n  if (length <= 5) return "3-5"\n  if (length <= 10) return "6-10"\n  if (length <= 20) return "11-20"\n  return "21+"\n}\n\nexport function FunnelmetryBootstrap() {\n  const pathname = usePathname()\n\n  useEffect(() => getSdk()?.attachLifecycle(), [])\n\n  useEffect(() => {\n    const currentSdk = getSdk()\n    const page = pageContext(pathname)\n    if (!currentSdk || !page) return\n    if (enabled("behavior.page_viewed")) void currentSdk.trackPageView(page)\n    if (!enabled("behavior.scroll_depth_reached")) return\n    return currentSdk.attachScrollDepthObserver({ page })\n  }, [pathname])\n\n  return null\n}\n\nexport function FunnelmetryProductViewed({ productId, variantId }: { productId: string; variantId?: string }) {\n  const pathname = usePathname()\n  useEffect(() => {\n    const page = pageContext(pathname)\n    if (!page) return\n    void track("behavior.product_viewed", { product_id: productId, ...(variantId ? { variant_id: variantId } : {}), page_instance_id: page.page_instance_id })\n  }, [pathname, productId, variantId])\n  return null\n}\n\nexport function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {\n  const pathname = usePathname()\n  useEffect(() => {\n    const page = pageContext(pathname)\n    void track("checkout.started", { cart_id: cartId, step, ...(page ? { page_instance_id: page.page_instance_id } : {}) })\n  }, [cartId, pathname, step])\n  return null\n}\n\nexport function trackCartAddClicked(input: { productId: string; variantId: string; quantity: number; cartId?: string }) {\n  const page = activePageContext()\n  return track("cart.add_clicked", { product_id: input.productId, variant_id: input.variantId, quantity: input.quantity, ...(input.cartId ? { cart_id: input.cartId } : {}), ...(page ? { page_instance_id: page.page_instance_id } : {}) })\n}\n\nexport function trackSearchSubmitted(queryLength: number) {\n  const page = activePageContext()\n  if (!page) return Promise.resolve({ status: "inactive" })\n  return track("behavior.search_submitted", { page_instance_id: page.page_instance_id, query_length_bucket: queryLengthBucket(queryLength) })\n}\n\nexport function trackFilterApplied(input: { filterKeys: string[]; activeFilterCount: number }) {\n  const page = activePageContext()\n  if (!page) return Promise.resolve({ status: "inactive" })\n  return track("behavior.filter_applied", { page_instance_id: page.page_instance_id, filter_keys: input.filterKeys, active_filter_count: input.activeFilterCount })\n}\n\nexport function FunnelmetryPromotionBanner({ bannerId, placementId, campaignId, children }: { bannerId: string; placementId: string; campaignId?: string; children: ReactNode }) {\n  const pathname = usePathname()\n  const element = useRef<HTMLDivElement>(null)\n\n  useEffect(() => {\n    const currentSdk = getSdk()\n    const page = pageContext(pathname)\n    if (!currentSdk || !page || !element.current || !enabled("promotion.banner_impression")) return\n    return currentSdk.attachBannerImpressionObserver({ element: element.current, bannerId, placementId, pageInstanceId: page.page_instance_id, ...(campaignId ? { campaignId } : {}) })\n  }, [bannerId, campaignId, pathname, placementId])\n\n  return <div ref={element} onClick={() => {\n    const page = pageContext(pathname)\n    if (page) void track("promotion.banner_clicked", { banner_id: bannerId, placement_id: placementId, page_instance_id: page.page_instance_id, ...(campaignId ? { campaign_id: campaignId } : {}) })\n  }}>{children}</div>\n}\n`
}

function generatedManagedDeliveryDispatcher() {
  return `type Logger = { warn: (message: string) => void }

type MappedSourceEvent = {
  eventId: string
  sourceEventType: string
  occurredAt: string
  aggregate: { type: string; id: string }
  sourcePayload: Record<string, unknown>
}

type DeliveryResult = { status: "accepted" | "duplicate" | "rejected" | "retryable_failure" }
type BackendForwarder = { forward: (event: MappedSourceEvent) => Promise<DeliveryResult> }

type ManagedDeliveryOptions = {
  sourceId: string
  sourceKeyId: string
  endpoint: string
  signingKey: string
  timeoutMs: number
  maxAttempts: number
  maxQueueSize: number
  failureThreshold: number
  cooldownMs: number
  logger: Logger
}

type ManagedDeliveryMetrics = {
  enqueued: number
  accepted: number
  duplicate: number
  rejected: number
  retryableFailure: number
  droppedQueueFull: number
  droppedAfterRetry: number
  circuitOpened: number
}

export function createManagedDeliveryDispatcher(options: ManagedDeliveryOptions) {
  const queue: MappedSourceEvent[] = []
  const metrics: ManagedDeliveryMetrics = {
    enqueued: 0,
    accepted: 0,
    duplicate: 0,
    rejected: 0,
    retryableFailure: 0,
    droppedQueueFull: 0,
    droppedAfterRetry: 0,
    circuitOpened: 0,
  }
  let draining = false
  let wakeTimer: ReturnType<typeof setTimeout> | undefined
  let circuitOpenUntil = 0
  let consecutiveRetryableFailures = 0
  let lastQueueFullLogAt = 0
  let forwarder: BackendForwarder | undefined

  async function getForwarder() {
    if (forwarder) return forwarder
    const kit = await import("@funnelmetry/backend-integration-kit")
    forwarder = kit.createBackendForwarder({
      sourceId: options.sourceId,
      sourceKeyId: options.sourceKeyId,
      endpoint: options.endpoint,
      signingKey: options.signingKey,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      logger: { warn: (entry: unknown) => options.logger.warn(JSON.stringify(entry)) },
    }) as BackendForwarder
    return forwarder
  }

  function scheduleDrain(delayMs = 0) {
    if (draining || wakeTimer) return
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined
      void drain()
    }, delayMs)
  }

  function openCircuit() {
    circuitOpenUntil = Date.now() + options.cooldownMs
    consecutiveRetryableFailures = 0
    metrics.circuitOpened += 1
    options.logger.warn(JSON.stringify({
      message: "Funnelmetry delivery circuit opened; Medusa business flow remains unaffected",
      cooldown_ms: options.cooldownMs,
      queued_events: queue.length,
    }))
  }

  async function drain() {
    if (draining) return
    const remainingCooldown = circuitOpenUntil - Date.now()
    if (remainingCooldown > 0) {
      scheduleDrain(remainingCooldown)
      return
    }
    draining = true
    try {
      while (queue.length > 0) {
        const remainingCooldownDuringDrain = circuitOpenUntil - Date.now()
        if (remainingCooldownDuringDrain > 0) {
          scheduleDrain(remainingCooldownDuringDrain)
          break
        }
        const event = queue.shift()
        if (!event) continue
        try {
          const result = await (await getForwarder()).forward(event)
          if (result.status === "accepted") {
            metrics.accepted += 1
            consecutiveRetryableFailures = 0
          } else if (result.status === "duplicate") {
            metrics.duplicate += 1
            consecutiveRetryableFailures = 0
          } else if (result.status === "rejected") {
            metrics.rejected += 1
            consecutiveRetryableFailures = 0
          } else {
            metrics.retryableFailure += 1
            metrics.droppedAfterRetry += 1
            consecutiveRetryableFailures += 1
            if (consecutiveRetryableFailures >= options.failureThreshold) {
              openCircuit()
              break
            }
          }
        } catch (error) {
          metrics.retryableFailure += 1
          metrics.droppedAfterRetry += 1
          consecutiveRetryableFailures += 1
          options.logger.warn(JSON.stringify({
            message: "Funnelmetry managed delivery failed open",
            error: error instanceof Error ? error.message : "unknown error",
          }))
          if (consecutiveRetryableFailures >= options.failureThreshold) {
            openCircuit()
            break
          }
        }
      }
    } finally {
      draining = false
      if (queue.length > 0) {
        scheduleDrain(Math.max(0, circuitOpenUntil - Date.now()))
      }
    }
  }

  function enqueue(event: MappedSourceEvent) {
    if (queue.length >= options.maxQueueSize) {
      metrics.droppedQueueFull += 1
      if (Date.now() - lastQueueFullLogAt >= 60000) {
        lastQueueFullLogAt = Date.now()
        options.logger.warn(JSON.stringify({
          message: "Funnelmetry delivery queue is full; event dropped without affecting Medusa",
          max_queue_size: options.maxQueueSize,
        }))
      }
      return { status: "dropped_queue_full" as const }
    }
    queue.push(event)
    metrics.enqueued += 1
    scheduleDrain(Math.max(0, circuitOpenUntil - Date.now()))
    return { status: "queued" as const }
  }

  return Object.freeze({
    enqueue,
    getMetrics: () => ({
      ...metrics,
      queued: queue.length,
      circuitOpen: circuitOpenUntil > Date.now(),
    }),
  })
}
`
}

function generatedSubscriber(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const reliability = JSON.stringify(manifest.reliability)
  return `import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"\nimport { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"\nimport { createManagedDeliveryDispatcher } from "../funnelmetry/managed-delivery-dispatcher"\n\ntype OrderPlacedData = { id: string }\ntype OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: number }\ntype Order = { id: string; created_at?: string; currency_code?: string; total?: number; items?: OrderItem[] }\ntype Logger = { warn: (message: string) => void }\ntype MedusaContainer = SubscriberArgs<OrderPlacedData>["container"]\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst reliability = ${reliability}\nlet dispatcher: ReturnType<typeof createManagedDeliveryDispatcher> | undefined\nlet lastInactiveWarningAt = 0\n\nfunction getDispatcher(logger: Logger) {\n  if (dispatcher) return dispatcher\n  const signingKey = process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? ""\n  if (!signingKey) {\n    if (Date.now() - lastInactiveWarningAt >= 60000) {\n      lastInactiveWarningAt = Date.now()\n      logger.warn("Funnelmetry backend integration is inactive: signing key is not configured")\n    }\n    return null\n  }\n  dispatcher = createManagedDeliveryDispatcher({\n    sourceId,\n    sourceKeyId,\n    endpoint: process.env.FUNNELMETRY_INGEST_URL ?? "",\n    signingKey,\n    timeoutMs: reliability.timeoutMs,\n    maxAttempts: reliability.retry.maxAttempts,\n    maxQueueSize: reliability.maxQueueSize,\n    failureThreshold: reliability.circuitBreaker.failureThreshold,\n    cooldownMs: reliability.circuitBreaker.cooldownMs,\n    logger,\n  })\n  return dispatcher\n}\n\nasync function enqueueOrderPlaced(orderId: string, container: MedusaContainer, logger: Logger) {\n  try {\n    const orderModuleService = container.resolve(Modules.ORDER) as { retrieveOrder: (id: string, options: Record<string, unknown>) => Promise<Order> }\n    const order = await orderModuleService.retrieveOrder(orderId, { relations: ["items"] })\n    if (!order.created_at || !order.currency_code) {\n      logger.warn("Funnelmetry order forward skipped: missing authoritative order time/currency")\n      return\n    }\n    getDispatcher(logger)?.enqueue({\n      eventId: \`medusa:order.placed:\${orderId}\`,\n      sourceEventType: "medusa.order_placed",\n      occurredAt: order.created_at,\n      aggregate: { type: "order", id: order.id },\n      sourcePayload: { order_id: order.id, currency_code: order.currency_code, total_minor: order.total, items: (order.items ?? []).map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: item.unit_price })) },\n    })\n  } catch (error) {\n    logger.warn(\`Funnelmetry order enqueue failed open: \${error instanceof Error ? error.message : "unknown error"}\`)\n  }\n}\n\nexport default function funnelmetryOrderPlaced({ event, container }: SubscriberArgs<OrderPlacedData>) {\n  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger\n  void enqueueOrderPlaced(event.data.id, container, logger)\n}\n\nexport const config: SubscriberConfig = { event: "order.placed" }\n`
}

function stripSupersededBrowserHooks(content) {
  return content
    .replace(/\nfunction activePageContext\(\) \{\n  return pageContext\(typeof window === "undefined" \? null : window\.location\.pathname\)\n\}\n/g, "\n")
    .replace(/\nfunction queryLengthBucket\(length: number\) \{[\s\S]*?\n\}\n/g, "\n")
    .replace(/\nexport function trackCartAddClicked\([\s\S]*?\n\}\n\nexport function trackSearchSubmitted\([\s\S]*?\n\}\n/g, "\n")
}

function configureGeneratedClient(content, manifest) {
  return stripSupersededBrowserHooks(content)
    .replace("@funnelmetry/browser-sdk", "@3002tad/funnelmetry-browser-sdk")
    .replace(
      'endpoint: process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL ?? "",',
      `endpoint: ${JSON.stringify(manifest.ingest.browserUrl)},`,
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
    .replace("@funnelmetry/backend-integration-kit", "@3002tad/funnelmetry-backend-integration-kit")
    .replace(
      "export default function funnelmetryOrderPlaced",
      "export default async function funnelmetryOrderPlaced",
    )
    .replace(
      'endpoint: process.env.FUNNELMETRY_INGEST_URL ?? "",',
      `endpoint: ${JSON.stringify(manifest.ingest.backendUrl)},`,
    )
    .replace(
      'signingKey: process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? "",',
      `signingKey: process.env.${manifest.auth.backendSigningKeyRef} ?? "",`,
    )
}

function configureGeneratedManagedDeliveryDispatcher(content) {
  return content.replace("@funnelmetry/backend-integration-kit", "@3002tad/funnelmetry-backend-integration-kit")
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

async function readOptionalProjectFile(projectRoot, relativePath) {
  try {
    return await readProjectFile(projectRoot, relativePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function assertDirectory(projectRoot, relativePath) {
  const target = path.join(projectRoot, relativePath)
  if (!(await stat(target)).isDirectory()) throw new Error(`Pinned Medusa layout is missing directory ${relativePath}`)
}

function packageHasDependency(content, dependency, version, file) {
  let packageJson
  try {
    packageJson = JSON.parse(content)
  } catch {
    throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`)
  }
  return packageJson.dependencies?.[dependency] === version
}

function requireMarker(content, marker, file) {
  if (!content.includes(marker)) {
    throw new Error(`Existing Funnelmetry integration is incomplete or has drifted in ${file}`)
  }
}

function normalizedText(content) {
  return String(content ?? "").replace(/\r\n/g, "\n")
}

function normalizeManagedBrowserClient(content) {
  return normalizedText(content)
    .replace(/^const sourceId = .+$/m, "const sourceId = __MANAGED__")
    .replace(/^const sourceKeyId = .+$/m, "const sourceKeyId = __MANAGED__")
    .replace(/^const allowedEventTypes = .+$/m, "const allowedEventTypes = __MANAGED__")
    .replace(/^const reliability = .+$/m, "const reliability = __MANAGED__")
    .replace(/^      endpoint: .+,$/m, "      endpoint: __MANAGED__,")
    .replace(/^      writeKey: .+,$/m, "      writeKey: __MANAGED__,")
}

function normalizeManagedOrderPlacedSubscriber(content) {
  return normalizedText(content)
    .replace(/^const sourceId = .+$/m, "const sourceId = __MANAGED__")
    .replace(/^const sourceKeyId = .+$/m, "const sourceKeyId = __MANAGED__")
    .replace(/^const reliability = .+$/m, "const reliability = __MANAGED__")
    .replace(/^    endpoint: .+,$/m, "    endpoint: __MANAGED__,")
    .replace(/^    signingKey: .+,$/m, "    signingKey: __MANAGED__,")
}

function isKnownManagedPackageVersion(content, dependency, targetVersion, file) {
  let packageJson
  try {
    packageJson = JSON.parse(content)
  } catch {
    throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`)
  }
  const version = packageJson.dependencies?.[dependency]
  return version === targetVersion || version === "0.1.1" || version === "0.1.0"
}

function firstDifferentLine(actual, expected) {
  const actualLines = normalizedText(actual).split("\n")
  const expectedLines = normalizedText(expected).split("\n")
  const length = Math.max(actualLines.length, expectedLines.length)
  for (let index = 0; index < length; index += 1) {
    if (actualLines[index] !== expectedLines[index]) return index + 1
  }
  return 0
}

function hasFunnelmetryAlias(content, file) {
  let tsConfig
  try {
    tsConfig = JSON.parse(content)
  } catch {
    throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`)
  }
  const alias = tsConfig.compilerOptions?.paths?.["@funnelmetry/*"]
  return Array.isArray(alias) && alias.length === 1 && alias[0] === "funnelmetry/*"
}

function sourceFingerprint(originals) {
  const fingerprint = createHash("sha256")
  for (const relativePath of Object.keys(originals).sort()) {
    fingerprint.update(relativePath).update("\0").update(originals[relativePath])
  }
  return fingerprint.digest("hex")
}

async function existingIntegration(projectRoot, originals, manifest) {
  const [browserClient, managedDeliveryDispatcher, orderPlacedSubscriber] = await Promise.all([
    readOptionalProjectFile(projectRoot, generatedPaths.browserClient),
    readOptionalProjectFile(projectRoot, generatedPaths.managedDeliveryDispatcher),
    readOptionalProjectFile(projectRoot, generatedPaths.orderPlacedSubscriber),
  ])
  const expectedBrowserClient = manifest.frontend.enabled
    ? configureGeneratedClient(generatedClient(manifest), manifest)
    : null
  const expectedOrderPlacedSubscriber = manifest.backend.enabled
    ? configureGeneratedSubscriber(generatedSubscriber(manifest), manifest)
    : null
  const expectedManagedDeliveryDispatcher = manifest.backend.enabled
    ? configureGeneratedManagedDeliveryDispatcher(generatedManagedDeliveryDispatcher(manifest), manifest)
    : null
  const detected = browserClient !== null || managedDeliveryDispatcher !== null || orderPlacedSubscriber !== null ||
    originals[paths.storefrontPackage].includes("@3002tad/funnelmetry-browser-sdk") ||
    originals[paths.backendPackage].includes("@3002tad/funnelmetry-backend-integration-kit")

  if (!detected) return "absent"
  if (normalizeManagedBrowserClient(browserClient) !== normalizeManagedBrowserClient(expectedBrowserClient)) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.browserClient} differs at line ${firstDifferentLine(browserClient, expectedBrowserClient)}`)
  }
  if (normalizeManagedOrderPlacedSubscriber(orderPlacedSubscriber) !== normalizeManagedOrderPlacedSubscriber(expectedOrderPlacedSubscriber)) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.orderPlacedSubscriber} differs at line ${firstDifferentLine(orderPlacedSubscriber, expectedOrderPlacedSubscriber)}`)
  }
  if (normalizedText(managedDeliveryDispatcher) !== normalizedText(expectedManagedDeliveryDispatcher)) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.managedDeliveryDispatcher} differs at line ${firstDifferentLine(managedDeliveryDispatcher, expectedManagedDeliveryDispatcher)}`)
  }
  if (manifest.frontend.enabled) {
    if (!isKnownManagedPackageVersion(originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk", packageVersions.browserSdk, paths.storefrontPackage)) {
      throw new Error("Existing Funnelmetry browser integration has an unexpected package version")
    }
    if (!hasFunnelmetryAlias(originals[paths.storefrontTsConfig], paths.storefrontTsConfig)) {
      throw new Error(`Existing Funnelmetry integration is incomplete or has drifted in ${paths.storefrontTsConfig}`)
    }
    requireMarker(originals[paths.storefrontLayout], 'import { FunnelmetryBootstrap } from "@funnelmetry/client"', paths.storefrontLayout)
    requireMarker(originals[paths.storefrontLayout], "<FunnelmetryBootstrap />", paths.storefrontLayout)
    requireMarker(originals[paths.productPage], 'import { FunnelmetryProductViewed } from "@funnelmetry/client"', paths.productPage)
    requireMarker(originals[paths.productPage], "<FunnelmetryProductViewed productId={pricedProduct.id} />", paths.productPage)
    requireMarker(originals[paths.checkoutPage], 'import { FunnelmetryCheckoutStarted } from "@funnelmetry/client"', paths.checkoutPage)
    requireMarker(originals[paths.checkoutPage], "<FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />", paths.checkoutPage)
  }
  if (manifest.backend.enabled && !isKnownManagedPackageVersion(originals[paths.backendPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.backendPackage)) {
    throw new Error("Existing Funnelmetry backend integration has an unexpected package version")
  }
  const exact = normalizedText(browserClient) === normalizedText(expectedBrowserClient) &&
    normalizedText(orderPlacedSubscriber) === normalizedText(expectedOrderPlacedSubscriber) &&
    normalizedText(managedDeliveryDispatcher) === normalizedText(expectedManagedDeliveryDispatcher) &&
    (!manifest.frontend.enabled || packageHasDependency(originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk", packageVersions.browserSdk, paths.storefrontPackage)) &&
    (!manifest.backend.enabled || packageHasDependency(originals[paths.backendPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.backendPackage))
  return exact ? "exact" : "managed"
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

  const existing = await existingIntegration(projectRoot, originals, manifest)
  if (existing === "exact") {
    return {
      schemaVersion: "funnelmetry-ci-plan.v1",
      mode: "plan-only",
      sourceMutation: false,
      host,
      manifest,
      sourceFingerprint: sourceFingerprint(originals),
      capabilities: {
        behavior: manifest.frontend.enabled ? "ENABLED" : "DISABLED",
        orderPlaced: manifest.backend.enabled ? "ENABLED" : "DISABLED",
        payment: "NOT_REQUESTED",
        refund: "NOT_REQUESTED",
      },
      changes: [],
      patch: "",
    }
  }

  const refreshManagedBinding = existing === "managed"
  const [currentBrowserClient, currentManagedDeliveryDispatcher, currentOrderPlacedSubscriber] = refreshManagedBinding
    ? await Promise.all([
      readProjectFile(projectRoot, generatedPaths.browserClient),
      readProjectFile(projectRoot, generatedPaths.managedDeliveryDispatcher),
      readProjectFile(projectRoot, generatedPaths.orderPlacedSubscriber),
    ])
    : [null, null, null]

  const changes = []
  if (manifest.frontend.enabled) {
    const client = configureGeneratedClient(generatedClient(manifest), manifest)
    const storefrontTsConfig = addFunnelmetryAlias(
      originals[paths.storefrontTsConfig],
      paths.storefrontTsConfig,
    )
    const storefrontPackage = addDependency(
      originals[paths.storefrontPackage],
      "@3002tad/funnelmetry-browser-sdk",
      packageVersions.browserSdk,
      paths.storefrontPackage,
    )
    const layoutWithImport = replaceOnce(
      originals[paths.storefrontLayout],
      'import "styles/globals.css"',
      'import "styles/globals.css"\nimport { FunnelmetryBootstrap } from "@funnelmetry/client"',
      paths.storefrontLayout,
    )
    const layout = replaceOnce(
      layoutWithImport,
      "<body>",
      "<body>\n        <FunnelmetryBootstrap />",
      paths.storefrontLayout,
    )
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
    if (refreshManagedBinding) {
      changes.push(
        { path: paths.storefrontPackage, before: originals[paths.storefrontPackage], after: storefrontPackage },
        { path: generatedPaths.browserClient, before: currentBrowserClient, after: client },
      )
    } else {
      changes.push(
        { path: paths.storefrontTsConfig, before: originals[paths.storefrontTsConfig], after: storefrontTsConfig },
        { path: paths.storefrontPackage, before: originals[paths.storefrontPackage], after: storefrontPackage },
        { path: generatedPaths.browserClient, before: null, after: client },
        { path: paths.storefrontLayout, before: originals[paths.storefrontLayout], after: layout },
        { path: paths.productPage, before: originals[paths.productPage], after: productPage },
        { path: paths.checkoutPage, before: originals[paths.checkoutPage], after: checkout },
      )
    }
  }
  if (manifest.backend.enabled) {
    const subscriber = configureGeneratedSubscriber(generatedSubscriber(manifest), manifest)
    const managedDeliveryDispatcher = configureGeneratedManagedDeliveryDispatcher(
      generatedManagedDeliveryDispatcher(manifest),
      manifest,
    )
    const backendPackage = addDependency(
      originals[paths.backendPackage],
      "@3002tad/funnelmetry-backend-integration-kit",
      packageVersions.backendIntegrationKit,
      paths.backendPackage,
    )
    changes.push(
      { path: paths.backendPackage, before: originals[paths.backendPackage], after: backendPackage },
      { path: generatedPaths.managedDeliveryDispatcher, before: refreshManagedBinding ? currentManagedDeliveryDispatcher : null, after: managedDeliveryDispatcher },
      { path: generatedPaths.orderPlacedSubscriber, before: refreshManagedBinding ? currentOrderPlacedSubscriber : null, after: subscriber },
    )
  }

  return {
    schemaVersion: "funnelmetry-ci-plan.v1",
    mode: "plan-only",
    sourceMutation: false,
    host,
    manifest,
    sourceFingerprint: sourceFingerprint(originals),
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
