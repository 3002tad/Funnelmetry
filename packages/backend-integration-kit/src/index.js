import { createHmac, randomUUID } from "node:crypto"
import { INGRESS_EVENT_SPEC_VERSION, validateIngressEvent, validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
  return value.trim()
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
        source_schema_version: mappedEvent.sourceSchemaVersion ?? "1.0",
        occurred_at: mappedEvent.occurredAt,
        produced_at: mappedEvent.producedAt,
        producer: "source_bridge",
        aggregate: mappedEvent.aggregate,
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
