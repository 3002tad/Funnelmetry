import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { generatedStoreSearch, generatedBrowserStoreSearch } from "./store-search.mjs"

const paths = {
  rootPackage: "package.json",
  backendPackage: "apps/backend/package.json",
  storefrontPackage: "apps/storefront/package.json",
  storefrontTsConfig: "apps/storefront/tsconfig.json",
  storefrontLayout: "apps/storefront/src/app/layout.tsx",
  productPage: "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  productActions: "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  checkoutPage: "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
  cartData: "apps/storefront/src/lib/data/cart.ts",
  storeSearch: "apps/storefront/src/modules/store/components/store-search/index.tsx",
  storePage: "apps/storefront/src/app/[countryCode]/(main)/store/page.tsx",
  storeTemplate: "apps/storefront/src/modules/store/templates/index.tsx",
  paginatedProducts: "apps/storefront/src/modules/store/templates/paginated-products.tsx",
  subscriberDirectory: "apps/backend/src/subscribers",
}

const generatedPaths = {
  browserClient: "apps/storefront/src/funnelmetry/client.tsx",
  consentNotice: "apps/storefront/src/funnelmetry/consent-notice.tsx",
  storefrontDelivery: "apps/storefront/src/funnelmetry/server-delivery.ts",
  managedDeliveryDispatcher: "apps/backend/src/funnelmetry/managed-delivery-dispatcher.ts",
  occurredAt: "apps/backend/src/funnelmetry/occurred-at.ts",
  orderPlacedSubscriber: "apps/backend/src/subscribers/funnelmetry-order-placed.ts",
  cdcShadowProfile: "funnelmetry/cdc-reference-shadow.json",
  cdcOrderV2ShadowProfile: "funnelmetry/cdc-order-v2-shadow.json",
  cdcCatalogShadowProfile: "funnelmetry/cdc-catalog-shadow.json",
  cdcInventoryPriceShadowProfile: "funnelmetry/cdc-inventory-price-shadow.json",
  cdcCartLineItemProfile: "funnelmetry/cdc-cart-line-item.json",
}

const packageVersions = {
  browserSdk: "0.2.3",
  backendIntegrationKit: "0.2.3",
}
const twoPathBrowserSdkVersion = "0.3.0"

function legacyGeneratedClient(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const allowedEvents = JSON.stringify(manifest.frontend.events)
  const reliability = JSON.stringify(manifest.reliability)
  return `"use client"\n\nimport { useEffect, useRef, type ReactNode } from "react"\nimport { usePathname } from "next/navigation"\nimport { createBrowserSdk } from "@funnelmetry/browser-sdk"\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst allowedEventTypes = ${allowedEvents}\nconst reliability = ${reliability}\n\ntype EventPayload = Record<string, unknown>\ntype BrowserSdk = ReturnType<typeof createBrowserSdk>\ntype PageContext = { page_type: string; path_template: string; page_instance_id: string }\n\ndeclare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }\n\nlet sdk: BrowserSdk | null | undefined\nlet activePage: { pathname: string; context: PageContext } | undefined\n\nfunction enabled(eventType: string) {\n  return allowedEventTypes.includes(eventType)\n}\n\nfunction getSdk(): BrowserSdk | null {\n  if (sdk !== undefined) return sdk\n  try {\n    sdk = createBrowserSdk({\n      sourceId,\n      sourceKeyId,\n      endpoint: process.env.NEXT_PUBLIC_FUNNELMETRY_INGEST_URL ?? "",\n      writeKey: process.env.NEXT_PUBLIC_FUNNELMETRY_BROWSER_WRITE_KEY ?? "",\n      allowedEventTypes,\n      maxAttempts: reliability.retry.maxAttempts,\n      maxQueueSize: reliability.maxQueueSize,\n      hasConsent: () => typeof window !== "undefined" && window.__FUNNELMETRY_CONSENT__ === true,\n    })\n  } catch (error) {\n    sdk = null\n    console.warn("Funnelmetry browser integration is inactive", error)\n  }\n  return sdk\n}\n\nfunction pageDescriptor(pathname: string | null) {\n  const safePathname = pathname || "/"\n  const segments = safePathname.split("/").filter(Boolean)\n  const route = segments.length > 0 ? segments.slice(1) : []\n  if (route.length === 0) return { page_type: "home", path_template: "/{countryCode}" }\n  if (route[0] === "store") return { page_type: "catalog", path_template: "/{countryCode}/store" }\n  if (route[0] === "products") return { page_type: "product", path_template: "/{countryCode}/products/{handle}" }\n  if (route[0] === "checkout") return { page_type: "checkout", path_template: "/{countryCode}/checkout" }\n  if (route[0] === "categories") return { page_type: "category", path_template: "/{countryCode}/categories/{category}" }\n  if (route[0] === "collections") return { page_type: "collection", path_template: "/{countryCode}/collections/{handle}" }\n  if (route[0] === "cart") return { page_type: "cart", path_template: "/{countryCode}/cart" }\n  if (route[0] === "account") return { page_type: "account", path_template: "/{countryCode}/account" }\n  return { page_type: "other", path_template: "/{countryCode}/other" }\n}\n\nfunction pageContext(pathname: string | null): PageContext | null {\n  const key = pathname || "/"\n  if (activePage?.pathname === key) return activePage.context\n  const currentSdk = getSdk()\n  if (!currentSdk) return null\n  activePage = { pathname: key, context: currentSdk.createPageContext(pageDescriptor(pathname)) }\n  return activePage.context\n}\n\nfunction activePageContext() {\n  return pageContext(typeof window === "undefined" ? null : window.location.pathname)\n}\n\nfunction track(eventType: string, payload: EventPayload) {\n  if (!enabled(eventType)) return Promise.resolve({ status: "disabled_by_manifest" })\n  const currentSdk = getSdk()\n  return currentSdk ? currentSdk.trackBehavior(eventType, payload) : Promise.resolve({ status: "inactive" })\n}\n\nfunction queryLengthBucket(length: number) {\n  if (length === 0) return "empty"\n  if (length <= 2) return "1-2"\n  if (length <= 5) return "3-5"\n  if (length <= 10) return "6-10"\n  if (length <= 20) return "11-20"\n  return "21+"\n}\n\nexport function FunnelmetryBootstrap() {\n  const pathname = usePathname()\n\n  useEffect(() => getSdk()?.attachLifecycle(), [])\n\n  useEffect(() => {\n    const currentSdk = getSdk()\n    const page = pageContext(pathname)\n    if (!currentSdk || !page) return\n    if (enabled("behavior.page_viewed")) void currentSdk.trackPageView(page)\n    if (!enabled("behavior.scroll_depth_reached")) return\n    return currentSdk.attachScrollDepthObserver({ page })\n  }, [pathname])\n\n  return null\n}\n\nexport function FunnelmetryProductViewed({ productId, variantId }: { productId: string; variantId?: string }) {\n  const pathname = usePathname()\n  useEffect(() => {\n    const page = pageContext(pathname)\n    if (!page) return\n    void track("behavior.product_viewed", { product_id: productId, ...(variantId ? { variant_id: variantId } : {}), page_instance_id: page.page_instance_id })\n  }, [pathname, productId, variantId])\n  return null\n}\n\nexport function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {\n  const pathname = usePathname()\n  useEffect(() => {\n    const page = pageContext(pathname)\n    void track("checkout.started", { cart_id: cartId, step, ...(page ? { page_instance_id: page.page_instance_id } : {}) })\n  }, [cartId, pathname, step])\n  return null\n}\n\nexport function trackCartAddClicked(input: { productId: string; variantId: string; quantity: number; cartId?: string }) {\n  const page = activePageContext()\n  return track("cart.add_clicked", { product_id: input.productId, variant_id: input.variantId, quantity: input.quantity, ...(input.cartId ? { cart_id: input.cartId } : {}), ...(page ? { page_instance_id: page.page_instance_id } : {}) })\n}\n\nexport function trackSearchSubmitted(queryLength: number) {\n  const page = activePageContext()\n  if (!page) return Promise.resolve({ status: "inactive" })\n  return track("behavior.search_submitted", { page_instance_id: page.page_instance_id, query_length_bucket: queryLengthBucket(queryLength) })\n}\n\nexport function trackFilterApplied(input: { filterKeys: string[]; activeFilterCount: number }) {\n  const page = activePageContext()\n  if (!page) return Promise.resolve({ status: "inactive" })\n  return track("behavior.filter_applied", { page_instance_id: page.page_instance_id, filter_keys: input.filterKeys, active_filter_count: input.activeFilterCount })\n}\n\nexport function FunnelmetryPromotionBanner({ bannerId, placementId, campaignId, children }: { bannerId: string; placementId: string; campaignId?: string; children: ReactNode }) {\n  const pathname = usePathname()\n  const element = useRef<HTMLDivElement>(null)\n\n  useEffect(() => {\n    const currentSdk = getSdk()\n    const page = pageContext(pathname)\n    if (!currentSdk || !page || !element.current || !enabled("promotion.banner_impression")) return\n    return currentSdk.attachBannerImpressionObserver({ element: element.current, bannerId, placementId, pageInstanceId: page.page_instance_id, ...(campaignId ? { campaignId } : {}) })\n  }, [bannerId, campaignId, pathname, placementId])\n\n  return <div ref={element} onClick={() => {\n    const page = pageContext(pathname)\n    if (page) void track("promotion.banner_clicked", { banner_id: bannerId, placement_id: placementId, page_instance_id: page.page_instance_id, ...(campaignId ? { campaign_id: campaignId } : {}) })\n  }}>{children}</div>\n}\n`
}

