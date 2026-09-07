import { randomUUID } from "node:crypto"
import { validateIngressEvent, validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"
import { authenticateIngress, getIngressHeader, IngressAuthError } from "./auth.js"

function jsonResponse(httpStatus, body) {
  return Object.freeze({ httpStatus, body: Object.freeze(body) })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "unknown_error"
}

function ensureDurableIngress(durableIngress) {
  if (!durableIngress || typeof durableIngress.accept !== "function") {
    throw new Error("A durable ingress adapter is required")
  }
  return durableIngress
}

export function createIngressHandler({
  durableIngress,
  browserKeys = {},
  backendKeys = {},
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  createAttemptId = randomUUID,
  maxBodyBytes = 128 * 1024,
  maxPayloadBytes = 64 * 1024,
  maxClockSkewMs = 5 * 60 * 1000,
} = {}) {
  const rawIngress = ensureDurableIngress(durableIngress)

  return async function handleIngress({ headers = {}, body }) {
    const rawBody = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "")
    if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
      return jsonResponse(413, { error: "request_too_large", reason_code: "request_too_large" })
    }

    let parsed
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return jsonResponse(400, { error: "invalid_json", reason_code: "invalid_json" })
    }

    let event
    try {
      event = validateIngressEvent(parsed, { maxPayloadBytes, requireOccurredAt: false })
    } catch (error) {
      return jsonResponse(400, {
        error: "contract_invalid",
        reason_code: "contract_invalid",
        detail: errorMessage(error),
      })
    }

    let auth
    try {
      auth = authenticateIngress({
        event,
        headers,
        rawBody,
        browserKeys,
        backendKeys,
        nowMs: nowMs(),
        maxClockSkewMs,
      })
    } catch (error) {
      const reasonCode = error instanceof IngressAuthError ? error.reasonCode : "auth_failed"
      return jsonResponse(401, { error: "unauthorized", reason_code: reasonCode })
    }

    const receivedAt = now()
    const ingestionAttemptId = getIngressHeader(headers, "x-funnelmetry-request-id") || createAttemptId()
    try {
      const receipt = validateIngressReceipt(await rawIngress.accept(event, {
        raw_body: rawBody,
        received_at: receivedAt,
        ingestion_attempt_id: ingestionAttemptId,
        auth,
      }))
      if (receipt.source_id !== event.source_id || receipt.event_id !== event.event_id) {
        throw new Error("durable ingress returned a receipt for another event")
      }
      const httpStatus = {
        accepted: 202,
        duplicate: 200,
        rejected: 400,
        retryable_failure: 503,
      }[receipt.status]
      return jsonResponse(httpStatus, receipt)
    } catch (error) {
      return jsonResponse(503, validateIngressReceipt({
        status: "retryable_failure",
        source_id: event.source_id,
        event_id: event.event_id,
        ingestion_attempt_id: ingestionAttemptId,
        received_at: receivedAt,
        reason_code: "durable_handoff_failed",
      }))
    }
  }
}
