import { createServer } from "node:http"

function sendJson(response, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  })
  response.end(payload)
}

function corsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.includes(origin)) return {}
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": [
      "content-type",
      "x-funnelmetry-source-key-id",
      "x-funnelmetry-write-key",
      "x-funnelmetry-timestamp",
      "x-funnelmetry-signature",
      "x-funnelmetry-request-id",
    ].join(", "),
    "access-control-max-age": "600",
    vary: "Origin",
  }
}

async function readBoundedBody(request, maxBodyBytes) {
  const declaredLength = Number(request.headers["content-length"])
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume()
    const error = new Error("request_too_large")
    error.code = "REQUEST_TOO_LARGE"
    throw error
  }
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) {
      const error = new Error("request_too_large")
      error.code = "REQUEST_TOO_LARGE"
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function createIngressHttpServer({
  handleIngress,
  isReady = () => true,
  corsOrigins = [],
  maxBodyBytes = 128 * 1024,
  onError = (error) => console.error("input-gateway HTTP error", error),
} = {}) {
  if (typeof handleIngress !== "function") throw new Error("An ingress handler is required")

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://input-gateway.local")
    const cors = corsHeaders(request.headers.origin, corsOrigins)

    if (request.method === "GET" && url.pathname === "/health") {
      const ready = isReady() === true
      sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready" })
      return
    }
    if (request.method === "OPTIONS" && url.pathname === "/v1/ingress/events") {
      if (request.headers.origin && !cors["access-control-allow-origin"]) {
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
    if (request.headers.origin && !cors["access-control-allow-origin"]) {
      request.resume()
      sendJson(response, 403, { error: "origin_not_allowed" })
      return
    }
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      request.resume()
      sendJson(response, 415, { error: "unsupported_media_type" }, cors)
      return
    }
    if (!isReady()) {
      request.resume()
      sendJson(response, 503, { error: "gateway_not_ready", reason_code: "gateway_not_ready" }, cors)
      return
    }

    try {
      const body = await readBoundedBody(request, maxBodyBytes)
      const result = await handleIngress({ headers: request.headers, body })
      sendJson(response, result.httpStatus, result.body, cors)
    } catch (error) {
      if (error?.code === "REQUEST_TOO_LARGE") {
        sendJson(response, 413, { error: "request_too_large", reason_code: "request_too_large" }, cors)
        return
      }
      onError(error)
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" }, cors)
      else response.destroy()
    }
  })
}