function generatedClient(manifest) {
  const anonymousIdentityCookie = JSON.stringify(`funnelmetry_anonymous_id_${manifest.source.id}`)
  const sessionIdentityCookie = JSON.stringify(`funnelmetry_session_id_${manifest.source.id}`)
  return legacyGeneratedClient(manifest).replace(
    `export function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    void track("checkout.started", { cart_id: cartId, step, ...(page ? { page_instance_id: page.page_instance_id } : {}) })
  }, [cartId, pathname, step])
  return null
}`,
    `export function FunnelmetryCheckoutStarted({ cartId }: { cartId: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    const currentSdk = getSdk()
    if (!currentSdk || !page || !enabled("checkout.started")) return
    void currentSdk.trackBehaviorOnce(\`checkout.started:\${cartId}\`, "checkout.started", { cart_id: cartId, step: "address", page_instance_id: page.page_instance_id }, { correlationId: cartCorrelationId(cartId) })
  }, [cartId, pathname])
  return null
}`,
  )
    .replace(
      "type EventPayload = Record<string, unknown>",
      `const anonymousIdentityCookie = ${anonymousIdentityCookie}\nconst sessionIdentityCookie = ${sessionIdentityCookie}\n\ntype EventPayload = Record<string, unknown>`,
    )
    .replace(
      `function track(eventType: string, payload: EventPayload) {
  if (!enabled(eventType)) return Promise.resolve({ status: "disabled_by_manifest" })
  const currentSdk = getSdk()
  return currentSdk ? currentSdk.trackBehavior(eventType, payload) : Promise.resolve({ status: "inactive" })
}`,
      `function cartCorrelationId(cartId: string) {
  return \`cart:\${cartId}\`
}

function syncServerIdentity(currentSdk: BrowserSdk) {
  const identity = currentSdk.getIdentity()
  if (typeof document === "undefined") return
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  if (!identity) {
    document.cookie = \`\${anonymousIdentityCookie}=; Path=/; Max-Age=0; SameSite=Lax\${secure}\`
    document.cookie = \`\${sessionIdentityCookie}=; Path=/; Max-Age=0; SameSite=Lax\${secure}\`
    return
  }
  document.cookie = \`\${anonymousIdentityCookie}=\${encodeURIComponent(identity.anonymousId)}; Path=/; Max-Age=31536000; SameSite=Lax\${secure}\`
  document.cookie = \`\${sessionIdentityCookie}=\${encodeURIComponent(identity.sessionId)}; Path=/; SameSite=Lax\${secure}\`
}

function track(eventType: string, payload: EventPayload, context: { correlationId?: string } = {}) {
  if (!enabled(eventType)) return Promise.resolve({ status: "disabled_by_manifest" })
  const currentSdk = getSdk()
  return currentSdk ? currentSdk.trackBehavior(eventType, payload, context) : Promise.resolve({ status: "inactive" })
}`,
    )
    .replace(
      `    if (!currentSdk || !page) return
    if (enabled("behavior.page_viewed")) void currentSdk.trackPageView(page)`,
      `    if (!currentSdk || !page) return
    syncServerIdentity(currentSdk)
    if (enabled("behavior.page_viewed")) void currentSdk.trackPageView(page)`,
    )
}

function generatedManagedDeliveryDispatcherHeader() {
  return `type Logger = { warn: (message: string) => void }

type MappedSourceEvent = {
  eventId: string
  sourceEventType: string
  sourceSchemaVersion?: string
  occurredAt: string
  aggregate: { type: string; id: string }
  anonymousId?: string
  sessionId?: string
  correlationId?: string
  sourcePayload: Record<string, unknown>
}
`
  + generatedManagedDeliveryDispatcherTail()
}

function generatedConsentNotice(manifest) {
  const storageKey = JSON.stringify(`funnelmetry.browser.consent.v1.${manifest.source.id}`)
  return `"use client"\n\nimport { useEffect, useState } from "react"\n\nconst consentStorageKey = ${storageKey}\n\ndeclare global {\n  interface Window {\n    __FUNNELMETRY_CONSENT__?: boolean\n  }\n}\n\nfunction hasStoredConsent() {\n  if (typeof window === "undefined") return false\n  try {\n    return window.localStorage.getItem(consentStorageKey) === "granted"\n  } catch {\n    return false\n  }\n}\n\nfunction restoreTrackingConsent() {\n  if (typeof window === "undefined") return\n  window.__FUNNELMETRY_CONSENT__ = hasStoredConsent()\n}\n\nrestoreTrackingConsent()\n\nexport function FunnelmetryConsentNotice() {\n  const [open, setOpen] = useState(false)\n\n  useEffect(() => {\n    restoreTrackingConsent()\n    setOpen(!hasStoredConsent())\n  }, [])\n\n  if (!open) return null\n\n  return (\n    <aside\n      aria-describedby="funnelmetry-tracking-description"\n      aria-labelledby="funnelmetry-tracking-title"\n      role="dialog"\n      style={{\n        background: "#ffffff",\n        border: "1px solid #e5e7eb",\n        borderRadius: "0.5rem",\n        bottom: "1.5rem",\n        boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",\n        left: "50%",\n        maxWidth: "28rem",\n        padding: "1.25rem 3rem 1.25rem 1.25rem",\n        position: "fixed",\n        transform: "translateX(-50%)",\n        width: "calc(100% - 2rem)",\n        zIndex: 100,\n      }}\n    >\n      <button\n        aria-label="Agree to tracking and close this notice"\n        className="text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"\n        onClick={() => {\n          let persisted = false\n          try {\n            window.localStorage.setItem(consentStorageKey, "granted")\n            persisted = true\n          } catch {\n            // The global flag still enables tracking for the current page lifetime.\n          }\n          window.__FUNNELMETRY_CONSENT__ = true\n          setOpen(false)\n          if (persisted) window.location.reload()\n        }}\n        style={{\n          alignItems: "center",\n          borderRadius: "9999px",\n          display: "flex",\n          fontSize: "1.25rem",\n          height: "2rem",\n          justifyContent: "center",\n          lineHeight: 1,\n          position: "absolute",\n          right: "0.75rem",\n          top: "0.75rem",\n          width: "2rem",\n        }}\n        type="button"\n      >\n        <span aria-hidden="true">&times;</span>\n      </button>\n      <h2 className="text-base-semi text-gray-900" id="funnelmetry-tracking-title">\n        Tracking notice\n      </h2>\n      <p className="mt-2 text-small-regular text-gray-600" id="funnelmetry-tracking-description">\n        Funnelmetry uses anonymous interaction data to understand the shopping journey. Closing this notice enables tracking for this browser.\n      </p>\n    </aside>\n  )\n}\n`
}

function generatedStorefrontDelivery(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const reliability = JSON.stringify({
    timeoutMs: manifest.reliability.timeoutMs,
    maxQueueSize: manifest.reliability.maxQueueSize,
    maxAttempts: manifest.reliability.retry.maxAttempts,
    failureThreshold: manifest.reliability.circuitBreaker.failureThreshold,
    cooldownMs: manifest.reliability.circuitBreaker.cooldownMs,
  }, null, 2)
  return `import "server-only"\n\nimport { randomUUID } from "node:crypto"\nimport { createManagedDeliveryDispatcher } from "@3002tad/funnelmetry-backend-integration-kit"\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst reliability = ${reliability}\nconst opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/\nconst normalizedQueryMaxLength = 160\n\ntype CartItemAdded = {\n  cartId: string\n  lineItemId: string\n  variantId: string\n  quantity: number\n  productId?: string\n}\n\nlet dispatcher: ReturnType<typeof createManagedDeliveryDispatcher> | null | undefined\nlet lastInactiveWarningAt = 0\n\nfunction warnSafe(message: string) {\n  console.warn(JSON.stringify({ message }))\n}\n\nfunction getDispatcher() {\n  if (dispatcher !== undefined) return dispatcher\n  const signingKey = process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? ""\n  const endpoint = process.env.FUNNELMETRY_INGEST_URL ?? ""\n  if (!signingKey || !endpoint) {\n    if (Date.now() - lastInactiveWarningAt >= 60_000) {\n      lastInactiveWarningAt = Date.now()\n      warnSafe("Funnelmetry server tracking is inactive: delivery configuration is missing")\n    }\n    dispatcher = null\n    return dispatcher\n  }\n\n  try {\n    dispatcher = createManagedDeliveryDispatcher({\n      sourceId,\n      sourceKeyId,\n      endpoint,\n      signingKey,\n      timeoutMs: reliability.timeoutMs,\n      maxAttempts: reliability.maxAttempts,\n      maxQueueSize: reliability.maxQueueSize,\n      failureThreshold: reliability.failureThreshold,\n      cooldownMs: reliability.cooldownMs,\n      logger: { warn: (entry) => console.warn(JSON.stringify(entry)) },\n    })\n  } catch {\n    dispatcher = null\n    warnSafe("Funnelmetry server tracking is inactive: delivery dispatcher could not initialize")\n  }\n  return dispatcher\n}\n\nfunction normalizeSearchQuery(query: string) {\n  const normalized = query.normalize("NFKC").trim().replace(/\\s+/g, " ").toLowerCase()\n  if (!normalized || normalized.length > normalizedQueryMaxLength) return null\n  if (/\\b[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}\\b/i.test(normalized)) return null\n  if (/(?:\\+?\\d[\\s().-]*){8,}/.test(normalized)) return null\n  if (/\\b(?:password|passcode|otp|cvv|cvc|card(?:\\s*number)?|token|secret)\\b/i.test(normalized)) return null\n  return normalized\n}\n\nfunction isNonNegativeSafeInteger(value: unknown): value is number {\n  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0\n}\n\nexport function enqueueSearchOutcome(input: {\n  searchInteractionId: string\n  query: string\n  outcome: "succeeded" | "failed"\n  resultCount?: number\n}) {\n  try {\n    if (!opaqueIdPattern.test(input.searchInteractionId)) return\n    const queryNormalized = normalizeSearchQuery(input.query)\n    if (!queryNormalized) return\n    const resultCount = input.resultCount\n    if (input.outcome === "succeeded") {\n      if (!isNonNegativeSafeInteger(resultCount)) return\n      getDispatcher()?.enqueue({\n        eventId: \`medusa:search:\${input.searchInteractionId}\`,\n        sourceEventType: "behavior.search_submitted",\n        sourceSchemaVersion: "2.0",\n        occurredAt: new Date().toISOString(),\n        aggregate: { type: "search_interaction", id: input.searchInteractionId },\n        sourcePayload: { search_interaction_id: input.searchInteractionId, query_normalized: queryNormalized, outcome: input.outcome, result_count: resultCount },\n      })\n      return\n    }\n\n    if (resultCount !== undefined) return\n    getDispatcher()?.enqueue({\n      eventId: \`medusa:search:\${input.searchInteractionId}\`,\n      sourceEventType: "behavior.search_submitted",\n      sourceSchemaVersion: "2.0",\n      occurredAt: new Date().toISOString(),\n      aggregate: { type: "search_interaction", id: input.searchInteractionId },\n      sourcePayload: { search_interaction_id: input.searchInteractionId, query_normalized: queryNormalized, outcome: input.outcome },\n    })\n  } catch {\n    warnSafe("Funnelmetry search tracking dropped without affecting the Search API")\n  }\n}\n\nexport function enqueueCartItemAdded(input: CartItemAdded) {\n  try {\n    if (!input.cartId || !input.lineItemId || !input.variantId || !Number.isSafeInteger(input.quantity) || input.quantity < 1) return\n    getDispatcher()?.enqueue({\n      eventId: \`medusa:cart.item_added:\${input.cartId}:\${input.lineItemId}:\${randomUUID()}\`,\n      sourceEventType: "cart.item_added",\n      sourceSchemaVersion: "2.0",\n      occurredAt: new Date().toISOString(),\n      aggregate: { type: "cart", id: input.cartId },\n      sourcePayload: { cart_id: input.cartId, line_item_id: input.lineItemId, variant_id: input.variantId, quantity: input.quantity, ...(input.productId ? { product_id: input.productId } : {}) },\n    })\n  } catch {\n    warnSafe("Funnelmetry cart tracking dropped without affecting the cart operation")\n  }\n}\n`
}

