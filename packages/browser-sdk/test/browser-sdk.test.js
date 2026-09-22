import assert from "node:assert/strict"
import test from "node:test"
import { createBrowserSdk } from "../src/index.js"

function receipt(status, eventId, extra = {}) {
  return JSON.stringify({ status, source_id: "medusa-reference", event_id: eventId, received_at: "2026-08-22T09:00:00.000Z", ...extra })
}

test("rejects event types outside the approved behavior catalog", () => {
  assert.throws(() => createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.raw_dom_captured"],
  }), /browser-producible in Behavior Event Catalog v2/)
})

test("keeps the same event in the queue until a durable receipt arrives", async () => {
  const sent = []
  let attempts = 0
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test/v1/ingress/events",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:stable-1",
    now: () => "2026-08-22T09:00:00.000Z",
    sleep: async () => {},
    fetch: async (_url, request) => {
      sent.push(JSON.parse(request.body))
      attempts += 1
      if (attempts < 3) throw new Error("network unavailable")
      return { status: 202, text: async () => receipt("accepted", "browser:stable-1", { ingestion_id: "ing_1" }) }
    },
  })

  await sdk.track("behavior.product_viewed", { product_id: "prod_1", page_instance_id: "page:product-1" })
  assert.equal(sent.length, 3)
  assert.equal(new Set(sent.map((event) => event.event_id)).size, 1)
  assert.ok(sent.every(event => event.source_schema_version === '2.0'))
  assert.equal(sdk.getMetrics().queued, 0)
})

test('restored custom queue cannot send v1 envelopes or retired events', async () => {
  let sends = 0
  const sdk = createBrowserSdk({
    sourceId: 'medusa-reference', sourceKeyId: 'browser', endpoint: 'https://example.test', writeKey: 'public',
    allowedEventTypes: ['behavior.product_viewed'], hasConsent: () => true, storageKey: 'custom-old-queue',
    storage: { getItem: () => JSON.stringify([{ source_id: 'medusa-reference', producer: 'browser_sdk', source_schema_version: '1.0', source_event_type: 'behavior.product_viewed', source_payload: { product_id: 'p1', page_instance_id: 'page:1' } }]), setItem() {} },
    fetch: async () => { sends++; throw new Error('Must not send stale queue') },
  })
  await sdk.flush()
  assert.equal(sends, 0)
  assert.equal(sdk.getMetrics().queued, 0)
})

test("does not enqueue browser data without explicit consent", async () => {
  let attributionWrites = 0
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => false,
    locationSearch: "?utm_source=MustNotPersist",
    attributionStorage: { getItem: () => null, setItem: () => { attributionWrites += 1 } },
    fetch: async () => { throw new Error("must not send") },
  })

  assert.deepEqual(await sdk.track("behavior.product_viewed", {
    product_id: "prod_1",
    page_instance_id: "page:product-1",
  }), { status: "skipped_no_consent" })
  assert.equal(sdk.getIdentity(), null)
  assert.equal(sdk.getSessionContext(), null)
  assert.equal(attributionWrites, 0)
})

