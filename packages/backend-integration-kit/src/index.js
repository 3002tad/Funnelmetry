import { createHmac, randomUUID } from "node:crypto"
import { INGRESS_EVENT_SPEC_VERSION, validateIngressEvent, validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
  return value.trim()
}

export function normalizeCurrencyCode(value) {
  if (typeof value !== "string") return null
  const currencyCode = value.trim().toLowerCase()
  return /^[a-z]{3}$/.test(currencyCode) ? currencyCode : null
}

/**
 * Medusa v2 exposes prices in major currency units and server-side computed totals
 * may be BigNumber-like objects with a `numeric` property. Keep the outbound value
 * as a decimal string so the source boundary never relabels it as a minor-unit integer.
 */
export function normalizeMajorAmount(value) {
  const candidate = value && typeof value === "object" && "numeric" in value
    ? value.numeric
    : value
  const amount = typeof candidate === "number" && Number.isFinite(candidate)
    ? String(candidate)
    : typeof candidate === "string" ? candidate.trim() : ""
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) ? amount : null
}

function parseReceipt(body) {
  try {
    return validateIngressReceipt(JSON.parse(body))
  } catch {
    return null
  }
}

function createRetryableResult(event, attempts, reasonCode) {
  return {
    status: "retryable_failure",
    source_id: event.source_id,
    event_id: event.event_id,
    attempts,
    reason_code: reasonCode,
  }
}

/**
 * A host-neutral, fail-open forwarder. The host binding owns lifecycle semantics;
 * this kit only preserves a mapped source event through signed HTTP delivery.
 */
export function createBackendForwarder(options) {
  const sourceId = requiredString(options.sourceId, "sourceId")
  const sourceKeyId = requiredString(options.sourceKeyId, "sourceKeyId")
  const endpoint = requiredString(options.endpoint, "endpoint").replace(/\/$/, "")
  const signingKey = requiredString(options.signingKey, "signingKey")
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("fetch is required")
  const maxAttempts = options.maxAttempts ?? 3
  const timeoutMs = options.timeoutMs ?? 800
  const now = options.now ?? (() => new Date().toISOString())
  const requestId = options.requestId ?? randomUUID
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const logger = options.logger ?? { warn: () => {} }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer")
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be a positive integer")
  const metrics = { accepted: 0, duplicate: 0, rejected: 0, retryableFailure: 0 }

  async function forward(mappedEvent) {
    let event
    try {
      event = validateIngressEvent({
        specversion: INGRESS_EVENT_SPEC_VERSION,
        source_id: sourceId,
        event_id: mappedEvent.eventId,
        source_event_type: mappedEvent.sourceEventType,
        // Catalog v2 search is server-produced; commerce source schemas stay independent.
        source_schema_version: mappedEvent.sourceSchemaVersion ?? (mappedEvent.sourceEventType === 'behavior.search_submitted' ? '2.0' : '1.0'),
        occurred_at: mappedEvent.occurredAt,
        produced_at: mappedEvent.producedAt,
        producer: "source_bridge",
        aggregate: mappedEvent.aggregate,
        anonymous_id: mappedEvent.anonymousId,
        session_id: mappedEvent.sessionId,
        correlation_id: mappedEvent.correlationId,
        source_payload: mappedEvent.sourcePayload,
        source_metadata: mappedEvent.sourceMetadata,
      })
    } catch (error) {
      const result = { status: "rejected", reason_code: "local_contract_invalid", error: error instanceof Error ? error.message : "unknown" }
      metrics.rejected += 1
      logger.warn({ message: "Funnelmetry forwarder rejected a local event", result })
      return result
    }

    const body = JSON.stringify(event)
    const timestamp = now()
    const signature = createHmac("sha256", signingKey).update(`${timestamp}.${body}`).digest("hex")
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-funnelmetry-source-key-id": sourceKeyId,
            "x-funnelmetry-timestamp": timestamp,
            "x-funnelmetry-signature": signature,
            "x-funnelmetry-request-id": requestId(),
          },
          body,
          signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        })
        const receipt = parseReceipt(await response.text())
        if (receipt && receipt.source_id === event.source_id && receipt.event_id === event.event_id) {
          if (receipt.status === "accepted" || receipt.status === "duplicate" || receipt.status === "rejected") {
            metrics[receipt.status] += 1
            return receipt
          }
        }
        if (response.status >= 400 && response.status < 500) {
          const rejected = { status: "rejected", source_id: event.source_id, event_id: event.event_id, reason_code: "invalid_receipt_or_request" }
          metrics.rejected += 1
          logger.warn({ message: "Funnelmetry forwarder received a non-retryable response", rejected })
          return rejected
        }
      } catch {
        // Fail-open is intentional: the host business operation must not be retried or failed by analytics.
      }
      if (attempt < maxAttempts) await sleep(100 * attempt)
    }
    const failure = createRetryableResult(event, maxAttempts, "delivery_exhausted")
    metrics.retryableFailure += 1
    logger.warn({ message: "Funnelmetry forwarder exhausted retries; host operation remains successful", failure })
    return failure
  }

  return Object.freeze({ forward, getMetrics: () => ({ ...metrics }) })
}