function configuredStorefrontDelivery(manifest) {
  const anonymousIdentityCookie = JSON.stringify(`funnelmetry_anonymous_id_${manifest.source.id}`)
  const sessionIdentityCookie = JSON.stringify(`funnelmetry_session_id_${manifest.source.id}`)
  return generatedStorefrontDelivery(manifest)
    .replace(
      'import { randomUUID } from "node:crypto"',
      'import { randomUUID } from "node:crypto"\nimport { cookies } from "next/headers"',
    )
    .replace(
      "const normalizedQueryMaxLength = 160",
      `const normalizedQueryMaxLength = 160\nconst anonymousIdentityCookie = ${anonymousIdentityCookie}\nconst sessionIdentityCookie = ${sessionIdentityCookie}`,
    )
    .replace(
      "function normalizeSearchQuery(query: string) {",
      `function identityValue(value: string | undefined) {
  if (!value) return undefined
  try {
    const decoded = decodeURIComponent(value)
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

async function readBrowserIdentity() {
  const cookieStore = await cookies()
  return {
    anonymousId: identityValue(cookieStore.get(anonymousIdentityCookie)?.value),
    sessionId: identityValue(cookieStore.get(sessionIdentityCookie)?.value),
  }
}

function normalizeSearchQuery(query: string) {`,
    )
    .replace("export function enqueueSearchOutcome", "export async function enqueueSearchOutcome")
    .replace(
      `  try {
    if (!opaqueIdPattern.test(input.searchInteractionId)) return`,
      `  try {
    if (!opaqueIdPattern.test(input.searchInteractionId)) return
    const identity = await readBrowserIdentity()`,
    )
    .replaceAll(
      '        aggregate: { type: "search_interaction", id: input.searchInteractionId },\n        sourcePayload:',
      '        aggregate: { type: "search_interaction", id: input.searchInteractionId },\n        anonymousId: identity.anonymousId,\n        sessionId: identity.sessionId,\n        correlationId: `search:${input.searchInteractionId}`,\n        sourcePayload:',
    )
    .replace(
      '      aggregate: { type: "search_interaction", id: input.searchInteractionId },\n      sourcePayload:',
      '      aggregate: { type: "search_interaction", id: input.searchInteractionId },\n      anonymousId: identity.anonymousId,\n      sessionId: identity.sessionId,\n      correlationId: `search:${input.searchInteractionId}`,\n      sourcePayload:',
    )
    .replace("export function enqueueCartItemAdded", "export async function enqueueCartItemAdded")
    .replace(
      `  try {
    if (!input.cartId || !input.lineItemId || !input.variantId || !Number.isSafeInteger(input.quantity) || input.quantity < 1) return
    getDispatcher()?.enqueue({
      eventId: \`medusa:cart.item_added:\${input.cartId}:\${input.lineItemId}:\${randomUUID()}\`,`,
      `  try {
    if (!input.cartId || !input.lineItemId || !input.variantId || !Number.isSafeInteger(input.quantity) || input.quantity < 1) return
    const identity = await readBrowserIdentity()
    getDispatcher()?.enqueue({
      eventId: \`medusa:cart.item_added:\${input.cartId}:\${input.lineItemId}:\${randomUUID()}\`,`,
    )
    .replace(
      '      aggregate: { type: "cart", id: input.cartId },\n      sourcePayload:',
      '      aggregate: { type: "cart", id: input.cartId },\n      anonymousId: identity.anonymousId,\n      sessionId: identity.sessionId,\n      correlationId: `cart:${input.cartId}`,\n      sourcePayload:',
    )
}

function generatedOccurredAt() {
  return `export function normalizeOccurredAt(value: unknown): string | null {\n  if (typeof value === "string") return value.trim() || null\n  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()\n  return null\n}\n`
}