test("persists consented browser identity and uses session correlation by default", async () => {
  const localValues = new Map()
  const sessionValues = new Map()
  const storage = (values) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  })
  const sent = []
  let sequence = 0
  const options = {
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    anonymousIdStorage: storage(localValues),
    sessionIdStorage: storage(sessionValues),
    createAnonymousId: () => "anonymous:stable-1",
    createSessionId: () => "session:stable-1",
    createEventId: () => `browser:identity-${++sequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      sent.push(event)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  }

  const sdk = createBrowserSdk(options)
  await sdk.track("behavior.product_viewed", { product_id: "prod_1", page_instance_id: "page:identity-1" })
  assert.deepEqual(sdk.getIdentity(), { anonymousId: "anonymous:stable-1", sessionId: "session:stable-1" })
  assert.equal(sent[0].anonymous_id, "anonymous:stable-1")
  assert.equal(sent[0].session_id, "session:stable-1")
  assert.equal(sent[0].correlation_id, "session:stable-1")

  const recreatedSdk = createBrowserSdk({
    ...options,
    createAnonymousId: () => { throw new Error("must restore anonymous identity") },
    createSessionId: () => { throw new Error("must restore session identity") },
  })
  assert.deepEqual(recreatedSdk.getIdentity(), { anonymousId: "anonymous:stable-1", sessionId: "session:stable-1" })
  await recreatedSdk.track("behavior.product_viewed", { product_id: "prod_1", page_instance_id: "page:identity-2" }, { correlationId: "cart:cart_1" })
  assert.equal(sent[1].correlation_id, "cart:cart_1")
})

test("keeps raw utm_source as first-touch session metadata on later behavior events", async () => {
  const attributionValues = new Map()
  const attributionStorage = {
    getItem: (key) => attributionValues.get(key) ?? null,
    setItem: (key, value) => attributionValues.set(key, value),
  }
  const sent = []
  let sequence = 0
  const baseOptions = {
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    attributionStorage,
    createEventId: () => `browser:utm-${++sequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      sent.push(event)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  }

  const landingSdk = createBrowserSdk({
    ...baseOptions,
    locationSearch: "?utm_source=Facebook%20Ads%2FPartner&utm_source=ignored&utm_medium=not-supported",
  })
  assert.equal(
    attributionValues.get("funnelmetry.browser.attribution.v1.medusa-reference"),
    "Facebook Ads/Partner",
  )
  await landingSdk.track("behavior.product_viewed", {
    product_id: "prod_1",
    page_instance_id: "page:utm-1",
  }, { metadata: { existing_context: "kept" } })
  assert.deepEqual(landingSdk.getSessionContext(), { utm_source: "Facebook Ads/Partner" })
  assert.deepEqual(sent[0].source_metadata, {
    existing_context: "kept",
    utm_source: "Facebook Ads/Partner",
  })

  const laterSdk = createBrowserSdk({ ...baseOptions, locationSearch: "?utm_source=LaterSource" })
  await laterSdk.track("behavior.product_viewed", {
    product_id: "prod_2",
    page_instance_id: "page:utm-2",
  })
  assert.deepEqual(laterSdk.getSessionContext(), { utm_source: "Facebook Ads/Partner" })
  assert.equal(sent[1].source_metadata.utm_source, "Facebook Ads/Partner")
  assert.equal("utm_medium" in sent[1].source_metadata, false)
})

test("drops only oversized automatic attribution metadata and keeps event delivery fail-open", async () => {
  let sent
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    locationSearch: `?utm_source=${"x".repeat(70_000)}`,
    createEventId: () => "browser:utm-oversized",
    fetch: async (_url, request) => {
      sent = JSON.parse(request.body)
      return { status: 202, text: async () => receipt("accepted", sent.event_id, { ingestion_id: "ing_utm_oversized" }) }
    },
  })

  assert.equal((await sdk.track("behavior.product_viewed", {
    product_id: "prod_1",
    page_instance_id: "page:utm-oversized",
  })).status, "drained")
  assert.equal(sent.source_metadata, undefined)
})

