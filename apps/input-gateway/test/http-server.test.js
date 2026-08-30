import test from "node:test"
import assert from "node:assert/strict"
import { createIngressHttpServer } from "../src/http-server.js"

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test("reports readiness and rejects ingestion while Kafka replay is incomplete", async (t) => {
  const server = createIngressHttpServer({ handleIngress: async () => assert.fail(), isReady: () => false })
  const baseUrl = await listen(server)
  t.after(() => close(server))

  const health = await fetch(`${baseUrl}/health`)
  assert.equal(health.status, 503)
  assert.deepEqual(await health.json(), { status: "not_ready" })

  const ingress = await fetch(`${baseUrl}/v1/ingress/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
  assert.equal(ingress.status, 503)
})

test("passes the exact JSON bytes and headers to the ingress handler", async (t) => {
  const rawBody = '{"source_id":"shop","event_id":"evt-1"}'
  let observed
  const server = createIngressHttpServer({
    handleIngress: async (request) => {
      observed = request
      return { httpStatus: 202, body: { status: "accepted" } }
    },
  })
  const baseUrl = await listen(server)
  t.after(() => close(server))

  const response = await fetch(`${baseUrl}/v1/ingress/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-funnelmetry-request-id": "attempt-1" },
    body: rawBody,
  })

  assert.equal(response.status, 202)
  assert.equal(observed.body.toString("utf8"), rawBody)
  assert.equal(observed.headers["x-funnelmetry-request-id"], "attempt-1")
})

test("enforces JSON content type, request size and CORS allowlist", async (t) => {
  const server = createIngressHttpServer({
    handleIngress: async () => ({ httpStatus: 202, body: {} }),
    corsOrigins: ["https://shop.example"],
    maxBodyBytes: 4,
  })
  const baseUrl = await listen(server)
  t.after(() => close(server))

  const mediaType = await fetch(`${baseUrl}/v1/ingress/events`, { method: "POST", body: "{}" })
  assert.equal(mediaType.status, 415)

  const denied = await fetch(`${baseUrl}/v1/ingress/events`, {
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
  })
  assert.equal(denied.status, 403)

  const allowed = await fetch(`${baseUrl}/v1/ingress/events`, {
    method: "OPTIONS",
    headers: { origin: "https://shop.example" },
  })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://shop.example")

  const oversized = await fetch(`${baseUrl}/v1/ingress/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "12345",
  })
  assert.equal(oversized.status, 413)
})
