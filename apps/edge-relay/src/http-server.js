import { createServer } from "node:http"
import { authenticateEventFeed, getHeader } from "./auth.js"
import { RelayError } from "./errors.js"

function sendJson(response, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  })
  response.end(payload)
}

function readBoundedBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"])
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      request.resume()
      const error = new Error("request_too_large")
      error.code = "REQUEST_TOO_LARGE"
      reject(error)
      return
    }
    const chunks = []
    let size = 0
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        const error = new Error("request_too_large")
        error.code = "REQUEST_TOO_LARGE"
        reject(error)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => resolve(Buffer.concat(chunks)))
    request.on("error", reject)
  })
}

function corsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.has(origin)) return {}
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-funnelmetry-source-key-id, x-funnelmetry-write-key, x-funnelmetry-timestamp, x-funnelmetry-signature, x-funnelmetry-request-id",
    "access-control-max-age": "600",
    vary: "Origin",
  }
}

function hasAdminAccess(request, adminToken) {
  return Boolean(adminToken) && getHeader(request.headers, "x-funnelmetry-admin-token") === adminToken
}

function boundedQueryInteger(value, name, { minimum, maximum, fallback }) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) throw new RelayError(`${name}_invalid`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new RelayError(`${name}_invalid`)
  return parsed
}

export function createSourceIngressHttpServer({ handleSourceIngress, repository, metrics, browserKeys, maxBodyBytes, adminToken, eventFeedTokens, eventFeedMaxLimit, eventFeedMaxWaitSeconds, now = () => new Date().toISOString() }) {
  const allowedOrigins = new Set(Object.values(browserKeys).flatMap((credential) => credential.allowed_origins ?? []))
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://source-ingress.local")
    const origin = getHeader(request.headers, "origin")
    const cors = corsHeaders(origin, allowedOrigins)

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "alive" })
      return
    }
    if (request.method === "GET" && url.pathname === "/readyz") {
      try {
        repository.isHealthy()
        sendJson(response, 200, { status: "ready", event_feed_id: repository.eventFeedId })
      } catch {
        sendJson(response, 503, { status: "not_ready" })
      }
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      try {
        authenticateEventFeed({ headers: request.headers, eventFeedTokens })
        const afterSeq = boundedQueryInteger(url.searchParams.get("after_seq"), "after_seq", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER, fallback: 0 })
        const limit = boundedQueryInteger(url.searchParams.get("limit"), "limit", { minimum: 1, maximum: eventFeedMaxLimit, fallback: eventFeedMaxLimit })
        const waitSeconds = boundedQueryInteger(url.searchParams.get("wait"), "wait", { minimum: 0, maximum: eventFeedMaxWaitSeconds, fallback: 0 })
        let feed = repository.getFeed({ afterSeq, limit })
        if (feed.events.length === 0 && waitSeconds > 0) {
          await repository.waitForRecordAfter(afterSeq, waitSeconds * 1000)
          feed = repository.getFeed({ afterSeq, limit })
        }
        metrics.increment("funnelmetry_source_event_feed_request_total", { result: feed.events.length > 0 ? "events" : "timeout" })
        sendJson(response, 200, feed)
      } catch (error) {
        if (error instanceof RelayError && error.code === "event_feed_unauthorized") {
          sendJson(response, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" })
          return
        }
        if (error instanceof RelayError && error.code === "retention_gap") {
          const status = repository.getStatus(now())
          sendJson(response, 409, { error: "RETENTION_GAP", event_feed_id: status.event_feed_id, retention_floor_seq: status.retention_floor_seq })
          return
        }
        if (error instanceof RelayError && error.code.endsWith("_invalid")) {
          sendJson(response, 400, { error: "invalid_feed_query", reason_code: error.code })
          return
        }
        sendJson(response, 500, { error: "internal_error" })
      }
      return
    }
    if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/metrics")) {
      if (!hasAdminAccess(request, adminToken)) {
        sendJson(response, 404, { error: "not_found" })
        return
      }
      const status = { event_log: repository.getStatus(now()) }
      if (url.pathname === "/metrics") {
        const body = metrics.render(status)
        response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" })
        response.end(body)
      } else {
        sendJson(response, 200, status)
      }
      return
    }
    if (request.method === "OPTIONS" && url.pathname === "/v1/ingress/events") {
      if (origin && !cors["access-control-allow-origin"]) {
        sendJson(response, 403, { error: "origin_not_allowed" })
        return
      }
      response.writeHead(204, cors)
      response.end()
      return
    }
    if (request.method !== "POST" || url.pathname !== "/v1/ingress/events") {
      sendJson(response, 404, { error: "not_found" })
      return
    }
    if (origin && !cors["access-control-allow-origin"]) {
      request.resume()
      sendJson(response, 403, { error: "origin_not_allowed" })
      return
    }
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      request.resume()
      sendJson(response, 415, { error: "unsupported_media_type" }, cors)
      return
    }
    try {
      const body = await readBoundedBody(request, maxBodyBytes)
      const result = await handleSourceIngress({ headers: request.headers, body, origin })
      sendJson(response, result.httpStatus, result.body, cors)
    } catch (error) {
      if (error?.code === "REQUEST_TOO_LARGE") {
        sendJson(response, 413, { error: "request_too_large", reason_code: "request_too_large" }, cors)
        return
      }
      sendJson(response, 500, { error: "internal_error" })
    }
  })
}