test("tracks checkout start once per cart for the current browser session", async () => {
  const onceValues = new Map()
  const onceStorage = { getItem: (key) => onceValues.get(key) ?? null, setItem: (key, value) => onceValues.set(key, value) }
  const sent = []
  let sequence = 0
  const options = {
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["checkout.started"],
    hasConsent: () => true,
    onceStorage,
    createEventId: () => `browser:checkout-${++sequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      sent.push(event)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  }
  const checkoutPayload = { cart_id: "cart_1", step: "address", page_instance_id: "page:checkout-1" }
  const sdk = createBrowserSdk(options)

  assert.equal((await sdk.trackBehaviorOnce("checkout.started:cart_1", "checkout.started", checkoutPayload)).status, "drained")
  assert.deepEqual(
    await sdk.trackBehaviorOnce("checkout.started:cart_1", "checkout.started", { ...checkoutPayload, page_instance_id: "page:checkout-2" }),
    { status: "skipped_duplicate_once" },
  )
  const recreatedSdk = createBrowserSdk(options)
  assert.deepEqual(
    await recreatedSdk.trackBehaviorOnce("checkout.started:cart_1", "checkout.started", { ...checkoutPayload, page_instance_id: "page:checkout-3" }),
    { status: "skipped_duplicate_once" },
  )
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].source_payload, checkoutPayload)
})

test("retains a retryable event for a later flush instead of silently dropping it", async () => {
  const storageValues = new Map()
  const storage = { getItem: (key) => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) }
  let available = false
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:stable-2",
    now: () => "2026-08-22T09:00:00.000Z",
    sleep: async () => {},
    storage,
    maxAttempts: 1,
    fetch: async () => {
      if (!available) throw new Error("unavailable")
      return { status: 202, text: async () => receipt("accepted", "browser:stable-2", { ingestion_id: "ing_2" }) }
    },
  })

  assert.equal((await sdk.track("behavior.product_viewed", {
    product_id: "prod_1",
    page_instance_id: "page:product-1",
  })).status, "retryable_failure")
  assert.equal(sdk.getMetrics().queued, 1)
  available = true
  await sdk.flush()
  assert.equal(sdk.getMetrics().queued, 0)
})

test("removes an event after a durable Relay receipt without counting it as Pipeline accepted", async () => {
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-relay",
    endpoint: "https://relay.example.test/v1/ingress/events",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:relay-stable-1",
    now: () => "2026-09-11T00:00:00.000Z",
    fetch: async () => ({
      status: 202,
      text: async () => JSON.stringify({
        specversion: "relay-receipt.v1",
        status: "relay_queued",
        relay_id: "rel_1",
        source_id: "medusa-reference",
        event_id: "browser:relay-stable-1",
        relay_received_at: "2026-09-11T00:00:00.000Z",
      }),
    }),
  })

  await sdk.track("behavior.product_viewed", { product_id: "prod_1", page_instance_id: "page:product-1" })
  assert.equal(sdk.getMetrics().queued, 0)
  assert.equal(sdk.getMetrics().relayQueued, 1)
  assert.equal(sdk.getMetrics().accepted, 0)
})

test("browser SDK cannot be configured to queue server-side search events", () => {
  assert.throws(() => createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.search_submitted"],
  }), /browser-producible in Behavior Event Catalog v2/)
})

test("page helper creates a stable page context and emits a validated page view", async () => {
  const sent = []
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.page_viewed"],
    hasConsent: () => true,
    createPageInstanceId: () => "page:generated-1",
    createEventId: () => "browser:page-1",
    fetch: async (_url, request) => {
      sent.push(JSON.parse(request.body))
      return { status: 202, text: async () => receipt("accepted", "browser:page-1", { ingestion_id: "ing_page_1" }) }
    },
  })

  const page = sdk.createPageContext({ page_type: "product", path_template: "/products/[handle]" })
  assert.deepEqual(page, {
    page_type: "product",
    path_template: "/products/[handle]",
    page_instance_id: "page:generated-1",
  })
  await sdk.trackPageView(page)
  assert.deepEqual(await sdk.trackPageView(page), { status: "skipped_duplicate_page_view" })
  assert.deepEqual(sent[0].source_payload, page)
  assert.equal(sent.length, 1)
})

test("scroll observer emits each milestone only once for an explicit page identity", async () => {
  const listeners = new Map()
  const browserWindow = {
    innerHeight: 100,
    scrollY: 0,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  }
  const documentImpl = { documentElement: { scrollHeight: 1_000, scrollTop: 0 }, body: { scrollHeight: 1_000 } }
  const sent = []
  let eventSequence = 0
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.scroll_depth_reached"],
    hasConsent: () => true,
    createEventId: () => `browser:scroll-${++eventSequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      sent.push(event)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  })

  const detach = sdk.attachScrollDepthObserver({
    page: { page_type: "catalog", page_instance_id: "page:catalog-1" },
    window: browserWindow,
    document: documentImpl,
    emitInitial: false,
  })
  browserWindow.scrollY = 500
  listeners.get("scroll")()
  listeners.get("scroll")()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sent.map((event) => event.source_payload.depth_percent), [25, 50])
  browserWindow.scrollY = 900
  listeners.get("scroll")()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sent.map((event) => event.source_payload.depth_percent), [25, 50, 75, 100])
  detach()
  assert.equal(listeners.size, 0)
})