/**
 * Host bindings enqueue source-confirmed events after their business response is known.
 * Delivery occurs out of band; a full queue, invalid local event, or unavailable
 * Funnelmetry dependency must never alter the host request result.
 */
export function createManagedDeliveryDispatcher(options) {
  const maxQueueSize = options.maxQueueSize ?? 200
  const failureThreshold = options.failureThreshold ?? 3
  const cooldownMs = options.cooldownMs ?? 30_000
  const logger = options.logger ?? { warn: () => {} }
  const clock = options.clock ?? Date.now
  const setTimer = options.setTimeout ?? setTimeout
  const forwarder = options.forwarder ?? createBackendForwarder(options)
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) throw new Error("maxQueueSize must be a positive integer")
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error("failureThreshold must be a positive integer")
  if (!Number.isInteger(cooldownMs) || cooldownMs < 1) throw new Error("cooldownMs must be a positive integer")

  const queue = []
  const metrics = {
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
  let wakeTimer
  let circuitOpenUntil = 0
  let consecutiveRetryableFailures = 0
  let lastQueueFullLogAt = 0

  function scheduleDrain(delayMs = 0) {
    if (draining || wakeTimer) return
    wakeTimer = setTimer(() => {
      wakeTimer = undefined
      void drain()
    }, delayMs)
  }

  function openCircuit() {
    circuitOpenUntil = clock() + cooldownMs
    consecutiveRetryableFailures = 0
    metrics.circuitOpened += 1
    logger.warn({
      message: "Funnelmetry delivery circuit opened; host business flow remains unaffected",
      cooldown_ms: cooldownMs,
      queued_events: queue.length,
    })
  }

  async function drain() {
    if (draining) return
    const remainingCooldown = circuitOpenUntil - clock()
    if (remainingCooldown > 0) {
      scheduleDrain(remainingCooldown)
      return
    }
    draining = true
    try {
      while (queue.length > 0) {
        const remainingCooldownDuringDrain = circuitOpenUntil - clock()
        if (remainingCooldownDuringDrain > 0) {
          scheduleDrain(remainingCooldownDuringDrain)
          break
        }
        const event = queue.shift()
        if (!event) continue
        let result
        try {
          result = await forwarder.forward(event)
        } catch {
          result = { status: "retryable_failure" }
        }
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
          if (consecutiveRetryableFailures >= failureThreshold) {
            openCircuit()
            break
          }
        }
      }
    } finally {
      draining = false
      if (queue.length > 0) scheduleDrain(Math.max(0, circuitOpenUntil - clock()))
    }
  }

  function enqueue(event) {
    if (queue.length >= maxQueueSize) {
      metrics.droppedQueueFull += 1
      if (clock() - lastQueueFullLogAt >= 60_000) {
        lastQueueFullLogAt = clock()
        logger.warn({
          message: "Funnelmetry delivery queue is full; event dropped without affecting the host",
          max_queue_size: maxQueueSize,
        })
      }
      return { status: "dropped_queue_full" }
    }
    queue.push(event)
    metrics.enqueued += 1
    scheduleDrain(Math.max(0, circuitOpenUntil - clock()))
    return { status: "queued" }
  }

  return Object.freeze({
    enqueue,
    getMetrics: () => ({ ...metrics, queued: queue.length, circuitOpen: circuitOpenUntil > clock() }),
  })
}
