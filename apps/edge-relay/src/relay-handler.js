import {
  RELAY_RECEIPT_SPEC_VERSION,
  validateIngressEvent,
  validateRelayReceipt,
} from "@3002tad/funnelmetry-input-contract"
import { authenticateBrowser, isAllowedOrigin } from "./auth.js"
import { RelayError } from "./errors.js"

function response(httpStatus, body) {
  return Object.freeze({ httpStatus, body: Object.freeze(body) })
}

function errorResponse(error) {
  const code = error instanceof RelayError ? error.code : "internal_error"
  if (code === "event_identity_conflict") return response(409, { error: code, reason_code: code })
  if (code === "spool_capacity_exhausted" || code === "spool_disk_low") {
    return response(503, { error: "retryable_failure", reason_code: code })
  }
  if (["source_key_id_missing", "source_key_unknown", "source_key_mismatch", "write_key_invalid"].includes(code)) {
    return response(401, { error: "unauthorized", reason_code: code })
  }
  if (code === "origin_not_allowed") return response(403, { error: code, reason_code: code })
  return response(500, { error: "internal_error" })
}

export function createRelayHandler({ repository, browserKeys, metrics, maxBodyBytes, maxPayloadBytes, now = () => new Date().toISOString() }) {
  return async function handleRelay({ headers = {}, body, origin }) {
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "")
    if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
      metrics.increment("funnelmetry_relay_rejected_total", { reason: "request_too_large" })
      return response(413, { error: "request_too_large", reason_code: "request_too_large" })
    }

    let event
    try {
      event = validateIngressEvent(JSON.parse(rawBody), { maxPayloadBytes, requireOccurredAt: false })
    } catch (error) {
      metrics.increment("funnelmetry_relay_rejected_total", { reason: "contract_invalid" })
      return response(400, { error: "contract_invalid", reason_code: "contract_invalid", detail: error instanceof Error ? error.message : "unknown_error" })
    }

    if (event.producer !== "browser_sdk") {
      metrics.increment("funnelmetry_relay_rejected_total", { reason: "producer_not_supported" })
      return response(400, { error: "producer_not_supported", reason_code: "producer_not_supported" })
    }

    try {
      const auth = authenticateBrowser({ headers, event, browserKeys })
      if (!isAllowedOrigin(origin, auth.credential)) throw new RelayError("origin_not_allowed")
      const stored = repository.enqueue({ event, rawBody, receivedAt: now() })
      metrics.increment(stored.duplicate ? "funnelmetry_relay_duplicate_total" : "funnelmetry_relay_durable_queued_total")
      const receipt = validateRelayReceipt({
        specversion: RELAY_RECEIPT_SPEC_VERSION,
        status: "relay_queued",
        relay_id: stored.record.relay_id,
        source_id: stored.record.source_id,
        event_id: stored.record.event_id,
        relay_received_at: stored.record.relay_received_at,
      })
      return response(202, receipt)
    } catch (error) {
      const result = errorResponse(error)
      if (result.httpStatus >= 400) metrics.increment("funnelmetry_relay_rejected_total", { reason: result.body.reason_code ?? result.body.error })
      return result
    }
  }
}
