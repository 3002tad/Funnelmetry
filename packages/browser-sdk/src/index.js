import { createIngressEvent, INGRESS_EVENT_SPEC_VERSION, validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

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

function defaultEventId() {
  if (globalThis.crypto?.randomUUID) return `browser:${globalThis.crypto.randomUUID()}`
  throw new Error("Browser crypto.randomUUID is required to create a stable event_id")
}

function defaultNow() {
  return new Date().toISOString()
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

function parseReceipt(responseBody) {
  try {
    return validateIngressReceipt(JSON.parse(responseBody))
  } catch {
    return null
  }
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
  if (allowedEventTypes.size === 0) throw new Error("allowedEventTypes must not be empty")
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("fetch is required")
  const hasConsent = options.hasConsent ?? (() => false)
  const storage = options.storage ?? defaultStorage()
  const storageKey = options.storageKey ?? `funnelmetry.browser.queue.v1.${sourceId}`
  const createEventId = options.createEventId ?? defaultEventId
  const now = options.now ?? defaultNow
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const maxAttempts = options.maxAttempts ?? 3
  const maxQueueSize = options.maxQueueSize ?? 200
  const onDrop = options.onDrop ?? (() => {})
  const onRejected = options.onRejected ?? (() => {})
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer")
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) throw new Error("maxQueueSize must be a positive integer")

  const queue = parseStoredQueue(storage, storageKey)
  const metrics = { accepted: 0, duplicate: 0, rejected: 0, retryableFailure: 0, queueDropped: 0 }
  let flushing = false

  function persistQueue() {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(queue))
    } catch {
      // The event remains in memory; callers can observe delivery on this page only.
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
          if (receipt.status === "accepted" || receipt.status === "duplicate" || receipt.status === "rejected") return receipt
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
        if (receipt.status === "accepted" || receipt.status === "duplicate") {
          queue.shift()
          metrics[receipt.status] += 1
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
    if (!hasConsent()) return Promise.resolve({ status: "skipped_no_consent" })
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
      source_schema_version: "1.0",
      occurred_at: context.occurredAt ?? now(),
      producer: "browser_sdk",
      source_payload: sourcePayload,
      anonymous_id: context.anonymousId,
      session_id: context.sessionId,
      correlation_id: context.correlationId,
      source_metadata: context.metadata,
    })
    queue.push(event)
    persistQueue()
    return flush()
  }

  function attachLifecycle() {
    if (typeof window === "undefined") return () => {}
    const onPageHide = () => { void flush() }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }

  return Object.freeze({
    track,
    flush,
    attachLifecycle,
    getMetrics: () => ({ ...metrics, queued: queue.length }),
  })
}
