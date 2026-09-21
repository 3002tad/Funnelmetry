import {
  createIngressEvent,
  INGRESS_EVENT_SPEC_VERSION,
  validateIngressReceipt,
  validateRelayReceipt,
} from "@3002tad/funnelmetry-input-contract"
import {
  isBehaviorEventType,
  BEHAVIOR_SOURCE_SCHEMA_VERSION,
  getBehaviorEventDefinition,
  SCROLL_DEPTH_MILESTONES,
  validateBehaviorPayload,
} from "@3002tad/funnelmetry-behavior-event-catalog"

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
  return value.trim()
}

function defaultStorage() {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function defaultSessionStorage() {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function defaultEventId() {
  if (globalThis.crypto?.randomUUID) return `browser:${globalThis.crypto.randomUUID()}`
  throw new Error("Browser crypto.randomUUID is required to create a stable event_id")
}

function defaultNow() {
  return new Date().toISOString()
}

function defaultPageInstanceId() {
  if (globalThis.crypto?.randomUUID) return `page:${globalThis.crypto.randomUUID()}`
  throw new Error("Browser crypto.randomUUID is required to create a page_instance_id")
}

function requiredPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} is required`)
  return value
}

function requiredFunction(value, name) {
  if (typeof value !== "function") throw new Error(`${name} is required`)
  return value
}

function pageIdentity(page) {
  const value = requiredPlainObject(page, "page")
  return {
    page_type: value.page_type,
    page_instance_id: value.page_instance_id,
  }
}

function browserScrollPercent(browserWindow, documentImpl) {
  const root = documentImpl.documentElement ?? {}
  const body = documentImpl.body ?? {}
  const viewportHeight = Number(browserWindow.innerHeight ?? root.clientHeight ?? 0)
  const scrollTop = Number(browserWindow.scrollY ?? root.scrollTop ?? body.scrollTop ?? 0)
  const contentHeight = Math.max(
    Number(root.scrollHeight ?? 0),
    Number(body.scrollHeight ?? 0),
    viewportHeight,
  )
  if (contentHeight <= viewportHeight) return 100
  return Math.max(0, Math.min(100, ((scrollTop + viewportHeight) / contentHeight) * 100))
}

function parseStoredQueue(storage, storageKey) {
  if (!storage) return []
  try {
    const raw = storage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseStoredOnceKeys(storage, storageKey) {
  if (!storage) return []
  try {
    const raw = storage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((key) => typeof key === "string" && key.length > 0 && key.length <= 256))].slice(-200)
  } catch {
    return []
  }
}

function requiredOnceKey(value) {
  const key = requiredString(value, "onceKey")
  if (key.length > 256) throw new Error("onceKey must be at most 256 characters")
  return key
}

function parseReceipt(responseBody) {
  try {
    return validateIngressReceipt(JSON.parse(responseBody))
  } catch {
    try {
      return validateRelayReceipt(JSON.parse(responseBody))
    } catch {
      return null
    }
  }
}

function enteredDeliveryQueue(result) {
  return result?.status !== "skipped_no_consent" && result?.status !== "dropped_queue_full"
}

/**
 * Browser runtime only handles explicit semantic events supplied by the host binding.
 * It never reads form values, the DOM, URL query/fragment, or raw IP data.
 */
export function createBrowserSdk(options) {
  const sourceId = requiredString(options.sourceId, "sourceId")
  const sourceKeyId = requiredString(options.sourceKeyId, "sourceKeyId")
  const endpoint = requiredString(options.endpoint, "endpoint").replace(/\/$/, "")
  const writeKey = requiredString(options.writeKey, "writeKey")
  const allowedEventTypes = new Set(options.allowedEventTypes ?? [])
  for (const eventType of allowedEventTypes) {
    if (!isBehaviorEventType(eventType) || getBehaviorEventDefinition(eventType).producer !== "browser") {
      throw new Error(`Event '${eventType}' is not browser-producible in Behavior Event Catalog v2`)
    }
  }
  if (allowedEventTypes.size === 0) throw new Error("allowedEventTypes must not be empty")
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("fetch is required")
  const hasConsent = options.hasConsent ?? (() => false)
  const storage = options.storage ?? defaultStorage()
  const storageKey = options.storageKey ?? `funnelmetry.browser.queue.v2.${sourceId}`
  const onceStorage = options.onceStorage ?? defaultSessionStorage()
  const onceStorageKey = options.onceStorageKey ?? `funnelmetry.browser.once.v1.${sourceId}`
  const createEventId = options.createEventId ?? defaultEventId
  const createPageInstanceId = options.createPageInstanceId ?? defaultPageInstanceId
  const now = options.now ?? defaultNow
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const maxAttempts = options.maxAttempts ?? 3
  const maxQueueSize = options.maxQueueSize ?? 200
  const onDrop = options.onDrop ?? (() => {})
  const onRejected = options.onRejected ?? (() => {})
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer")
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) throw new Error("maxQueueSize must be a positive integer")

  // Never upgrade/relabel persisted v1 envelopes, including custom storage keys.
  const queue = parseStoredQueue(storage, storageKey).filter(event => {
    try {
      if (event?.source_id !== sourceId || event.producer !== 'browser_sdk'
        || event.source_schema_version !== BEHAVIOR_SOURCE_SCHEMA_VERSION
        || !allowedEventTypes.has(event.source_event_type)) return false
      validateBehaviorPayload(event.source_event_type, event.source_payload)
      return true
    } catch { return false }
  })
  const onceKeys = new Set(parseStoredOnceKeys(onceStorage, onceStorageKey))
  const pendingOnceKeys = new Set()
  const queuedPageInstances = new Set(queue
    .filter((event) => event?.source_event_type === "behavior.page_viewed")
    .map((event) => event?.source_payload?.page_instance_id)
    .filter((pageInstanceId) => typeof pageInstanceId === "string"))
  const metrics = { accepted: 0, duplicate: 0, relayQueued: 0, rejected: 0, retryableFailure: 0, queueDropped: 0 }
  let flushing = false

  function persistQueue() {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(queue))
    } catch {
      // The event remains in memory; callers can observe delivery on this page only.
    }
  }

  function persistOnceKeys() {
    if (!onceStorage) return
    try {
      onceStorage.setItem(onceStorageKey, JSON.stringify([...onceKeys].slice(-200)))
    } catch {
      // The in-memory guard still prevents duplicate emissions until this tab closes.
    }
  }

  async function deliver(event) {
    const body = JSON.stringify(event)
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          keepalive: true,
          headers: {
            "content-type": "application/json",
            "x-funnelmetry-source-key-id": sourceKeyId,
            "x-funnelmetry-write-key": writeKey,
          },
          body,
        })
        const receipt = parseReceipt(await response.text())
        if (receipt && receipt.source_id === event.source_id && receipt.event_id === event.event_id) {
          if (receipt.status === "accepted" || receipt.status === "duplicate" || receipt.status === "relay_queued" || receipt.status === "rejected") return receipt
        }
        if (response.status >= 400 && response.status < 500) {
          return { status: "rejected", source_id: event.source_id, event_id: event.event_id, received_at: now(), reason_code: "invalid_receipt_or_request" }
        }
      } catch {
        // A retryable network failure must leave the stable event in the local queue.
      }
      if (attempt < maxAttempts) await sleep(100 * attempt)
    }
    return { status: "retryable_failure", source_id: event.source_id, event_id: event.event_id, received_at: now() }
  }

  async function flush() {
    if (flushing) return { status: "already_flushing" }
    flushing = true
    try {
      while (queue.length > 0) {
        const event = queue[0]
        const receipt = await deliver(event)
        if (receipt.status === "accepted" || receipt.status === "duplicate" || receipt.status === "relay_queued") {
          queue.shift()
          if (receipt.status === "relay_queued") metrics.relayQueued += 1
          else metrics[receipt.status] += 1
          persistQueue()
          continue
        }
        if (receipt.status === "rejected") {
          queue.shift()
          metrics.rejected += 1
          persistQueue()
          onRejected({ event, receipt })
          continue
        }
        metrics.retryableFailure += 1
        persistQueue()
        return receipt
      }
      return { status: "drained" }
    } finally {
      flushing = false
    }
  }

  function track(sourceEventType, sourcePayload, context = {}) {
    if (!allowedEventTypes.has(sourceEventType)) throw new Error(`Event '${sourceEventType}' is not allowed by this integration`) 
    const validatedSourcePayload = validateBehaviorPayload(sourceEventType, sourcePayload)
    if (!hasConsent()) return Promise.resolve({ status: "skipped_no_consent" })
    const pageInstanceId = sourceEventType === "behavior.page_viewed"
      ? validatedSourcePayload.page_instance_id
      : null
    if (pageInstanceId && queuedPageInstances.has(pageInstanceId)) {
      return Promise.resolve({ status: "skipped_duplicate_page_view" })
    }
    if (queue.length >= maxQueueSize) {
      const dropped = { sourceEventType, reason: "queue_full" }
      metrics.queueDropped += 1
      onDrop(dropped)
      return Promise.resolve({ status: "dropped_queue_full" })
    }
    const event = createIngressEvent({
      specversion: INGRESS_EVENT_SPEC_VERSION,
      source_id: sourceId,
      event_id: createEventId(),
      source_event_type: sourceEventType,
      source_schema_version: BEHAVIOR_SOURCE_SCHEMA_VERSION,
      occurred_at: context.occurredAt ?? now(),
      producer: "browser_sdk",
      source_payload: validatedSourcePayload,
      anonymous_id: context.anonymousId,
      session_id: context.sessionId,
      correlation_id: context.correlationId,
      source_metadata: context.metadata,
    })
    queue.push(event)
    if (pageInstanceId) queuedPageInstances.add(pageInstanceId)
    persistQueue()
    return flush()
  }

  /**
   * Validates an approved behavior payload before it enters the generic track primitive.
   * Use this for explicit application hooks such as product, search, filter and banner clicks.
   */
  function trackBehavior(sourceEventType, sourcePayload, context = {}) {
    return track(sourceEventType, sourcePayload, context)
  }

  /**
   * Emits a behavior event at most once for a caller-owned key in the current browser tab.
   * A retryable event already retained in the delivery queue counts as emitted, while lack of
   * consent or queue capacity leaves the key eligible for a later explicit host hook.
   */
  async function trackBehaviorOnce(onceKey, sourceEventType, sourcePayload, context = {}) {
    const key = requiredOnceKey(onceKey)
    if (onceKeys.has(key) || pendingOnceKeys.has(key)) return { status: "skipped_duplicate_once" }
    pendingOnceKeys.add(key)
    try {
      const result = await trackBehavior(sourceEventType, sourcePayload, context)
      if (enteredDeliveryQueue(result)) {
        onceKeys.add(key)
        persistOnceKeys()
      }
      return result
    } finally {
      pendingOnceKeys.delete(key)
    }
  }

  function createPageContext(page) {
    const value = requiredPlainObject(page, "page")
    return validateBehaviorPayload("behavior.page_viewed", {
      page_type: value.page_type,
      path_template: value.path_template,
      page_instance_id: value.page_instance_id ?? createPageInstanceId(),
    })
  }

  function trackPageView(page, context = {}) {
    return trackBehavior("behavior.page_viewed", createPageContext(page), context)
  }

  function trackScrollDepth(page, depthPercent, context = {}) {
    const identity = pageIdentity(page)
    return trackBehavior("behavior.scroll_depth_reached", {
      ...identity,
      depth_percent: depthPercent,
    }, context)
  }

  /**
   * Emits each catalog milestone once for an explicit page context. It never infers route
   * templates or identities from the browser URL.
   */
  function attachScrollDepthObserver(options) {
    const browserWindow = options?.window ?? (typeof window === "undefined" ? null : window)
    const documentImpl = options?.document ?? browserWindow?.document
    if (!browserWindow || !documentImpl || typeof browserWindow.addEventListener !== "function") return () => {}
    const page = pageIdentity(options?.page)
    const milestones = options?.milestones ?? SCROLL_DEPTH_MILESTONES
    if (!Array.isArray(milestones) || milestones.length === 0) throw new Error("milestones must not be empty")
    const orderedMilestones = [...new Set(milestones)].sort((left, right) => left - right)
    for (const milestone of orderedMilestones) {
      validateBehaviorPayload("behavior.scroll_depth_reached", { ...page, depth_percent: milestone })
    }
    const reached = new Set()
    const pending = new Set()
    const onScroll = () => {
      const depthPercent = browserScrollPercent(browserWindow, documentImpl)
      for (const milestone of orderedMilestones) {
        if (depthPercent < milestone || reached.has(milestone) || pending.has(milestone)) continue
        pending.add(milestone)
        void trackScrollDepth(page, milestone, options?.context).then((result) => {
          pending.delete(milestone)
          if (enteredDeliveryQueue(result)) reached.add(milestone)
        }, () => {
          pending.delete(milestone)
        })
      }
    }
    browserWindow.addEventListener("scroll", onScroll, { passive: true })
    browserWindow.addEventListener("resize", onScroll)
    if (options?.emitInitial !== false) onScroll()
    return () => {
      browserWindow.removeEventListener("scroll", onScroll)
      browserWindow.removeEventListener("resize", onScroll)
    }
  }

  function trackBannerClick(payload, context = {}) {
    return trackBehavior("promotion.banner_clicked", payload, context)
  }

  /**
   * Emits one impression only after an element is continuously at least 50% visible for 1s.
   * A host must supply stable banner/placement identifiers; this helper never derives them from DOM text.
   */
  function attachBannerImpressionObserver(options) {
    const value = requiredPlainObject(options, "banner observer options")
    const element = value.element
    if (!element || typeof element !== "object") throw new Error("banner observer element is required")
    const browserWindow = value.window ?? (typeof window === "undefined" ? null : window)
    const Observer = value.IntersectionObserver ?? browserWindow?.IntersectionObserver
    if (typeof Observer !== "function") return () => {}
    const dwellMs = value.dwellMs ?? 1_000
    if (!Number.isSafeInteger(dwellMs) || dwellMs < 1_000) throw new Error("dwellMs must be an integer of at least 1000")
    const setTimer = value.setTimeout ?? globalThis.setTimeout
    const clearTimer = value.clearTimeout ?? globalThis.clearTimeout
    const clock = value.clock ?? (() => Date.now())
    requiredFunction(setTimer, "setTimeout")
    requiredFunction(clearTimer, "clearTimeout")
    requiredFunction(clock, "clock")

    const payload = {
      banner_id: value.bannerId,
      placement_id: value.placementId,
      page_instance_id: value.pageInstanceId,
      visible_percent: 50,
      visible_ms: dwellMs,
    }
    if (value.campaignId !== undefined) payload.campaign_id = value.campaignId
    const validated = validateBehaviorPayload("promotion.banner_impression", payload)
    let timer = null
    let visibleSince = null
    let lastVisiblePercent = 50
    let emitted = false
    let deliveryPending = false
    let observer

    const cancelTimer = () => {
      if (timer === null) return
      clearTimer(timer)
      timer = null
    }
    const emitIfStillVisible = () => {
      timer = null
      if (emitted || deliveryPending || visibleSince === null) return
      const visibleMs = Math.floor(clock() - visibleSince)
      if (visibleMs < dwellMs) {
        timer = setTimer(emitIfStillVisible, dwellMs - visibleMs)
        return
      }
      deliveryPending = true
      void trackBehavior("promotion.banner_impression", {
        ...validated,
        visible_percent: lastVisiblePercent,
        visible_ms: visibleMs,
      }, value.context).then((result) => {
        deliveryPending = false
        if (enteredDeliveryQueue(result)) {
          emitted = true
          observer?.unobserve?.(element)
        } else {
          visibleSince = null
        }
      }, () => {
        deliveryPending = false
        visibleSince = null
      })
    }
    observer = new Observer((entries) => {
      if (emitted) return
      const entry = entries.find((candidate) => candidate.target === element)
      if (!entry) return
      const visiblePercent = Math.max(0, Math.min(100, Number(entry.intersectionRatio ?? 0) * 100))
      if (!entry.isIntersecting || visiblePercent < 50) {
        visibleSince = null
        cancelTimer()
        return
      }
      lastVisiblePercent = visiblePercent
      if (visibleSince !== null) return
      visibleSince = clock()
      timer = setTimer(emitIfStillVisible, dwellMs)
    }, { threshold: [0, 0.5, 1] })
    observer.observe(element)
    return () => {
      cancelTimer()
      observer.disconnect?.()
    }
  }

  function attachLifecycle() {
    if (typeof window === "undefined") return () => {}
    const onPageHide = () => { void flush() }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }

  return Object.freeze({
    track,
    trackBehavior,
    trackBehaviorOnce,
    createPageContext,
    trackPageView,
    trackScrollDepth,
    attachScrollDepthObserver,
    trackBannerClick,
    attachBannerImpressionObserver,
    flush,
    attachLifecycle,
    getMetrics: () => ({ ...metrics, queued: queue.length }),
  })
}