function generatedManagedDeliveryDispatcherTail() {
  return `
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

function generatedManagedDeliveryDispatcher() {
  return generatedManagedDeliveryDispatcherHeader()
}

function generatedSubscriber(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const reliability = JSON.stringify(manifest.reliability)
  return `import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"\nimport { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"\nimport { createManagedDeliveryDispatcher } from "../funnelmetry/managed-delivery-dispatcher"\n\ntype OrderPlacedData = { id: string }\ntype OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: number }\ntype Order = { id: string; created_at?: string; currency_code?: string; total?: number; items?: OrderItem[] }\ntype Logger = { warn: (message: string) => void }\ntype MedusaContainer = SubscriberArgs<OrderPlacedData>["container"]\n\nconst sourceId = ${sourceId}\nconst sourceKeyId = ${sourceKeyId}\nconst reliability = ${reliability}\nlet dispatcher: ReturnType<typeof createManagedDeliveryDispatcher> | undefined\nlet lastInactiveWarningAt = 0\n\nfunction getDispatcher(logger: Logger) {\n  if (dispatcher) return dispatcher\n  const signingKey = process.env.FUNNELMETRY_BACKEND_SIGNING_KEY ?? ""\n  if (!signingKey) {\n    if (Date.now() - lastInactiveWarningAt >= 60000) {\n      lastInactiveWarningAt = Date.now()\n      logger.warn("Funnelmetry backend integration is inactive: signing key is not configured")\n    }\n    return null\n  }\n  dispatcher = createManagedDeliveryDispatcher({\n    sourceId,\n    sourceKeyId,\n    endpoint: process.env.FUNNELMETRY_INGEST_URL ?? "",\n    signingKey,\n    timeoutMs: reliability.timeoutMs,\n    maxAttempts: reliability.retry.maxAttempts,\n    maxQueueSize: reliability.maxQueueSize,\n    failureThreshold: reliability.circuitBreaker.failureThreshold,\n    cooldownMs: reliability.circuitBreaker.cooldownMs,\n    logger,\n  })\n  return dispatcher\n}\n\nasync function enqueueOrderPlaced(orderId: string, container: MedusaContainer, logger: Logger) {\n  try {\n    const orderModuleService = container.resolve(Modules.ORDER) as { retrieveOrder: (id: string, options: Record<string, unknown>) => Promise<Order> }\n    const order = await orderModuleService.retrieveOrder(orderId, { relations: ["items"] })\n    if (!order.created_at || !order.currency_code) {\n      logger.warn("Funnelmetry order forward skipped: missing authoritative order time/currency")\n      return\n    }\n    getDispatcher(logger)?.enqueue({\n      eventId: \`medusa:order.placed:\${orderId}\`,\n      sourceEventType: "medusa.order_placed",\n      occurredAt: order.created_at,\n      aggregate: { type: "order", id: order.id },\n      sourcePayload: { order_id: order.id, currency_code: order.currency_code, total_minor: order.total, items: (order.items ?? []).map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: item.unit_price })) },\n    })\n  } catch (error) {\n    logger.warn(\`Funnelmetry order enqueue failed open: \${error instanceof Error ? error.message : "unknown error"}\`)\n  }\n}\n\nexport default function funnelmetryOrderPlaced({ event, container }: SubscriberArgs<OrderPlacedData>) {\n  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger\n  void enqueueOrderPlaced(event.data.id, container, logger)\n}\n\nexport const config: SubscriberConfig = { event: "order.placed" }\n`
}

function stripSupersededBrowserHooks(content) {
  return content
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
    .replace("ContainerRegistrationKeys, Modules", "ContainerRegistrationKeys")
    .replace(
      'import { createManagedDeliveryDispatcher } from "../funnelmetry/managed-delivery-dispatcher"\n',
      'import { createManagedDeliveryDispatcher } from "../funnelmetry/managed-delivery-dispatcher"\nimport { normalizeOccurredAt } from "../funnelmetry/occurred-at"\n',
    )
    .replace(
      'type OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: number }\ntype Order = { id: string; created_at?: string; currency_code?: string; total?: number; items?: OrderItem[] }',
      'type OrderItem = { product_id?: string; variant_id?: string; quantity?: number; unit_price?: unknown }\ntype LinkedCart = { id?: string }\ntype Order = { id: string; created_at?: string | Date; currency_code?: string; total?: unknown; items?: OrderItem[]; cart?: LinkedCart | LinkedCart[] }\ntype Query = { graph: (input: Record<string, unknown>) => Promise<{ data: Order[] }> }',
    )
    .replace(
      "let lastInactiveWarningAt = 0",
      `let lastInactiveWarningAt = 0

function linkedCartId(order: Order) {
  const cart = Array.isArray(order.cart) ? order.cart[0] : order.cart
  return typeof cart?.id === "string" && cart.id.length > 0 ? cart.id : null
}`,
    )
    .replace(
      '    const orderModuleService = container.resolve(Modules.ORDER) as { retrieveOrder: (id: string, options: Record<string, unknown>) => Promise<Order> }\n    const order = await orderModuleService.retrieveOrder(orderId, { relations: ["items"] })',
      '    const { normalizeCurrencyCode, normalizeMajorAmount } = await import("@3002tad/funnelmetry-backend-integration-kit")\n    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query\n    const { data } = await query.graph({ entity: "order", fields: ["id", "created_at", "currency_code", "total", "items.product_id", "items.variant_id", "items.quantity", "items.unit_price", "cart.id"], filters: { id: orderId } })\n    const order = data[0]',
    )
    .replace(
      '    if (!order.created_at || !order.currency_code) {',
      '    const occurredAt = normalizeOccurredAt(order?.created_at)\n    const currencyCode = normalizeCurrencyCode(order?.currency_code)\n    const totalAmount = normalizeMajorAmount(order?.total)\n    const cartId = order ? linkedCartId(order) : null\n    if (!order || !occurredAt || !currencyCode || !totalAmount || !cartId) {',
    )
    .replace(
      'logger.warn("Funnelmetry order forward skipped: missing authoritative order time/currency")',
      'logger.warn("Funnelmetry order forward skipped: missing authoritative order/cart/time/amount/currency")',
    )
    .replace('occurredAt: order.created_at,', 'occurredAt,')
    .replace(
      '      aggregate: { type: "order", id: order.id },\n      sourcePayload: { order_id: order.id, currency_code: order.currency_code, total_minor: order.total, items: (order.items ?? []).map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: item.unit_price })) },',
      '      sourceSchemaVersion: "2.0",\n      aggregate: { type: "order", id: order.id },\n      correlationId: `cart:${cartId}`,\n      sourcePayload: { order_id: order.id, cart_id: cartId, currency_code: currencyCode, total_amount: totalAmount, amount_unit: "major", amount_semantics: "medusa.order.total", items: (order.items ?? []).map((item) => { const unitPriceAmount = normalizeMajorAmount(item.unit_price); return { product_id: item.product_id, variant_id: item.variant_id, quantity: item.quantity, ...(unitPriceAmount ? { unit_price_amount: unitPriceAmount } : {}) } }) },',
    )
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
  // Generated snippets may use escaped line breaks to keep the planner readable.
  const decodedSearch = search.replace(/\\n/g, "\n")
  const decodedReplacement = replacement.replace(/\\n/g, "\n")
  if (!content.includes(decodedSearch)) throw new Error(`Pinned Medusa layout changed: cannot patch ${file}`)
  return content.replace(decodedSearch, decodedReplacement)
}

function installStoreSearchOnPinnedMain(originals) {
  const cart = originals[paths.cartData] === null ? null : normalizedText(originals[paths.cartData])
  const storePage = originals[paths.storePage] === null ? null : normalizedText(originals[paths.storePage])
  const storeTemplate = originals[paths.storeTemplate] === null ? null : normalizedText(originals[paths.storeTemplate])
  const paginatedProducts = originals[paths.paginatedProducts] === null ? null : normalizedText(originals[paths.paginatedProducts])
  if ([cart, storePage, storeTemplate, paginatedProducts].some((value) => value === null)) {
    throw new Error("Pinned Medusa main storefront is missing a required search-hook host file")
  }
  // Refuse a mixed/partially installed storefront instead of silently rewriting it.
  for (const [file, content] of [[paths.storePage, storePage], [paths.storeTemplate, storeTemplate], [paths.paginatedProducts, paginatedProducts]]) {
    if (content.includes("StoreSearch") || content.includes("searchInteractionId") || content.includes("enqueueSearchOutcome")) {
      throw new Error(`Pinned Medusa storefront has a partial search installation in ${file}`)
    }
  }
  const bindings = {
    available: true,
    cart: replaceOnce(
      replaceOnce(cart, 'import { getLocale } from "./locale-actions"', 'import { getLocale } from "./locale-actions"\nimport { enqueueCartItemAdded } from "@funnelmetry/server-delivery"', paths.cartData),
      '.then(async () => {\n      const cartCacheTag',
      '.then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {\n      const lineItem = cart.items?.find((item) => item.variant_id === variantId)\n      if (lineItem?.id && lineItem.variant_id && Number.isSafeInteger(lineItem.quantity)) {\n        enqueueCartItemAdded({ cartId: cart.id, lineItemId: lineItem.id, variantId: lineItem.variant_id, quantity, ...(lineItem.product_id ? { productId: lineItem.product_id } : {}) })\n      }\n      const cartCacheTag', paths.cartData,
    ),
    storeSearch: generatedStoreSearch(),
    storePage: replaceOnce(
      replaceOnce(
        replaceOnce(storePage, '  page?: string\n  optionValueIds?', '  page?: string\n  q?: string\n  fm_search_interaction_id?: string\n  optionValueIds?', paths.storePage),
        '  const { sortBy, page } = searchParams',
        '  const { sortBy, page, q, fm_search_interaction_id: searchInteractionId } = searchParams', paths.storePage,
      ),
      '      optionValueIds={optionValueIds}',
      '      optionValueIds={optionValueIds}\n      query={typeof q === "string" ? q : undefined}\n      searchInteractionId={typeof searchInteractionId === "string" ? searchInteractionId : undefined}', paths.storePage,
    ),
    storeTemplate: replaceOnce(
      replaceOnce(
        replaceOnce(
          replaceOnce(storeTemplate,
            'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"',
            'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"\nimport StoreSearch from "@modules/store/components/store-search"', paths.storeTemplate),
          '  optionValueIds,\n}: {',
          '  optionValueIds,\n  query,\n  searchInteractionId,\n}: {', paths.storeTemplate),
        '  optionValueIds?: OptionValueIds\n}) => {',
        '  optionValueIds?: OptionValueIds\n  query?: string\n  searchInteractionId?: string\n}) => {', paths.storeTemplate),
      '        </div>\n        <Suspense fallback={<SkeletonProductGrid />}>',
      '          <div className="mt-6">\n            <StoreSearch initialQuery={query} />\n          </div>\n        </div>\n        <Suspense fallback={<SkeletonProductGrid />}>', paths.storeTemplate,
    ),
    paginatedProducts: replaceOnce(
      replaceOnce(
        replaceOnce(
          replaceOnce(paginatedProducts,
            'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"',
            'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"\nimport { enqueueSearchOutcome } from "@funnelmetry/server-delivery"', paths.paginatedProducts),
          '  order?: string\n}', '  order?: string\n  q?: string\n}', paths.paginatedProducts),
        '  optionValueIds,\n}: {',
        '  optionValueIds,\n  query,\n  searchInteractionId,\n}: {', paths.paginatedProducts),
      '  optionValueIds?: OptionValueIds\n}) {',
      '  optionValueIds?: OptionValueIds\n  query?: string\n  searchInteractionId?: string\n}) {', paths.paginatedProducts,
    ),
  }
  bindings.storeTemplate = replaceOnce(bindings.storeTemplate,
    '            optionValueIds={optionValueIds}\n          />',
    '            optionValueIds={optionValueIds}\n            query={query}\n            searchInteractionId={searchInteractionId}\n          />', paths.storeTemplate)
  bindings.paginatedProducts = replaceOnce(bindings.paginatedProducts,
    '  const region = await getRegion(countryCode)',
    '  if (query?.trim()) {\n    queryParams["q"] = query.trim()\n  }\n\n  const region = await getRegion(countryCode)', paths.paginatedProducts)
  bindings.paginatedProducts = replaceOnce(bindings.paginatedProducts,
    '  const {\n    response: { products, count },\n  } = await listProductsWithSort({\n    page,\n    queryParams,\n    sortBy,\n    countryCode,\n    optionValueIds,\n  })',
    '  let products: Awaited<ReturnType<typeof listProductsWithSort>>["response"]["products"]\n  let count: number\n  try {\n    const response = await listProductsWithSort({ page, queryParams, sortBy, countryCode, optionValueIds })\n    products = response.response.products\n    count = response.response.count\n  } catch (error) {\n    if (query && searchInteractionId) enqueueSearchOutcome({ searchInteractionId, query, outcome: "failed" })\n    throw error\n  }\n  if (query && searchInteractionId) enqueueSearchOutcome({ searchInteractionId, query, outcome: "succeeded", resultCount: count })', paths.paginatedProducts)
  return bindings
}

function v2SemanticBindings(originals) {
  const cart = originals[paths.cartData]
  const storeSearch = originals[paths.storeSearch]
  const storePage = originals[paths.storePage]
  const storeTemplate = originals[paths.storeTemplate]
  const paginatedProducts = originals[paths.paginatedProducts]
  const available = [cart, storeSearch, storePage, storeTemplate, paginatedProducts].filter((value) => value !== null).length
  if (available === 4 && storeSearch === null) return installStoreSearchOnPinnedMain(originals)
  if (available !== 0 && available !== 5) {
    throw new Error("Pinned Medusa storefront is missing one or more V2 semantic-hook files")
  }
  if (available === 0) return { available: false }

  return {
    available: true,
    cart: replaceOnce(
      replaceOnce(cart, 'import { getLocale } from "./locale-actions"', 'import { getLocale } from "./locale-actions"\\nimport { enqueueCartItemAdded } from "@funnelmetry/server-delivery"', paths.cartData),
      '.then(async () => {\\n      const cartCacheTag',
      '.then(async ({ cart }: { cart: HttpTypes.StoreCart }) => {\\n      const lineItem = cart.items?.find((item) => item.variant_id === variantId)\\n      if (lineItem?.id && lineItem.variant_id && Number.isSafeInteger(lineItem.quantity)) {\\n        enqueueCartItemAdded({ cartId: cart.id, lineItemId: lineItem.id, variantId: lineItem.variant_id, quantity, ...(lineItem.product_id ? { productId: lineItem.product_id } : {}) })\\n      }\\n      const cartCacheTag',
      paths.cartData,
    ),
    storeSearch: replaceOnce(
      replaceOnce(
        replaceOnce(storeSearch, 'import { trackSearchSubmitted } from "@funnelmetry/client"\\n\\n', '', paths.storeSearch),
        'const StoreSearch = ({ initialQuery = "" }: StoreSearchProps) => {',
        'function createSearchInteractionId() {\\n  try {\\n    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `search:${crypto.randomUUID()}`\\n  } catch {\\n    // Tracking identity generation must not block navigation.\\n  }\\n  return `search:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`\\n}\\n\\nconst StoreSearch = ({ initialQuery = "" }: StoreSearchProps) => {',
        paths.storeSearch,
      ),
      '    void trackSearchSubmitted(normalizedQuery.length)\\n\\n    const params = new URLSearchParams(searchParams.toString())\\n    params.delete("page")\\n    if (normalizedQuery) params.set("q", normalizedQuery)\\n    else params.delete("q")',
      '    const params = new URLSearchParams(searchParams.toString())\\n    params.delete("page")\\n    if (normalizedQuery) {\\n      params.set("q", normalizedQuery)\\n      params.set("fm_search_interaction_id", createSearchInteractionId())\\n    } else {\\n      params.delete("q")\\n      params.delete("fm_search_interaction_id")\\n    }',
      paths.storeSearch,
    ),
    storePage: replaceOnce(
      replaceOnce(
        replaceOnce(storePage, '  q?: string\\n  optionValueIds?', '  q?: string\\n  fm_search_interaction_id?: string\\n  optionValueIds?', paths.storePage),
        '  const { sortBy, page, q } = searchParams',
        '  const { sortBy, page, q, fm_search_interaction_id: searchInteractionId } = searchParams',
        paths.storePage,
      ),
      '      query={typeof q === "string" ? q : undefined}',
      '      query={typeof q === "string" ? q : undefined}\\n      searchInteractionId={typeof searchInteractionId === "string" ? searchInteractionId : undefined}',
      paths.storePage,
    ),
    storeTemplate: replaceOnce(
      replaceOnce(
        replaceOnce(storeTemplate, '  query?: string\\n}) => {', '  query?: string\\n  searchInteractionId?: string\\n}) => {', paths.storeTemplate),
        '  query,\\n}: {', '  query,\\n  searchInteractionId,\\n}: {', paths.storeTemplate),
      '            query={query}\\n          />',
      '            query={query}\\n            searchInteractionId={searchInteractionId}\\n          />',
      paths.storeTemplate,
    ),
    paginatedProducts: replaceOnce(
      replaceOnce(
        replaceOnce(
          replaceOnce(paginatedProducts, 'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"', 'import { SortOptions } from "@modules/store/components/refinement-list/sort-products"\\nimport { enqueueSearchOutcome } from "@funnelmetry/server-delivery"', paths.paginatedProducts),
          '  query,\\n}: {', '  query,\\n  searchInteractionId,\\n}: {', paths.paginatedProducts),
        '  query?: string\\n}) {', '  query?: string\\n  searchInteractionId?: string\\n}) {', paths.paginatedProducts),
      '  const {\\n    response: { products, count },\\n  } = await listProductsWithSort({\\n    page,\\n    queryParams,\\n    sortBy,\\n    countryCode,\\n    optionValueIds,\\n  })',
      '  let products: Awaited<ReturnType<typeof listProductsWithSort>>["response"]["products"]\\n  let count: number\\n  try {\\n    const response = await listProductsWithSort({ page, queryParams, sortBy, countryCode, optionValueIds })\\n    products = response.response.products\\n    count = response.response.count\\n  } catch (error) {\\n    if (query && searchInteractionId) enqueueSearchOutcome({ searchInteractionId, query, outcome: "failed" })\\n    throw error\\n  }\\n  if (query && searchInteractionId) enqueueSearchOutcome({ searchInteractionId, query, outcome: "succeeded", resultCount: count })',
      paths.paginatedProducts,
    ),
  }
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

function removeDependency(content, dependency, file) {
  let packageJson
  try { packageJson = JSON.parse(content) }
  catch { throw new Error(`Pinned Medusa layout has invalid JSON in ${file}`) }
  if (!Object.hasOwn(packageJson.dependencies ?? {}, dependency)) {
    throw new Error(`Expected installer-owned dependency is missing in ${file}`)
  }
  const dependencies = { ...packageJson.dependencies }
  delete dependencies[dependency]
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

function deletedFilePatch(file, before) {
  const lines = before.replace(/\n$/, "").split("\n")
  return `diff --git a/${file} b/${file}\ndeleted file mode 100644\n--- a/${file}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map(line => `-${line}`).join("\n")}\n`
}

function cdcOrderV2Artifact(manifest) {
  if (!manifest.cdcOrderV2Shadow) return null
  const profile = manifest.cdcOrderV2Shadow
  return `${JSON.stringify({
    schema_version: "funnelmetry-medusa-cdc-order-v2-shadow.v1",
    generated_by: "funnelmetry-medusa-ci",
    status: "SHADOW_ONLY",
    source_id: manifest.source.id,
    medusa_version: manifest.host.medusaVersion,
    cdc_reference_contract: profile.profile,
    coverage_epoch_id: profile.coverageEpochId,
    snapshot_mode: profile.snapshotMode,
    baseline_policy: "BASELINE_NEVER_ON",
    historical_gap_status: "INCOMPLETE",
    source_db_url_ref: profile.sourceDbUrlRef,
    source_owner: profile.sourceOwner,
    pipeline_owner: profile.pipelineOwner,
    publication: profile.publication,
    slot: profile.slot,
    topic_prefix: profile.topicPrefix,
    fact_topic: profile.factTopic,
    table_columns: profile.tableColumns,
    analytical_authority: "reference.medusa.order_recorded_state.v2",
    runtime_activation: "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
  }, null, 2)}\n`
}

function cdcCatalogArtifact(manifest, legacy = false) {
  if (!manifest.cdcCatalogShadow) return null
  const profile = manifest.cdcCatalogShadow
  return `${JSON.stringify({
    schema_version: legacy ? "funnelmetry-medusa-cdc-catalog-shadow.v1" : "funnelmetry-medusa-cdc-catalog-shadow.v2",
    generated_by: "funnelmetry-medusa-ci",
    status: "SHADOW_ONLY",
    source_id: manifest.source.id,
    medusa_version: manifest.host.medusaVersion,
    cdc_catalog_contract: profile.profile,
    source_db_url_ref: profile.sourceDbUrlRef,
    source_owner: profile.sourceOwner,
    pipeline_owner: profile.pipelineOwner,
    snapshot_mode: profile.snapshotMode,
    ...(!legacy && { coverage_epoch_id: profile.coverageEpochId }),
    publication: profile.publication,
    slot: profile.slot,
    topic_prefix: profile.topicPrefix,
    table_columns: profile.tableColumns,
    projection_stage: "PRODUCT_VARIANT_CATEGORY_ONLY",
    inventory_price_claims: "NOT_SUPPORTED",
    dashboard_cutover: "BLOCKED_PENDING_COVERAGE_AND_FRESHNESS",
    runtime_activation: "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
  }, null, 2)}\n`
}

function cdcInventoryPriceArtifact(manifest, legacy = false) {
  if (!manifest.cdcInventoryPriceShadow) return null
  const profile = manifest.cdcInventoryPriceShadow
  return `${JSON.stringify({
    schema_version: legacy ? "funnelmetry-medusa-cdc-inventory-price-shadow.v2" : "funnelmetry-medusa-cdc-inventory-price-shadow.v3",
    generated_by: "funnelmetry-medusa-ci",
    status: "SHADOW_ONLY",
    source_id: manifest.source.id,
    medusa_version: manifest.host.medusaVersion,
    cdc_inventory_price_contract: profile.profile,
    source_db_url_ref: profile.sourceDbUrlRef,
    source_owner: profile.sourceOwner,
    pipeline_owner: profile.pipelineOwner,
    snapshot_mode: profile.snapshotMode,
    ...(!legacy && { coverage_epoch_id: profile.coverageEpochId }),
    publication: profile.publication,
    slot: profile.slot,
    topic_prefix: profile.topicPrefix,
    table_columns: profile.tableColumns,
    projection_stage: "INVENTORY_PRICE_CONTEXT_ONLY",
    inventory_available_to_sell_claims: "NOT_PUBLISHED",
    storefront_display_price_claims: "NOT_PUBLISHED",
    historical_order_amount_restatement: "FORBIDDEN",
    runtime_activation: "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
  }, null, 2)}\n`
}

async function cdcShadowChange(projectRoot, manifest) {
  const current = await readOptionalProjectFile(projectRoot, generatedPaths.cdcShadowProfile)
  if (current === null) return null
  let profile
  try { profile = JSON.parse(current) } catch { throw new Error("Retired CDC v1 profile is invalid JSON") }
  if (profile.generated_by !== "funnelmetry-medusa-ci" ||
      profile.schema_version !== "funnelmetry-medusa-cdc-reference-shadow.v1" ||
      profile.source_id !== manifest.source.id) {
    throw new Error("Retired CDC v1 profile is not installer-owned; refusing deletion")
  }
  return { path: generatedPaths.cdcShadowProfile, before: current, after: null }
}

async function cdcOrderV2Change(projectRoot, manifest) {
  const current = await readOptionalProjectFile(projectRoot, generatedPaths.cdcOrderV2ShadowProfile)
  const expected = cdcOrderV2Artifact(manifest)
  if (!expected) {
    if (current !== null) throw new Error("Existing CDC order v2 profile cannot be removed by the CDC installer")
    return null
  }
  if (current === null) return { path: generatedPaths.cdcOrderV2ShadowProfile, before: null, after: expected }
  if (normalizedText(current) !== normalizedText(expected)) {
    let previous
    try { previous = JSON.parse(current) } catch { throw new Error("Existing CDC order v2 profile is invalid JSON") }
    const next = JSON.parse(expected)
    for (const field of ["generated_by", "schema_version", "source_id", "medusa_version",
      "cdc_reference_contract", "coverage_epoch_id", "snapshot_mode", "source_db_url_ref",
      "source_owner", "pipeline_owner", "publication", "slot", "topic_prefix", "fact_topic"]) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(next[field])) {
        throw new Error(`Existing CDC order v2 profile differs at ${field}; refusing migration`)
      }
    }
    if (JSON.stringify(previous.table_columns) !== JSON.stringify(next.table_columns)) {
      throw new Error("Existing CDC order v2 allowlist differs; refusing migration")
    }
    return { path: generatedPaths.cdcOrderV2ShadowProfile, before: current, after: expected }
  }
  return null
}

async function cdcCatalogChange(projectRoot, manifest) {
  const current = await readOptionalProjectFile(projectRoot, generatedPaths.cdcCatalogShadowProfile)
  const expected = cdcCatalogArtifact(manifest)
  if (!expected) {
    if (current !== null) throw new Error("Existing CDC catalog profile cannot be removed by the CDC installer")
    return null
  }
  if (current === null) return { path: generatedPaths.cdcCatalogShadowProfile, before: null, after: expected }
  if (normalizedText(current) === normalizedText(cdcCatalogArtifact(manifest, true))) {
    return { path: generatedPaths.cdcCatalogShadowProfile, before: current, after: expected }
  }
  if (normalizedText(current) !== normalizedText(expected)) {
    throw new Error("Existing CDC catalog profile differs; refusing unreviewed migration")
  }
  return null
}

async function cdcInventoryPriceChange(projectRoot, manifest) {
  const current = await readOptionalProjectFile(projectRoot, generatedPaths.cdcInventoryPriceShadowProfile)
  const expected = cdcInventoryPriceArtifact(manifest)
  if (!expected) {
    if (current !== null) throw new Error("Existing inventory/price profile cannot be removed by the CDC installer")
    return null
  }
  if (current === null) return { path: generatedPaths.cdcInventoryPriceShadowProfile, before: null, after: expected }
  if (normalizedText(current) === normalizedText(cdcInventoryPriceArtifact(manifest, true))) {
    return { path: generatedPaths.cdcInventoryPriceShadowProfile, before: current, after: expected }
  }
  if (normalizedText(current) !== normalizedText(expected)) {
    throw new Error("Existing inventory/price profile differs; refusing unreviewed migration")
  }
  return null
}

function cdcOrderV2OperatorPlan(manifest) {
  if (!manifest.cdcOrderV2Shadow) return null
  const profile = manifest.cdcOrderV2Shadow
  return {
    status: "CDC_REFERENCE_CONFIGURED",
    sourceOwner: profile.sourceOwner,
    pipelineOwner: profile.pipelineOwner,
    sourceDbUrlRef: profile.sourceDbUrlRef,
    coverageEpochId: profile.coverageEpochId,
    preconditions: [
      "Verify source PostgreSQL logical WAL, exact column allowlist and private replication access",
      "Verify a new slot, topic prefix, fact topic, mapper state and sink for this coverage epoch",
      "Reconcile the initial snapshot and BASELINE_COMPLETE before permitting post-baseline transitions",
      "Keep any previous WAL gap INCOMPLETE; preserve the approved CDC reference authority",
    ],
  }
}

function cdcCartLineItemArtifact(manifest) {
  const profile = manifest.cdcCartLineItem
  return `${JSON.stringify({
    schema_version: "funnelmetry-medusa-cdc-cart-line-item.v1",
    generated_by: "funnelmetry-medusa-ci",
    status: "ACTIVE_REFERENCE",
    source_id: manifest.source.id,
    medusa_version: manifest.host.medusaVersion,
    cdc_contract: profile.profile,
    snapshot_mode: profile.snapshotMode,
    baseline_policy: "SNAPSHOT_NEVER_EMITS_CART_ITEM_ADDED",
    quantity_policy: "INSERT_OR_POSITIVE_DELTA_ONLY",
    coverage_epoch_id: profile.coverageEpochId,
    source_db_url_ref: profile.sourceDbUrlRef,
    source_owner: profile.sourceOwner,
    pipeline_owner: profile.pipelineOwner,
    publication: profile.publication,
    slot: profile.slot,
    topic_prefix: profile.topicPrefix,
    table_columns: profile.tableColumns,
    runtime_activation: "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
  }, null, 2)}\n`
}

async function createTwoPathPlan(projectRoot, manifest, host, originals) {
  const existingClient = await readOptionalProjectFile(projectRoot, generatedPaths.browserClient)
  const existingDelivery = await readOptionalProjectFile(projectRoot, generatedPaths.storefrontDelivery)
  const existingCartProfile = await readOptionalProjectFile(projectRoot, generatedPaths.cdcCartLineItemProfile)
  const expectedCartProfile = cdcCartLineItemArtifact(manifest)
  const storefrontPackage = JSON.parse(originals[paths.storefrontPackage])
  const noBackendKit = !Object.hasOwn(storefrontPackage.dependencies ?? {},
    "@3002tad/funnelmetry-backend-integration-kit")
  if (existingClient !== null) {
    if (!existingClient.includes('export function trackSearchQuery(') ||
        !existingClient.includes('export function trackCartContext(') ||
        existingDelivery !== null || !noBackendKit ||
        normalizedText(existingCartProfile) !== normalizedText(expectedCartProfile) ||
        !originals[paths.storeSearch]?.includes('void trackSearchQuery(query, createSearchInteractionId())') ||
        !originals[paths.productActions]?.includes('void trackCartContext(cartId)') ||
        !normalizedText(originals[paths.cartData]).includes('return cart.id\n}\n\nexport async function updateLineItem') ||
        originals[paths.cartData]?.includes('enqueueCartItemAdded') ||
        originals[paths.paginatedProducts]?.includes('enqueueSearchOutcome')) {
      throw new Error("Two-path installer requires a clean Medusa main branch or an exact v3 installation")
    }
    return {
      schemaVersion: "funnelmetry-ci-plan.v3", mode: "plan-only", sourceMutation: false,
      integrationState: "exact", host, manifest, sourceFingerprint: sourceFingerprint(originals),
      capabilities: { behavior: "ENABLED", orderPlaced: "DISABLED", cartItemPersisted: "CDC_CONFIGURED",
        searchSubmitted: "BROWSER_SDK", cdcCartState: "CDC_CONFIGURED",
        cdcOrderV2State: "CDC_PRIMARY_REFERENCE", cdcCatalogState: "CDC_PRIMARY_REFERENCE",
        cdcInventoryPriceState: "CDC_PRIMARY_REFERENCE" },
      changes: [], patch: "",
    }
  }
  if (existingDelivery !== null || !noBackendKit || existingCartProfile !== null) {
    throw new Error("Two-path installer refuses a partial or previous server-hook installation; start from clean Medusa main")
  }

  const legacyManifest = {
    ...manifest, apiVersion: "funnelmetry.io/v2",
    ingest: { ...manifest.ingest, backendUrl: "http://source-ingress:32000/v1/ingress/events" },
    auth: { ...manifest.auth, backendSigningKeyRef: "FUNNELMETRY_BACKEND_SIGNING_KEY" },
    bindings: { ...manifest.bindings, storefrontServer: ["behavior.search_submitted", "cart.item_added"] },
  }
  const baseline = await createPlan(projectRoot, legacyManifest)
  const sections = baseline.patch.split(/(?=diff --git )/).filter(Boolean)
  const changes = []
  for (const section of sections) {
    const match = section.match(/^diff --git a\/(.+) b\/\1/m)
    if (!match) throw new Error("Two-path baseline patch is malformed")
    const file = match[1]
    if ([generatedPaths.storefrontDelivery, paths.cartData,
      generatedPaths.managedDeliveryDispatcher, generatedPaths.orderPlacedSubscriber,
      generatedPaths.occurredAt].includes(file)) continue
    const after = section.includes("\ndeleted file mode 100644\n") ? null
      : `${section.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++"))
        .map(line => line.slice(1)).join("\n")}\n`
    const before = await readOptionalProjectFile(projectRoot, file)
    changes.push({ path: file, before, after })
  }
  const changeFor = file => {
    const change = changes.find(item => item.path === file)
    if (!change) throw new Error(`Two-path baseline omitted ${file}`)
    return change
  }
  changeFor(paths.storefrontPackage).after = addDependency(
    originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk",
    twoPathBrowserSdkVersion, paths.storefrontPackage)
  changeFor(generatedPaths.browserClient).after = `${configureGeneratedClient(generatedClient(manifest), manifest)
    .trimEnd()}\n\nexport function trackSearchQuery(query: string, searchInteractionId: string) {\n  try {\n    if (!enabled("behavior.search_query_submitted")) return Promise.resolve({ status: "disabled_by_manifest" })\n    const page = activePageContext()\n    return page ? getSdk()?.trackSearchQuery(query, searchInteractionId, page.page_instance_id) ?? Promise.resolve({ status: "inactive" })\n      : Promise.resolve({ status: "inactive" })\n  } catch {\n    return Promise.resolve({ status: "inactive" })\n  }\n}\n\nexport function trackCartContext(cartId: string) {\n  try {\n    if (!enabled("context.cart_linked")) return Promise.resolve({ status: "disabled_by_manifest" })\n    const page = activePageContext()\n    return page ? getSdk()?.trackCartContext(cartId, page.page_instance_id) ?? Promise.resolve({ status: "inactive" })\n      : Promise.resolve({ status: "inactive" })\n  } catch {\n    return Promise.resolve({ status: "inactive" })\n  }\n}\n`
  changeFor(paths.storeSearch).after = generatedBrowserStoreSearch()
  const storePage = changeFor(paths.storePage)
  storePage.after = storePage.after
    .replace('  fm_search_interaction_id?: string\n', '')
    .replace('q, fm_search_interaction_id: searchInteractionId', 'q')
    .replace('      searchInteractionId={typeof searchInteractionId === "string" ? searchInteractionId : undefined}\n', '')
  const storeTemplate = changeFor(paths.storeTemplate)
  storeTemplate.after = storeTemplate.after
    .replace('  searchInteractionId,\n', '')
    .replace('  searchInteractionId?: string\n', '')
    .replace('            searchInteractionId={searchInteractionId}\n', '')
  const products = changeFor(paths.paginatedProducts)
  products.after = replaceOnce(normalizedText(originals[paths.paginatedProducts]),
    '  order?: string\n}', '  order?: string\n  q?: string\n}', paths.paginatedProducts)
  products.after = replaceOnce(products.after,
    '  optionValueIds,\n}: {', '  optionValueIds,\n  query,\n}: {', paths.paginatedProducts)
  products.after = replaceOnce(products.after,
    '  optionValueIds?: OptionValueIds\n}) {',
    '  optionValueIds?: OptionValueIds\n  query?: string\n}) {', paths.paginatedProducts)
  products.after = replaceOnce(products.after,
    '  const region = await getRegion(countryCode)',
    '  if (query?.trim()) queryParams["q"] = query.trim()\n\n  const region = await getRegion(countryCode)',
    paths.paginatedProducts)
  changes.push({ path: paths.cartData, before: originals[paths.cartData],
    after: replaceOnce(normalizedText(originals[paths.cartData]),
      '    .catch(medusaError)\n}\n\nexport async function updateLineItem',
      '    .catch(medusaError)\n  return cart.id\n}\n\nexport async function updateLineItem',
      paths.cartData) })
  let productActions = replaceOnce(normalizedText(originals[paths.productActions]),
    'import { addToCart } from "@lib/data/cart"',
    'import { addToCart } from "@lib/data/cart"\nimport { trackCartContext } from "@funnelmetry/client"',
    paths.productActions)
  productActions = replaceOnce(productActions,
    '    await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })',
    '    const cartId = await addToCart({\n      variantId: selectedVariant.id,\n      quantity: 1,\n      countryCode,\n    })\n    if (cartId) void trackCartContext(cartId)',
    paths.productActions)
  changes.push({ path: paths.productActions, before: originals[paths.productActions],
    after: productActions })
  changes.push({ path: generatedPaths.cdcCartLineItemProfile, before: null, after: expectedCartProfile })
  const effective = changes.filter(change => change.before === null ||
    normalizedText(change.before) !== normalizedText(change.after))
  return {
    schemaVersion: "funnelmetry-ci-plan.v3", mode: "plan-only", sourceMutation: false,
    integrationState: "absent", host, manifest, sourceFingerprint: sourceFingerprint(originals),
    capabilities: { behavior: "ENABLED", orderPlaced: "DISABLED", cartItemPersisted: "CDC_CONFIGURED",
      searchSubmitted: "BROWSER_SDK", cdcCartState: "CDC_CONFIGURED",
      cdcOrderV2State: "CDC_PRIMARY_REFERENCE", cdcCatalogState: "CDC_PRIMARY_REFERENCE",
      cdcInventoryPriceState: "CDC_PRIMARY_REFERENCE" },
    changes: effective.map(({ path: file }) => ({ path: file, ownership: "funnelmetry-installer" })),
    patch: effective.map(({ path: file, before, after }) => after === null
      ? deletedFilePatch(file, before) : wholeFilePatch(file, before, after)).join(""),
  }
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
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^const sourceId = .+$/m, "const sourceId = __MANAGED__")
    .replace(/^const sourceKeyId = .+$/m, "const sourceKeyId = __MANAGED__")
    .replace(/^const allowedEventTypes = .+$/m, "const allowedEventTypes = __MANAGED__")
    .replace(/^const reliability = .+$/m, "const reliability = __MANAGED__")
    .replace(/^      endpoint: .+,$/m, "      endpoint: __MANAGED__,")
    .replace(/^      writeKey: .+,$/m, "      writeKey: __MANAGED__,")
}

function hasLegacyCheckoutStartedBinding(browserClient, checkoutPage) {
  return normalizedText(browserClient).includes('export function FunnelmetryCheckoutStarted({ cartId, step }: { cartId: string; step: string })') &&
    normalizedText(browserClient).includes('void track("checkout.started", { cart_id: cartId, step,') &&
    normalizedText(checkoutPage).includes('<FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />')
}

function upgradeCheckoutStartedBinding(content, file) {
  return replaceOnce(
    content,
    '<FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />',
    '<FunnelmetryCheckoutStarted cartId={cart.id} />',
    file,
  )
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
  return version === targetVersion || version === "0.2.2" || version === "0.2.1" || version === "0.2.0" || version === "0.1.4" || version === "0.1.1" || version === "0.1.0"
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
    fingerprint.update(relativePath).update("\0").update(String(originals[relativePath] ?? ""))
  }
  return fingerprint.digest("hex")
}

async function existingIntegration(projectRoot, originals, manifest) {
  const [browserClient, consentNotice, storefrontDelivery, managedDeliveryDispatcher, occurredAt, orderPlacedSubscriber] = await Promise.all([
    readOptionalProjectFile(projectRoot, generatedPaths.browserClient),
    readOptionalProjectFile(projectRoot, generatedPaths.consentNotice),
    readOptionalProjectFile(projectRoot, generatedPaths.storefrontDelivery),
    readOptionalProjectFile(projectRoot, generatedPaths.managedDeliveryDispatcher),
    readOptionalProjectFile(projectRoot, generatedPaths.occurredAt),
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
  const detected = browserClient !== null || consentNotice !== null || storefrontDelivery !== null || managedDeliveryDispatcher !== null || occurredAt !== null || orderPlacedSubscriber !== null ||
    originals[paths.storefrontPackage].includes("@3002tad/funnelmetry-browser-sdk") ||
    originals[paths.backendPackage].includes("@3002tad/funnelmetry-backend-integration-kit")

  if (!detected) return "absent"
  const semanticFiles = [originals[paths.cartData], originals[paths.storeSearch], originals[paths.storePage], originals[paths.storeTemplate], originals[paths.paginatedProducts]]
  const semanticCount = semanticFiles.filter((value) => value !== null).length
  if (semanticCount !== 0 && semanticCount !== semanticFiles.length) {
    throw new Error("Pinned Medusa storefront is missing one or more V2 semantic-hook files")
  }
  const semantic = { available: semanticCount === semanticFiles.length }
  const v2GeneratedFilesPresent = consentNotice !== null && storefrontDelivery !== null
  if (!v2GeneratedFilesPresent) return "legacy"
  const checkoutStartNeedsUpgrade = manifest.frontend.enabled && hasLegacyCheckoutStartedBinding(browserClient, originals[paths.checkoutPage])
  const packageUpgradeNeeded =
    (manifest.frontend.enabled && !packageHasDependency(originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk", packageVersions.browserSdk, paths.storefrontPackage)) ||
    (manifest.frontend.enabled && !packageHasDependency(originals[paths.storefrontPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.storefrontPackage)) ||
    (manifest.backend.enabled && !packageHasDependency(originals[paths.backendPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.backendPackage))
  const managedUpgradeNeeded = checkoutStartNeedsUpgrade || packageUpgradeNeeded
  if (normalizeManagedBrowserClient(browserClient) !== normalizeManagedBrowserClient(expectedBrowserClient) && !managedUpgradeNeeded) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.browserClient} differs at line ${firstDifferentLine(browserClient, expectedBrowserClient)}`)
  }
  if (normalizeManagedOrderPlacedSubscriber(orderPlacedSubscriber) !== normalizeManagedOrderPlacedSubscriber(expectedOrderPlacedSubscriber) && !managedUpgradeNeeded) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.orderPlacedSubscriber} differs at line ${firstDifferentLine(orderPlacedSubscriber, expectedOrderPlacedSubscriber)}`)
  }
  if (normalizedText(managedDeliveryDispatcher) !== normalizedText(expectedManagedDeliveryDispatcher) && !managedUpgradeNeeded) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.managedDeliveryDispatcher} differs at line ${firstDifferentLine(managedDeliveryDispatcher, expectedManagedDeliveryDispatcher)}`)
  }
  if (!normalizedText(consentNotice).includes(`const consentStorageKey = ${JSON.stringify(`funnelmetry.browser.consent.v1.${manifest.source.id}`)}`) ||
      !normalizedText(consentNotice).includes("Closing this notice enables tracking for this browser.")) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.consentNotice}`)
  }
  if (!normalizedText(storefrontDelivery).includes('sourceEventType: "behavior.search_submitted"') ||
      !normalizedText(storefrontDelivery).includes('sourceEventType: "cart.item_added"') ||
      !normalizedText(storefrontDelivery).includes("normalizeSearchQuery")) {
    throw new Error(`Existing Funnelmetry integration is partial, stale, or owned by another installer version: ${generatedPaths.storefrontDelivery}`)
  }
  if (manifest.frontend.enabled) {
    if (!isKnownManagedPackageVersion(originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk", packageVersions.browserSdk, paths.storefrontPackage)) {
      throw new Error("Existing Funnelmetry browser integration has an unexpected package version")
    }
    if (!isKnownManagedPackageVersion(originals[paths.storefrontPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.storefrontPackage)) {
      throw new Error("Existing Funnelmetry storefront server integration has an unexpected package version")
    }
    if (!hasFunnelmetryAlias(originals[paths.storefrontTsConfig], paths.storefrontTsConfig)) {
      throw new Error(`Existing Funnelmetry integration is incomplete or has drifted in ${paths.storefrontTsConfig}`)
    }
    requireMarker(originals[paths.storefrontLayout], 'import { FunnelmetryBootstrap } from "@funnelmetry/client"', paths.storefrontLayout)
    requireMarker(originals[paths.storefrontLayout], 'import { FunnelmetryConsentNotice } from "@funnelmetry/consent-notice"', paths.storefrontLayout)
    requireMarker(originals[paths.storefrontLayout], "<FunnelmetryConsentNotice />", paths.storefrontLayout)
    requireMarker(originals[paths.storefrontLayout], "<FunnelmetryBootstrap />", paths.storefrontLayout)
    requireMarker(originals[paths.productPage], 'import { FunnelmetryProductViewed } from "@funnelmetry/client"', paths.productPage)
    requireMarker(originals[paths.productPage], "<FunnelmetryProductViewed productId={pricedProduct.id} />", paths.productPage)
    requireMarker(originals[paths.checkoutPage], 'import { FunnelmetryCheckoutStarted } from "@funnelmetry/client"', paths.checkoutPage)
    requireMarker(
      originals[paths.checkoutPage],
      checkoutStartNeedsUpgrade
        ? "<FunnelmetryCheckoutStarted cartId={cart.id} step={currentStep} />"
        : "<FunnelmetryCheckoutStarted cartId={cart.id} />",
      paths.checkoutPage,
    )
  }
  if (semantic.available) {
    requireMarker(originals[paths.cartData], "enqueueCartItemAdded", paths.cartData)
    requireMarker(originals[paths.storeSearch], "fm_search_interaction_id", paths.storeSearch)
    requireMarker(originals[paths.paginatedProducts], "enqueueSearchOutcome", paths.paginatedProducts)
  }
  if (manifest.backend.enabled && !isKnownManagedPackageVersion(originals[paths.backendPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.backendPackage)) {
    throw new Error("Existing Funnelmetry backend integration has an unexpected package version")
  }
  if (managedUpgradeNeeded) return "upgradeable"
  const exact = normalizedText(browserClient) === normalizedText(expectedBrowserClient) &&
    normalizedText(orderPlacedSubscriber) === normalizedText(expectedOrderPlacedSubscriber) &&
    normalizedText(managedDeliveryDispatcher) === normalizedText(expectedManagedDeliveryDispatcher) &&
    normalizedText(consentNotice) === normalizedText(generatedConsentNotice(manifest)) &&
    normalizedText(storefrontDelivery) === normalizedText(configuredStorefrontDelivery(manifest)) &&
    (!manifest.frontend.enabled || (packageHasDependency(originals[paths.storefrontPackage], "@3002tad/funnelmetry-browser-sdk", packageVersions.browserSdk, paths.storefrontPackage) && packageHasDependency(originals[paths.storefrontPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.storefrontPackage))) &&
    (!manifest.backend.enabled || packageHasDependency(originals[paths.backendPackage], "@3002tad/funnelmetry-backend-integration-kit", packageVersions.backendIntegrationKit, paths.backendPackage))
  // V2 sources created before installer 0.2.0 are accepted only when every
  // semantic marker is present. They are compatible, but not claimed byte-for-byte
  // identical to the new template.
  return exact ? "exact" : "v2-compatible"
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
    const semanticPath = ["cartData", "storeSearch", "storePage", "storeTemplate", "paginatedProducts"].includes(name)
    originals[relativePath] = semanticPath
      ? await readOptionalProjectFile(projectRoot, relativePath)
      : await readProjectFile(projectRoot, relativePath)
  }

  originals[generatedPaths.cdcShadowProfile] = await readOptionalProjectFile(projectRoot, generatedPaths.cdcShadowProfile)
  originals[generatedPaths.cdcOrderV2ShadowProfile] = await readOptionalProjectFile(projectRoot, generatedPaths.cdcOrderV2ShadowProfile)
  originals[generatedPaths.cdcCatalogShadowProfile] = await readOptionalProjectFile(projectRoot, generatedPaths.cdcCatalogShadowProfile)
  originals[generatedPaths.cdcInventoryPriceShadowProfile] = await readOptionalProjectFile(projectRoot, generatedPaths.cdcInventoryPriceShadowProfile)

  if (manifest.apiVersion === "funnelmetry.io/v3") {
    return createTwoPathPlan(projectRoot, manifest, host, originals)
  }

  // An existing Browser SDK installation may still carry the retired backend
  // subscriber. A fresh checkout falls through to the storefront installer.
  if (manifest.cdcBackendCutover && await readOptionalProjectFile(projectRoot, generatedPaths.browserClient) !== null) {
    const [subscriber, dispatcher] = await Promise.all([
      readOptionalProjectFile(projectRoot, generatedPaths.orderPlacedSubscriber),
      readOptionalProjectFile(projectRoot, generatedPaths.managedDeliveryDispatcher),
    ])
    if ((subscriber === null) !== (dispatcher === null)) {
      throw new Error("CDC backend cutover refuses a partial order adapter")
    }
    const installed = subscriber !== null
    const comparison = installed ? {
      ...manifest,
      bindings: { ...manifest.bindings, medusaBackend: ["medusa.order_placed"] },
      backend: { enabled: true, binding: "medusa.order_placed" },
    } : manifest
    const state = await existingIntegration(projectRoot, originals, comparison)
    if (!["exact", "v2-compatible", "upgradeable"].includes(state)) {
      throw new Error(`CDC backend cutover requires a fully installer-owned integration, got ${state}`)
    }
    const cdcChanges = [
      await cdcShadowChange(projectRoot, manifest),
      await cdcOrderV2Change(projectRoot, manifest),
      await cdcCatalogChange(projectRoot, manifest),
      await cdcInventoryPriceChange(projectRoot, manifest),
    ].filter(Boolean)
    const packageDependency = JSON.parse(originals[paths.backendPackage]).dependencies?.[
      "@3002tad/funnelmetry-backend-integration-kit"]
    if (installed && !isKnownManagedPackageVersion(originals[paths.backendPackage],
        "@3002tad/funnelmetry-backend-integration-kit",
        packageVersions.backendIntegrationKit, paths.backendPackage)) {
      throw new Error("CDC backend cutover refuses an unknown backend package version")
    }
    if (!installed && packageDependency !== undefined) {
      throw new Error("CDC backend cutover found a residual backend package dependency")
    }
    const occurredAt = await readOptionalProjectFile(projectRoot, generatedPaths.occurredAt)
    if (occurredAt !== null && !normalizedText(occurredAt).includes("normalizeOccurredAt")) {
      throw new Error("Retired backend occurred-at helper is not installer-owned")
    }
    const changes = [...cdcChanges]
    if (installed) changes.push(
      { path: paths.backendPackage, before: originals[paths.backendPackage],
        after: removeDependency(originals[paths.backendPackage],
          "@3002tad/funnelmetry-backend-integration-kit", paths.backendPackage) },
      { path: generatedPaths.orderPlacedSubscriber, before: subscriber, after: null },
      { path: generatedPaths.managedDeliveryDispatcher, before: dispatcher, after: null },
    )
    if (occurredAt !== null) changes.push({ path: generatedPaths.occurredAt, before: occurredAt, after: null })
    originals[generatedPaths.orderPlacedSubscriber] = subscriber
    originals[generatedPaths.managedDeliveryDispatcher] = dispatcher
    return {
      schemaVersion: "funnelmetry-ci-plan.v2", mode: "plan-only", sourceMutation: false,
      integrationState: installed ? "cdc-primary-cleanup-ready" : "cdc-primary",
      host, manifest, sourceFingerprint: sourceFingerprint(originals),
      cdcOrderV2OperatorPlan: cdcOrderV2OperatorPlan(manifest),
      capabilities: {
        behavior: "ENABLED", orderPlaced: "DISABLED", commerceConversion: "HISTORICAL_ONLY",
        cartItemPersisted: "ENABLED", searchSubmitted: "ENABLED",
        cdcReferenceState: "RETIRED_V1",
        cdcOrderV2State: "CDC_PRIMARY_REFERENCE",
        cdcCatalogState: manifest.cdcCatalogShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
        cdcInventoryPriceState: manifest.cdcInventoryPriceShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
      },
      changes: changes.map(({path:file}) => ({path:file,ownership:"funnelmetry-installer"})),
      patch: changes.map(({path:file,before,after}) => after === null
        ? deletedFilePatch(file,before) : wholeFilePatch(file,before,after)).join(""),
    }
  }

  const semanticSupported = [originals[paths.cartData], originals[paths.storePage], originals[paths.storeTemplate], originals[paths.paginatedProducts]].every((value) => value !== null)
  const existing = await existingIntegration(projectRoot, originals, manifest)
  const cdcChange = await cdcShadowChange(projectRoot, manifest)
  const orderV2Change = await cdcOrderV2Change(projectRoot, manifest)
  const catalogChange = await cdcCatalogChange(projectRoot, manifest)
  const inventoryPriceChange = await cdcInventoryPriceChange(projectRoot, manifest)
  const cdcChanges = [cdcChange, orderV2Change, catalogChange, inventoryPriceChange].filter(Boolean)
  const cartItemDeclared = manifest.bindings.storefrontServer.includes("cart.item_added")
  const searchDeclared = manifest.bindings.storefrontServer.includes("behavior.search_submitted")
  if (manifest.frontend.enabled && (cartItemDeclared || searchDeclared) && !semanticSupported) {
    throw new Error("Pinned Medusa storefront is missing required V2 semantic-hook host files")
  }
  if (existing === "exact") {
    return {
      schemaVersion: "funnelmetry-ci-plan.v2",
      mode: "plan-only",
      sourceMutation: false,
      integrationState: existing,
      host,
      manifest,
      sourceFingerprint: sourceFingerprint(originals),
      cdcOrderV2OperatorPlan: cdcOrderV2OperatorPlan(manifest),
      capabilities: {
        behavior: manifest.frontend.enabled ? "ENABLED" : "DISABLED",
        orderPlaced: "DISABLED",
        cartItemPersisted: cartItemDeclared && semanticSupported ? "ENABLED" : "NOT_SUPPORTED",
        searchSubmitted: searchDeclared && semanticSupported ? "ENABLED" : "NOT_SUPPORTED",
        orderCreated: "NOT_EMITTED",
        orderAccepted: "NOT_SUPPORTED",
        commerceConversion: "HISTORICAL_ONLY",
        payment: "NOT_REQUESTED",
        refund: "NOT_REQUESTED",
        cdcReferenceState: "RETIRED_V1",
        cdcOrderV2State: "CDC_PRIMARY_REFERENCE",
        cdcCatalogState: manifest.cdcCatalogShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
        cdcInventoryPriceState: manifest.cdcInventoryPriceShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
      },
      changes: cdcChanges.map(change => ({ path: change.path, ownership: "funnelmetry-installer" })),
      patch: cdcChanges.map(change => change.after === null
        ? deletedFilePatch(change.path, change.before)
        : wholeFilePatch(change.path, change.before, change.after)).join(""),
    }
  }

  const refreshManagedBinding = existing === "managed" || existing === "upgradeable" || existing === "v2-compatible"
  const [currentBrowserClient, currentConsentNotice, currentStorefrontDelivery, currentManagedDeliveryDispatcher, currentOccurredAt, currentOrderPlacedSubscriber] = refreshManagedBinding
    ? await Promise.all([
      readProjectFile(projectRoot, generatedPaths.browserClient),
      readProjectFile(projectRoot, generatedPaths.consentNotice),
      readProjectFile(projectRoot, generatedPaths.storefrontDelivery),
      readProjectFile(projectRoot, generatedPaths.managedDeliveryDispatcher),
      readProjectFile(projectRoot, generatedPaths.occurredAt),
      readProjectFile(projectRoot, generatedPaths.orderPlacedSubscriber),
    ])
    : [null, null, null, null, null, null]
  const checkoutStartNeedsUpgrade = manifest.frontend.enabled && refreshManagedBinding && hasLegacyCheckoutStartedBinding(currentBrowserClient, originals[paths.checkoutPage])

  const changes = []
  if (manifest.frontend.enabled) {
    const client = configureGeneratedClient(generatedClient(manifest), manifest)
    const storefrontTsConfig = addFunnelmetryAlias(
      originals[paths.storefrontTsConfig],
      paths.storefrontTsConfig,
    )
    const storefrontPackage = addDependency(
      addDependency(
        originals[paths.storefrontPackage],
        "@3002tad/funnelmetry-browser-sdk",
        packageVersions.browserSdk,
        paths.storefrontPackage,
      ),
      "@3002tad/funnelmetry-backend-integration-kit",
      packageVersions.backendIntegrationKit,
      paths.storefrontPackage,
    )
    const layoutWithImport = replaceOnce(
      originals[paths.storefrontLayout],
      'import "styles/globals.css"',
      'import "styles/globals.css"\nimport { FunnelmetryBootstrap } from "@funnelmetry/client"',
      paths.storefrontLayout,
    )
    const layoutWithConsentImport = replaceOnce(
      layoutWithImport,
      'import { FunnelmetryBootstrap } from "@funnelmetry/client"',
      'import { FunnelmetryBootstrap } from "@funnelmetry/client"\nimport { FunnelmetryConsentNotice } from "@funnelmetry/consent-notice"',
      paths.storefrontLayout,
    )
    const layout = replaceOnce(
      layoutWithConsentImport,
      "<body>",
      "<body>\n        <FunnelmetryConsentNotice />\n        <FunnelmetryBootstrap />",
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
    const checkout = refreshManagedBinding
      ? checkoutStartNeedsUpgrade
        ? upgradeCheckoutStartedBinding(originals[paths.checkoutPage], paths.checkoutPage)
        : originals[paths.checkoutPage]
      : replaceOnce(
        originals[paths.checkoutPage],
        'import CheckoutProgress from "@modules/checkout/components/checkout-progress"',
        'import CheckoutProgress from "@modules/checkout/components/checkout-progress"\nimport { FunnelmetryCheckoutStarted } from "@funnelmetry/client"',
        paths.checkoutPage,
      ).replace(
        '  return (\n    <div className="content-container py-10 small:py-14">',
        '  return (\n    <>\n      <FunnelmetryCheckoutStarted cartId={cart.id} />\n      <div className="content-container py-10 small:py-14">',
      ).replace(
        '    </div>\n  )\n}',
        '      </div>\n    </>\n  )\n}',
      )
    const semanticBindings = refreshManagedBinding ? { available: false } : v2SemanticBindings(originals)
    const productActions = originals[paths.productActions]
      .replace('import { trackCartAddClicked } from "@funnelmetry/client"\n', "")
      .replace('    void trackCartAddClicked({ productId: product.id, variantId: selectedVariant.id, quantity: 1 })\n\n', "")
    if (refreshManagedBinding) {
      changes.push(
        { path: paths.storefrontPackage, before: originals[paths.storefrontPackage], after: storefrontPackage },
        { path: generatedPaths.browserClient, before: currentBrowserClient, after: client },
        { path: generatedPaths.consentNotice, before: currentConsentNotice, after: generatedConsentNotice(manifest) },
        { path: generatedPaths.storefrontDelivery, before: currentStorefrontDelivery, after: configuredStorefrontDelivery(manifest) },
      )
      if (checkoutStartNeedsUpgrade) {
        changes.push({ path: paths.checkoutPage, before: originals[paths.checkoutPage], after: checkout })
      }
    } else {
      changes.push(
        { path: paths.storefrontTsConfig, before: originals[paths.storefrontTsConfig], after: storefrontTsConfig },
        { path: paths.storefrontPackage, before: originals[paths.storefrontPackage], after: storefrontPackage },
        { path: generatedPaths.browserClient, before: null, after: client },
        { path: generatedPaths.consentNotice, before: null, after: generatedConsentNotice(manifest) },
        { path: generatedPaths.storefrontDelivery, before: null, after: configuredStorefrontDelivery(manifest) },
        { path: paths.storefrontLayout, before: originals[paths.storefrontLayout], after: layout },
        { path: paths.productPage, before: originals[paths.productPage], after: productPage },
        { path: paths.productActions, before: originals[paths.productActions], after: productActions },
        { path: paths.checkoutPage, before: originals[paths.checkoutPage], after: checkout },
      )
      if (semanticBindings.available) {
        changes.push(
          { path: paths.cartData, before: originals[paths.cartData], after: semanticBindings.cart },
          { path: paths.storeSearch, before: originals[paths.storeSearch], after: semanticBindings.storeSearch },
          { path: paths.storePage, before: originals[paths.storePage], after: semanticBindings.storePage },
          { path: paths.storeTemplate, before: originals[paths.storeTemplate], after: semanticBindings.storeTemplate },
          { path: paths.paginatedProducts, before: originals[paths.paginatedProducts], after: semanticBindings.paginatedProducts },
        )
      }
    }
  }
  changes.push(...cdcChanges)

  const effectiveChanges = changes.filter(({ before, after }) => before === null || normalizedText(before) !== normalizedText(after))
  return {
    schemaVersion: "funnelmetry-ci-plan.v2",
    mode: "plan-only",
    sourceMutation: false,
    integrationState: existing,
    host,
    manifest,
    sourceFingerprint: sourceFingerprint(originals),
    cdcOrderV2OperatorPlan: cdcOrderV2OperatorPlan(manifest),
    capabilities: {
      behavior: manifest.frontend.enabled ? "ENABLED" : "DISABLED",
      orderPlaced: "DISABLED",
      cartItemPersisted: cartItemDeclared && semanticSupported ? "ENABLED" : "NOT_SUPPORTED",
      searchSubmitted: searchDeclared && semanticSupported ? "ENABLED" : "NOT_SUPPORTED",
      orderCreated: "NOT_EMITTED",
      orderAccepted: "NOT_SUPPORTED",
      commerceConversion: "HISTORICAL_ONLY",
      payment: "NOT_REQUESTED",
      refund: "NOT_REQUESTED",
      cdcReferenceState: "RETIRED_V1",
      cdcOrderV2State: "CDC_PRIMARY_REFERENCE",
      cdcCatalogState: manifest.cdcCatalogShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
      cdcInventoryPriceState: manifest.cdcInventoryPriceShadow ? "CDC_PRIMARY_REFERENCE" : "NOT_REQUESTED",
    },
    changes: effectiveChanges.map(({ path: file }) => ({ path: file, ownership: "funnelmetry-installer" })),
    patch: effectiveChanges.map(({ path: file, before, after }) => after === null
      ? deletedFilePatch(file, before) : wholeFilePatch(file, before, after)).join(""),
  }
}

export async function verifyIntegration(projectRoot, manifest) {
  const plan = await createPlan(projectRoot, manifest)
  if (plan.changes.length) {
    throw new Error(`Integration differs from manifest at ${plan.changes.map(change => change.path).join(", ")}`)
  }
  return {
    status: "pass",
    sourceMutation: false,
    integrationState: plan.integrationState,
    cdcReferenceState: plan.capabilities.cdcReferenceState,
    cdcOrderV2State: plan.capabilities.cdcOrderV2State,
    cdcCatalogState: plan.capabilities.cdcCatalogState,
    cdcInventoryPriceState: plan.capabilities.cdcInventoryPriceState,
    sourceFingerprint: plan.sourceFingerprint,
    runtimeConformance: "NOT_CHECKED_BY_INSTALLER",
  }
}
