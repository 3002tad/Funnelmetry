import {
  validateIngressEvent,
} from "@3002tad/funnelmetry-input-contract"
import { authenticateIngress, isAllowedOrigin } from "./auth.js"
import { RelayError } from "./errors.js"

function response(httpStatus, body) {
  return Object.freeze({ httpStatus, body: Object.freeze(body) })
}

function errorResponse(error) {
  const code = error instanceof RelayError ? error.code : "internal_error"
  if (code === "event_identity_conflict") return response(409, { error: code, reason_code: code })
  if (code === "event_log_capacity_exhausted" || code === "event_log_disk_low") {
    return response(503, { error: "retryable_failure", reason_code: code })
  }
  if (["source_key_id_missing", "source_key_unknown", "source_key_mismatch", "write_key_invalid", "request_id_missing", "timestamp_invalid", "timestamp_outside_window", "signature_invalid"].includes(code)) {
    return response(401, { error: "unauthorized", reason_code: code })
  }
  if (code === "origin_not_allowed") return response(403, { error: code, reason_code: code })
  return response(500, { error: "internal_error" })
}

export function createSourceIngressHandler({ repository, browserKeys, backendKeys, metrics, maxBodyBytes, maxPayloadBytes, maxClockSkewMs, now = () => new Date().toISOString(), nowMs = Date.now }) {
  return async function handleSourceIngress({ headers = {}, body, origin }) {
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "")
    if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
      metrics.increment("funnelmetry_source_ingress_rejected_total", { reason: "request_too_large" })
      return response(413, { error: "request_too_large", reason_code: "request_too_large" })
    }

    let event
    try {
      event = validateIngressEvent(JSON.parse(rawBody), { maxPayloadBytes, requireOccurredAt: false })
    } catch (error) {
      metrics.increment("funnelmetry_source_ingress_rejected_total", { reason: "contract_invalid" })
      return response(400, { error: "contract_invalid", reason_code: "contract_invalid", detail: error instanceof Error ? error.message : "unknown_error" })
    }

    try {
      const auth = authenticateIngress({ event, headers, rawBody, browserKeys, backendKeys, nowMs: nowMs(), maxClockSkewMs })
      if (event.producer === "browser_sdk" && !isAllowedOrigin(origin, auth.credential)) throw new RelayError("origin_not_allowed")
      const stored = repository.accept({
        event,
        rawBody,
        acceptedAt: now(),
        transportMetadata: { producer: event.producer, authentication: auth.authentication },
      })
      metrics.increment(stored.duplicate ? "funnelmetry_source_ingress_duplicate_total" : "funnelmetry_source_ingress_accepted_total", { producer: event.producer })
      const receipt = {
        status: stored.duplicate ? "duplicate" : "accepted",
        source_id: stored.record.source_id,
        event_id: stored.record.event_id,
        ingress_seq: stored.record.ingress_seq,
        accepted_at: stored.record.accepted_at,
        // Retained during migration because current Browser SDK and Backend Kit
        // validate accepted receipts by this field. It identifies a Source record,
        // never a Kafka/Pipeline handoff.
        ingestion_id: `source:${stored.record.event_feed_id}:${stored.record.ingress_seq}`,
        received_at: stored.record.accepted_at,
      }
      return response(stored.duplicate ? 200 : 202, receipt)
    } catch (error) {
      const result = errorResponse(error)
      if (result.httpStatus >= 400) metrics.increment("funnelmetry_source_ingress_rejected_total", { reason: result.body.reason_code ?? result.body.error })
      return result
    }
  }
}
