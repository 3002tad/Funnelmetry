export function generatedBrowserClient(manifest) {
  const sourceId = JSON.stringify(manifest.source.id)
  const sourceKeyId = JSON.stringify(manifest.auth.sourceKeyId)
  const allowedEvents = JSON.stringify(manifest.bindings.browser)
  const endpoint = JSON.stringify(manifest.ingest.browserUrl)
  const reliability = JSON.stringify(manifest.reliability)
  const anonymousCookie = JSON.stringify(`funnelmetry_anonymous_id_${manifest.source.id}`)
  const sessionCookie = JSON.stringify(`funnelmetry_session_id_${manifest.source.id}`)
  return `"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { createBrowserSdk } from "@3002tad/funnelmetry-browser-sdk"

const sourceId = ${sourceId}
const sourceKeyId = ${sourceKeyId}
const allowedEventTypes = ${allowedEvents}
const reliability = ${reliability}
const anonymousIdentityCookie = ${anonymousCookie}
const sessionIdentityCookie = ${sessionCookie}

type EventPayload = Record<string, unknown>
type BrowserSdk = ReturnType<typeof createBrowserSdk>
type PageContext = { page_type: string; path_template: string; page_instance_id: string }

declare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }

let sdk: BrowserSdk | null | undefined
let activePage: { pathname: string; context: PageContext } | undefined

function enabled(eventType: string) { return allowedEventTypes.includes(eventType) }

function getSdk(): BrowserSdk | null {
  if (sdk !== undefined) return sdk
  try {
    sdk = createBrowserSdk({
      sourceId, sourceKeyId, endpoint: ${endpoint},
      writeKey: process.env.NEXT_PUBLIC_${manifest.auth.browserWriteKeyRef} ?? "",
      allowedEventTypes,
      maxAttempts: reliability.retry.maxAttempts,
      maxQueueSize: reliability.maxQueueSize,
      hasConsent: () => typeof window !== "undefined" && window.__FUNNELMETRY_CONSENT__ === true,
    })
  } catch (error) {
    sdk = null
    console.warn("Funnelmetry browser integration is inactive", error)
  }
  return sdk
}

function pageDescriptor(pathname: string | null) {
  const segments = (pathname || "/").split("/").filter(Boolean)
  const route = segments.length > 0 ? segments.slice(1) : []
  if (route.length === 0) return { page_type: "home", path_template: "/{countryCode}" }
  if (route[0] === "store") return { page_type: "catalog", path_template: "/{countryCode}/store" }
  if (route[0] === "products") return { page_type: "product", path_template: "/{countryCode}/products/{handle}" }
  if (route[0] === "checkout") return { page_type: "checkout", path_template: "/{countryCode}/checkout" }
  if (route[0] === "categories") return { page_type: "category", path_template: "/{countryCode}/categories/{category}" }
  if (route[0] === "collections") return { page_type: "collection", path_template: "/{countryCode}/collections/{handle}" }
  if (route[0] === "cart") return { page_type: "cart", path_template: "/{countryCode}/cart" }
  if (route[0] === "account") return { page_type: "account", path_template: "/{countryCode}/account" }
  return { page_type: "other", path_template: "/{countryCode}/other" }
}

function pageContext(pathname: string | null): PageContext | null {
  const key = pathname || "/"
  if (activePage?.pathname === key) return activePage.context
  const currentSdk = getSdk()
  if (!currentSdk) return null
  activePage = { pathname: key, context: currentSdk.createPageContext(pageDescriptor(pathname)) }
  return activePage.context
}

function activePageContext() { return pageContext(typeof window === "undefined" ? null : window.location.pathname) }
function cartCorrelationId(cartId: string) { return \`cart:\${cartId}\` }

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
}

export function FunnelmetryBootstrap() {
  const pathname = usePathname()
  useEffect(() => getSdk()?.attachLifecycle(), [])
  useEffect(() => {
    const currentSdk = getSdk()
    const page = pageContext(pathname)
    if (!currentSdk || !page) return
    syncServerIdentity(currentSdk)
    if (enabled("behavior.page_viewed")) void currentSdk.trackPageView(page)
    if (!enabled("behavior.scroll_depth_reached")) return
    return currentSdk.attachScrollDepthObserver({ page })
  }, [pathname])
  return null
}

export function FunnelmetryProductViewed({ productId, variantId }: { productId: string; variantId?: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    if (page) void track("behavior.product_viewed", { product_id: productId, ...(variantId ? { variant_id: variantId } : {}), page_instance_id: page.page_instance_id })
  }, [pathname, productId, variantId])
  return null
}

export function FunnelmetryCheckoutStarted({ cartId }: { cartId: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const page = pageContext(pathname)
    const currentSdk = getSdk()
    if (currentSdk && page && enabled("checkout.started")) void currentSdk.trackBehaviorOnce(\`checkout.started:\${cartId}\`, "checkout.started", { cart_id: cartId, step: "address", page_instance_id: page.page_instance_id }, { correlationId: cartCorrelationId(cartId) })
  }, [cartId, pathname])
  return null
}

export function trackFilterApplied(input: { filterKeys: string[]; activeFilterCount: number }) {
  const page = activePageContext()
  return page ? track("behavior.filter_applied", { page_instance_id: page.page_instance_id, filter_keys: input.filterKeys, active_filter_count: input.activeFilterCount }) : Promise.resolve({ status: "inactive" })
}

export function FunnelmetryPromotionBanner({ bannerId, placementId, campaignId, children }: { bannerId: string; placementId: string; campaignId?: string; children: ReactNode }) {
  const pathname = usePathname()
  const element = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const currentSdk = getSdk(); const page = pageContext(pathname)
    if (!currentSdk || !page || !element.current || !enabled("promotion.banner_impression")) return
    return currentSdk.attachBannerImpressionObserver({ element: element.current, bannerId, placementId, pageInstanceId: page.page_instance_id, ...(campaignId ? { campaignId } : {}) })
  }, [bannerId, campaignId, pathname, placementId])
  return <div ref={element} onClick={() => { const page = pageContext(pathname); if (page) void track("promotion.banner_clicked", { banner_id: bannerId, placement_id: placementId, page_instance_id: page.page_instance_id, ...(campaignId ? { campaign_id: campaignId } : {}) }) }}>{children}</div>
}

export function trackSearchQuery(query: string, searchInteractionId: string) {
  try {
    if (!enabled("behavior.search_query_submitted")) return Promise.resolve({ status: "disabled_by_manifest" })
    const page = activePageContext()
    return page ? getSdk()?.trackSearchQuery(query, searchInteractionId, page.page_instance_id) ?? Promise.resolve({ status: "inactive" }) : Promise.resolve({ status: "inactive" })
  } catch { return Promise.resolve({ status: "inactive" }) }
}

export function trackCartContext(cartId: string) {
  try {
    if (!enabled("context.cart_linked")) return Promise.resolve({ status: "disabled_by_manifest" })
    const page = activePageContext()
    return page ? getSdk()?.trackCartContext(cartId, page.page_instance_id) ?? Promise.resolve({ status: "inactive" }) : Promise.resolve({ status: "inactive" })
  } catch { return Promise.resolve({ status: "inactive" }) }
}
`
}
