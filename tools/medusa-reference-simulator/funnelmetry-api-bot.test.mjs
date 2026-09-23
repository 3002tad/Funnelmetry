import assert from "node:assert/strict"
import { createServer } from "node:http"
import test from "node:test"
import { createJourney, parseOptions, runBot } from "./funnelmetry-api-bot.mjs"

test("creates the bounded V2 Medusa behavior journey without cart click", () => {
  const events = createJourney({
    sourceId: "medusa-reference",
    productId: "prod_test",
    sequence: 7,
    runId: "00000000-0000-4000-8000-000000000001",
    startedAt: Date.parse("2026-09-12T00:00:00.000Z"),
  })

  assert.deepEqual(events.map((event) => event.source_event_type), [
    "behavior.product_viewed",
    "checkout.started",
  ])
  assert.equal(new Set(events.map((event) => event.correlation_id)).size, 1)
  assert.ok(events.every((event) => event.producer === "browser_sdk"))
  assert.ok(events.every((event) => event.source_metadata.synthetic === true))
})

test("does not accept the write key as a command-line argument", () => {
  assert.throws(
    () => parseOptions(["--write-key", "unsafe"], {}),
    /Unknown option: --write-key/,
  )
})

test("accepts the private Docker hostname for the Medusa backend", () => {
  const options = parseOptions([], {
    FUNNELMETRY_SOURCE_INGRESS_URL: "https://source-ingress.example.test/v1/ingress/events",
    FUNNELMETRY_SOURCE_ID: "medusa-reference",
    FUNNELMETRY_SOURCE_KEY_ID: "medusa-reference-source",
    FUNNELMETRY_BROWSER_WRITE_KEY: "test-write-key",
    MEDUSA_BACKEND_URL: "http://backend:9000",
    MEDUSA_PUBLISHABLE_KEY: "pk_test",
  })
  assert.equal(options.medusaUrl, "http://backend:9000")
})

test("durably accepts complete journeys through Source Ingress", async (context) => {
  const received = []
  const server = createServer(async (request, response) => {
    if (request.url === "/readyz") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ status: "ready", event_feed_id: "feed_bot_test" }))
      return
    }

    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const event = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    received.push({ event, headers: request.headers })
    response.writeHead(202, { "content-type": "application/json" })
    response.end(JSON.stringify({
      status: "accepted",
      source_id: event.source_id,
      event_id: event.event_id,
      ingress_seq: received.length,
      accepted_at: new Date().toISOString(),
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  const summary = await runBot({
    sourceIngressUrl: `http://127.0.0.1:${address.port}/v1/ingress/events`,
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-source",
    writeKey: "test-write-key",
    productIds: ["prod_1", "prod_2"],
    journeys: 2,
    concurrency: 2,
    stepDelayMs: 0,
    requestTimeoutMs: 2_000,
    maxAttempts: 1,
    verbose: false,
  }, { log: () => {}, errorLog: () => {} })

  assert.equal(summary.journeys_succeeded, 2)
  assert.equal(summary.events_source_accepted, 4)
  assert.equal(received.length, 4)
  assert.ok(received.every(({ headers }) => headers["x-funnelmetry-write-key"] === "test-write-key"))
})

test("creates a real Medusa order in full mode instead of fabricating a business event", async (context) => {
  const requests = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost")
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bodyText = Buffer.concat(chunks).toString("utf8")
    const body = bodyText ? JSON.parse(bodyText) : undefined
    requests.push({ method: request.method, path: url.pathname, body })

    const send = (status, payload) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(payload))
    }
    if (url.pathname === "/readyz") return send(200, { status: "ready", event_feed_id: "feed_bot_test" })
    if (url.pathname === "/store/regions") {
      return send(200, { regions: [{ id: "reg_test", countries: [{ iso_2: "gb" }] }] })
    }
    if (url.pathname === "/store/products") {
      return send(200, { products: [{ id: "prod_test", title: "Test Product", handle: "test-product", variants: [{ id: "variant_test" }] }] })
    }
    if (url.pathname === "/store/payment-providers") {
      return send(200, { payment_providers: [{ id: "pp_system_default" }] })
    }
    if (url.pathname === "/store/carts" && request.method === "POST") {
      return send(200, { cart: { id: "cart_test" } })
    }
    if (url.pathname === "/v1/ingress/events") {
      return send(202, {
        status: "accepted",
        source_id: body.source_id,
        event_id: body.event_id,
        ingress_seq: requests.filter(({ path }) => path === "/v1/ingress/events").length,
        accepted_at: new Date().toISOString(),
      })
    }
    if (url.pathname === "/store/shipping-options") {
      return send(200, { shipping_options: [{ id: "shipping_test" }] })
    }
    if (url.pathname === "/store/payment-collections") {
      return send(200, { payment_collection: { id: "paycol_test" } })
    }
    if (url.pathname === "/store/carts/cart_test/complete") {
      return send(200, { type: "order", order: { id: "order_test", currency_code: "GBP", total: 42.5 } })
    }
    if (request.method === "POST") return send(200, { cart: { id: "cart_test" } })
    return send(404, { error: "not_found" })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const summary = await runBot({
    mode: "full",
    sourceIngressUrl: `${baseUrl}/v1/ingress/events`,
    medusaUrl: baseUrl,
    medusaPublishableKey: "pk_test",
    countryCode: "gb",
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-source",
    writeKey: "test-write-key",
    productIds: ["api-bot-product-1"],
    journeys: 1,
    concurrency: 1,
    stepDelayMs: 0,
    requestTimeoutMs: 2_000,
    maxAttempts: 1,
    verbose: false,
  }, { log: () => {}, errorLog: () => {} })

  assert.equal(summary.events_source_accepted, 2)
  assert.equal(summary.medusa_orders_created, 1)
  assert.deepEqual(summary.medusa_order_evidence, [{
    cart_id: "cart_test",
    order_id: "order_test",
    currency_code: "gbp",
    total_amount: "42.5",
  }])
  assert.equal(summary.expected_native_business_event, "medusa.order_placed")
  assert.ok(requests.some(({ path }) => path === "/store/carts/cart_test/complete"))
  assert.equal(requests.filter(({ path }) => path === "/v1/ingress/events").length, 2)
  assert.equal(requests.some(({ path, body }) =>
    path === "/v1/ingress/events" && body.source_event_type === "medusa.order_placed"), false)
})