test("banner observer waits for continuous visibility before emitting one impression", async () => {
  let observer
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const timers = []
  let clock = 0
  const sent = []
  const element = {}
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["promotion.banner_impression"],
    hasConsent: () => true,
    createEventId: () => "browser:banner-1",
    fetch: async (_url, request) => {
      sent.push(JSON.parse(request.body))
      return { status: 202, text: async () => receipt("accepted", "browser:banner-1", { ingestion_id: "ing_banner_1" }) }
    },
  })

  sdk.attachBannerImpressionObserver({
    element,
    bannerId: "banner:hero-1",
    placementId: "placement:home-hero",
    pageInstanceId: "page:home-1",
    IntersectionObserver: FakeIntersectionObserver,
    clock: () => clock,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => { timer.cancelled = true },
  })

  observer.callback([{ target: element, isIntersecting: true, intersectionRatio: 0.6 }])
  assert.equal(timers[0].milliseconds, 1_000)
  clock = 1_000
  timers[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].source_payload.visible_percent, 60)
  assert.equal(sent[0].source_payload.visible_ms, 1_000)
  observer.callback([{ target: element, isIntersecting: true, intersectionRatio: 0.8 }])
  assert.equal(sent.length, 1)
})

test("scroll milestones remain eligible when consent changes from off to on", async () => {
  const listeners = new Map()
  const browserWindow = {
    innerHeight: 100,
    scrollY: 500,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  }
  const documentImpl = { documentElement: { scrollHeight: 1_000 }, body: { scrollHeight: 1_000 } }
  let consent = false
  let sequence = 0
  const sent = []
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.scroll_depth_reached"],
    hasConsent: () => consent,
    createEventId: () => `browser:consent-scroll-${++sequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      sent.push(event)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  })
  sdk.attachScrollDepthObserver({
    page: { page_type: "catalog", page_instance_id: "page:consent-scroll" },
    window: browserWindow,
    document: documentImpl,
    emitInitial: false,
  })

  listeners.get("scroll")()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sent.length, 0)
  consent = true
  listeners.get("scroll")()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sent.map((event) => event.source_payload.depth_percent), [25, 50])
})

test("banner impression remains eligible for a new dwell period after consent is granted", async () => {
  let observer
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const timers = []
  let clock = 0
  let consent = false
  const sent = []
  const element = {}
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["promotion.banner_impression"],
    hasConsent: () => consent,
    createEventId: () => "browser:consent-banner-1",
    fetch: async (_url, request) => {
      sent.push(JSON.parse(request.body))
      return { status: 202, text: async () => receipt("accepted", "browser:consent-banner-1", { ingestion_id: "ing_consent_banner_1" }) }
    },
  })
  sdk.attachBannerImpressionObserver({
    element,
    bannerId: "banner:consent-hero",
    placementId: "placement:home-hero",
    pageInstanceId: "page:consent-home",
    IntersectionObserver: FakeIntersectionObserver,
    clock: () => clock,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => { timer.cancelled = true },
  })

  observer.callback([{ target: element, isIntersecting: true, intersectionRatio: 0.75 }])
  clock = 1_000
  timers[0].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sent.length, 0)

  consent = true
  observer.callback([{ target: element, isIntersecting: false, intersectionRatio: 0 }])
  observer.callback([{ target: element, isIntersecting: true, intersectionRatio: 0.75 }])
  clock = 2_000
  timers[1].callback()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sent.length, 1)
})

test("consent revocation stops later semantic events without clearing prior receipts", async () => {
  let consent = true
  let sequence = 0
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => consent,
    createEventId: () => `browser:consent-${++sequence}`,
    fetch: async (_url, request) => {
      const event = JSON.parse(request.body)
      return { status: 202, text: async () => receipt("accepted", event.event_id, { ingestion_id: `ing_${event.event_id}` }) }
    },
  })

  await sdk.trackBehavior("behavior.product_viewed", { product_id: "product:1", page_instance_id: "page:product-1" })
  consent = false
  assert.deepEqual(await sdk.trackBehavior("behavior.product_viewed", {
    product_id: "product:1",
    page_instance_id: "page:product-1",
  }), { status: "skipped_no_consent" })
  assert.equal(sdk.getMetrics().accepted, 1)
})
