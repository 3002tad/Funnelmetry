import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

const DEFAULTS = Object.freeze({
  mode: "full",
  journeys: 10,
  concurrency: 2,
  stepDelayMs: 50,
  requestTimeoutMs: 5_000,
  maxAttempts: 3,
})

function positiveInteger(value, name, { allowZero = false } = {}) {
  const parsed = Number(value)
  const minimum = allowZero ? 0 : 1
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`)
  }
  return parsed
}

function splitProductIds(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseOptions(argv, env = process.env) {
  const values = new Map()
  const valueOptions = new Set([
    "mode",
    "journeys",
    "concurrency",
    "step-delay-ms",
    "request-timeout-ms",
    "max-attempts",
    "product-ids",
    "source-ingress-url",
    "medusa-url",
    "source-id",
    "source-key-id",
    "country-code",
  ])
  let help = false
  let verbose = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    if (argument === "--verbose") {
      verbose = true
      continue
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`)
    const name = argument.slice(2)
    if (!valueOptions.has(name)) throw new Error(`Unknown option: --${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`)
    values.set(name, value)
    index += 1
  }

  const sourceIngressUrl = values.get("source-ingress-url") ?? env.FUNNELMETRY_SOURCE_INGRESS_URL
  const sourceId = values.get("source-id") ?? env.FUNNELMETRY_SOURCE_ID
  const sourceKeyId = values.get("source-key-id") ?? env.FUNNELMETRY_SOURCE_KEY_ID
  const writeKey = env.FUNNELMETRY_BROWSER_WRITE_KEY
  const productIds = splitProductIds(values.get("product-ids") ?? env.FUNNELMETRY_PRODUCT_IDS)
  const mode = values.get("mode") ?? env.FUNNELMETRY_BOT_MODE ?? DEFAULTS.mode
  const medusaUrl = values.get("medusa-url") ?? env.MEDUSA_BACKEND_URL
  const medusaPublishableKey = env.MEDUSA_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
  const countryCode = (values.get("country-code") ?? env.MEDUSA_COUNTRY_CODE ?? "gb").toLowerCase()

  if (!["full", "behavior"].includes(mode)) throw new Error("mode must be full or behavior")

  if (!help) {
    if (!sourceIngressUrl) throw new Error("FUNNELMETRY_SOURCE_INGRESS_URL is required")
    if (!sourceId) throw new Error("FUNNELMETRY_SOURCE_ID is required")
    if (!sourceKeyId) throw new Error("FUNNELMETRY_SOURCE_KEY_ID is required")
    if (!writeKey) throw new Error("FUNNELMETRY_BROWSER_WRITE_KEY is required")
    if (mode === "full" && !medusaUrl) throw new Error("MEDUSA_BACKEND_URL is required in full mode")
    if (mode === "full" && !medusaPublishableKey) {
      throw new Error("MEDUSA_PUBLISHABLE_KEY is required in full mode")
    }
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(sourceId)) {
      throw new Error("FUNNELMETRY_SOURCE_ID must be lowercase kebab-case")
    }
  }

  return {
    help,
    mode,
    verbose,
    sourceIngressUrl: sourceIngressUrl ? normalizeSourceIngressUrl(sourceIngressUrl) : undefined,
    sourceId,
    sourceKeyId,
    writeKey,
    medusaUrl: medusaUrl ? normalizeBaseUrl(medusaUrl, "Medusa backend URL") : undefined,
    medusaPublishableKey,
    countryCode,
    productIds: productIds.length > 0 ? productIds : ["api-bot-product-1"],
    journeys: positiveInteger(values.get("journeys") ?? env.FUNNELMETRY_BOT_JOURNEYS ?? DEFAULTS.journeys, "journeys"),
    concurrency: positiveInteger(values.get("concurrency") ?? env.FUNNELMETRY_BOT_CONCURRENCY ?? DEFAULTS.concurrency, "concurrency"),
    stepDelayMs: positiveInteger(values.get("step-delay-ms") ?? env.FUNNELMETRY_BOT_STEP_DELAY_MS ?? DEFAULTS.stepDelayMs, "step-delay-ms", { allowZero: true }),
    requestTimeoutMs: positiveInteger(values.get("request-timeout-ms") ?? env.FUNNELMETRY_BOT_REQUEST_TIMEOUT_MS ?? DEFAULTS.requestTimeoutMs, "request-timeout-ms"),
    maxAttempts: positiveInteger(values.get("max-attempts") ?? env.FUNNELMETRY_BOT_MAX_ATTEMPTS ?? DEFAULTS.maxAttempts, "max-attempts"),
  }
}

function normalizeBaseUrl(value, label) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`)
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function normalizeSourceIngressUrl(value) {
  const url = new URL(value)
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Source Ingress URL must use HTTPS unless it targets localhost")
  }
  url.pathname = "/v1/ingress/events"
  url.search = ""
  url.hash = ""
  return url.toString()
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createJourney({ sourceId, productId, variantId, cartId, sequence, runId = randomUUID(), startedAt = Date.now() }) {
  const anonymousId = `api-bot-anonymous-${runId}`
  const sessionId = `api-bot-session-${runId}`
  const correlationId = `api-bot-journey-${runId}`
  const effectiveCartId = cartId ?? `api-bot-cart-${runId}`

  const event = (suffix, sourceEventType, offsetMs, sourcePayload) => {
    const occurredAt = new Date(startedAt + offsetMs).toISOString()
    return {
      specversion: "ingress-event.v1",
      source_id: sourceId,
      event_id: `api-bot:${runId}:${suffix}`,
      source_event_type: sourceEventType,
      source_schema_version: "1.0",
      occurred_at: occurredAt,
      produced_at: occurredAt,
      producer: "browser_sdk",
      anonymous_id: anonymousId,
      session_id: sessionId,
      correlation_id: correlationId,
      source_payload: sourcePayload,
      source_metadata: {
        generator: "funnelmetry-api-bot",
        synthetic: true,
        journey_sequence: sequence,
      },
    }
  }

  return [
    event("product-viewed", "behavior.product_viewed", 0, { product_id: productId }),
    event("checkout-started", "checkout.started", 1, { cart_id: effectiveCartId, step: "address" }),
  ]
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

async function postEvent(event, options, fetchImpl) {
  const startedAt = performance.now()
  let lastError

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(options.sourceIngressUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-funnelmetry-source-key-id": options.sourceKeyId,
          "x-funnelmetry-write-key": options.writeKey,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      })
      const receipt = await parseResponse(response)
      if ((response.status === 202 || response.status === 200) && (receipt.status === "accepted" || receipt.status === "duplicate")) {
        if (receipt.source_id !== event.source_id || receipt.event_id !== event.event_id) {
          throw new Error("Source acceptance receipt identity does not match the submitted event")
        }
        if (!Number.isSafeInteger(receipt.ingress_seq) || receipt.ingress_seq <= 0) throw new Error("Source acceptance receipt lacks ingress_seq")
        return { receipt, latencyMs: performance.now() - startedAt, attempts: attempt }
      }

      const error = new Error(`Source Ingress returned ${response.status}: ${JSON.stringify(receipt)}`)
      if (response.status < 500 && response.status !== 429) throw error
      lastError = error
    } catch (error) {
      lastError = error
      if (error.message?.startsWith("Source Ingress returned 4") && !error.message.startsWith("Source Ingress returned 429")) {
        throw error
      }
    }

    if (attempt < options.maxAttempts) await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000))
  }

  throw lastError ?? new Error("Source Ingress request failed")
}

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1)]
}

async function sourceIngressReadiness(sourceIngressUrl, fetchImpl, timeoutMs) {
  const url = new URL(sourceIngressUrl)
  url.pathname = "/readyz"
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  const body = await parseResponse(response)
  if (!response.ok) throw new Error(`Source Ingress readiness failed (${response.status}): ${JSON.stringify(body)}`)
  return body
}

async function medusaRequest(options, fetchImpl, path, { method = "GET", body } = {}) {
  const response = await fetchImpl(`${options.medusaUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": options.medusaPublishableKey,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  })
  const result = await parseResponse(response)
  if (!response.ok) {
    throw new Error(`Medusa ${method} ${path} returned ${response.status}: ${JSON.stringify(result)}`)
  }
  return result
}

async function loadCommerceFixture(options, fetchImpl) {
  const regionQuery = new URLSearchParams({ limit: "100", fields: "id,name,currency_code,*countries" })
  const { regions = [] } = await medusaRequest(options, fetchImpl, `/store/regions?${regionQuery}`)
  const region = regions.find((candidate) =>
    candidate.countries?.some((country) => country.iso_2?.toLowerCase() === options.countryCode),
  )
  if (!region) throw new Error(`No Medusa region contains country '${options.countryCode}'`)

  const productQuery = new URLSearchParams({
    limit: "100",
    region_id: region.id,
    fields: "id,title,handle,*variants",
  })
  const { products = [] } = await medusaRequest(options, fetchImpl, `/store/products?${productQuery}`)
  const selectedProducts = options.productIds[0] === "api-bot-product-1"
    ? products
    : products.filter((product) => options.productIds.includes(product.id) || options.productIds.includes(product.handle))
  const variants = selectedProducts.flatMap((product) =>
    (product.variants ?? []).map((variant) => ({
      productId: product.id,
      productTitle: product.title,
      variantId: variant.id,
    })),
  )
  if (variants.length === 0) {
    throw new Error("No Medusa product variant matched FUNNELMETRY_PRODUCT_IDS")
  }

  const providerQuery = new URLSearchParams({ region_id: region.id })
  const { payment_providers: paymentProviders = [] } = await medusaRequest(
    options,
    fetchImpl,
    `/store/payment-providers?${providerQuery}`,
  )
  const paymentProvider = paymentProviders.find((provider) => provider.id === "pp_system_default")
    ?? paymentProviders[0]
  if (!paymentProvider) throw new Error(`Region '${region.id}' has no payment provider`)

  return { region, variants, paymentProvider }
}

async function createCart(options, fetchImpl, regionId) {
  const result = await medusaRequest(options, fetchImpl, "/store/carts", {
    method: "POST",
    body: { region_id: regionId },
  })
  if (!result.cart?.id) throw new Error("Medusa create cart response has no cart ID")
  return result.cart
}

async function addCartItem(options, fetchImpl, cartId, variantId) {
  await medusaRequest(options, fetchImpl, `/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity: 1 },
  })
}

async function completeCheckout(options, fetchImpl, { cartId, region, paymentProvider, runId }) {
  const country = region.countries?.find(
    (candidate) => candidate.iso_2?.toLowerCase() === options.countryCode,
  )
  const countryCode = country?.iso_2?.toLowerCase() ?? options.countryCode
  const address = {
    first_name: "Funnelmetry",
    last_name: "API Bot",
    address_1: "1 Integration Test Street",
    city: countryCode === "gb" ? "London" : "Test City",
    country_code: countryCode,
    postal_code: countryCode === "gb" ? "SW1A 1AA" : "10000",
  }
  await medusaRequest(options, fetchImpl, `/store/carts/${cartId}`, {
    method: "POST",
    body: {
      email: `funnelmetry-bot+${runId}@example.test`,
      shipping_address: address,
      billing_address: address,
    },
  })

  const shippingQuery = new URLSearchParams({ cart_id: cartId })
  const { shipping_options: shippingOptions = [] } = await medusaRequest(
    options,
    fetchImpl,
    `/store/shipping-options?${shippingQuery}`,
  )
  const shippingOption = shippingOptions[0]
  if (!shippingOption) throw new Error(`Cart '${cartId}' has no shipping option`)
  await medusaRequest(options, fetchImpl, `/store/carts/${cartId}/shipping-methods`, {
    method: "POST",
    body: { option_id: shippingOption.id },
  })

  const { payment_collection: paymentCollection } = await medusaRequest(
    options,
    fetchImpl,
    "/store/payment-collections",
    { method: "POST", body: { cart_id: cartId } },
  )
  if (!paymentCollection?.id) throw new Error("Medusa create payment collection response has no ID")
  await medusaRequest(options, fetchImpl, `/store/payment-collections/${paymentCollection.id}/payment-sessions`, {
    method: "POST",
    body: { provider_id: paymentProvider.id, data: {} },
  })

  const result = await medusaRequest(options, fetchImpl, `/store/carts/${cartId}/complete`, { method: "POST" })
  if (result.type !== "order" || !result.order?.id) {
    throw new Error(`Medusa did not complete cart '${cartId}': ${JSON.stringify(result.error ?? result)}`)
  }
  return result.order
}

export async function runBot(options, { fetchImpl = fetch, log = console.log, errorLog = console.error } = {}) {
  const readiness = await sourceIngressReadiness(options.sourceIngressUrl, fetchImpl, options.requestTimeoutMs)
  log(`[funnelmetry-api-bot] source ingress ready; event_feed_id=${readiness.event_feed_id ?? "unknown"}`)
  const fullMode = options.mode === "full"
  const commerce = fullMode ? await loadCommerceFixture(options, fetchImpl) : undefined
  if (commerce) {
    log(`[funnelmetry-api-bot] Medusa fixture ready; variants=${commerce.variants.length}; provider=${commerce.paymentProvider.id}`)
  }

  const startedAt = Date.now()
  const latencies = []
  const failures = []
  let eventCount = 0
  let orderCount = 0
  const medusaOrders = []
  let retryCount = 0
  let nextJourney = 0

  async function worker() {
    while (true) {
      const sequence = nextJourney
      nextJourney += 1
      if (sequence >= options.journeys) return

      try {
        const runId = randomUUID()
        const variant = commerce?.variants[sequence % commerce.variants.length]
        const productId = variant?.productId ?? options.productIds[sequence % options.productIds.length]
        const cart = commerce ? await createCart(options, fetchImpl, commerce.region.id) : undefined
        const journey = createJourney({
          sourceId: options.sourceId,
          productId,
          variantId: variant?.variantId,
          cartId: cart?.id,
          sequence,
          runId,
        })

        for (let step = 0; step < journey.length; step += 1) {
          const event = journey[step]
          const result = await postEvent(event, options, fetchImpl)
          eventCount += 1
          retryCount += result.attempts - 1
          latencies.push(result.latencyMs)
          if (options.verbose) log(`[funnelmetry-api-bot] ${event.event_id} -> ${result.receipt.status}`)
          if (commerce && step === 0) await addCartItem(options, fetchImpl, cart.id, variant.variantId)
          if (options.stepDelayMs > 0) await sleep(options.stepDelayMs)
        }

        if (commerce) {
          const order = await completeCheckout(options, fetchImpl, {
            cartId: cart.id,
            region: commerce.region,
            paymentProvider: commerce.paymentProvider,
            runId,
          })
          orderCount += 1
          medusaOrders.push({
            cart_id: cart.id,
            order_id: order.id,
            currency_code: typeof order.currency_code === "string" ? order.currency_code.toLowerCase() : null,
            total_amount: order.total === undefined || order.total === null ? null : String(order.total),
          })
          if (options.verbose) log(`[funnelmetry-api-bot] cart ${cart.id} -> order ${order.id}`)
        }
      } catch (error) {
        failures.push({ sequence, message: error instanceof Error ? error.message : String(error) })
        errorLog(`[funnelmetry-api-bot] journey ${sequence} failed: ${failures.at(-1).message}`)
      }
    }
  }

  const workerCount = Math.min(options.concurrency, options.journeys)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const durationMs = Date.now() - startedAt
  const summary = {
    mode: fullMode ? "medusa_api_plus_source_ingress_behavior" : "source_ingress_behavior_input",
    source_id: options.sourceId,
    source_ingress_url: options.sourceIngressUrl,
    event_feed_id_at_start: readiness.event_feed_id ?? "unknown",
    journeys_requested: options.journeys,
    journeys_succeeded: options.journeys - failures.length,
    journeys_failed: failures.length,
    events_source_accepted: eventCount,
    medusa_orders_created: orderCount,
    medusa_order_evidence: medusaOrders,
    expected_native_business_event: fullMode ? "medusa.order_placed" : null,
    business_delivery_verification: fullMode ? "source_acceptance_only_pipeline_pull_evidence_pending" : "not_applicable",
    request_retries: retryCount,
    duration_ms: durationMs,
    throughput_events_per_second: durationMs === 0 ? eventCount : Number((eventCount / (durationMs / 1_000)).toFixed(2)),
    latency_ms: {
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      max: Number((latencies.length > 0 ? Math.max(...latencies) : 0).toFixed(2)),
    },
    failures,
  }
  log(JSON.stringify(summary, null, 2))
  return summary
}

function usage() {
  return `Usage: pnpm funnelmetry:api-bot -- [options]

Required environment variables:
  FUNNELMETRY_SOURCE_INGRESS_URL
  FUNNELMETRY_SOURCE_ID
  FUNNELMETRY_SOURCE_KEY_ID
  FUNNELMETRY_BROWSER_WRITE_KEY
  MEDUSA_BACKEND_URL            Required in full mode
  MEDUSA_PUBLISHABLE_KEY        Required in full mode

Options:
  --mode <full|behavior>        Default: ${DEFAULTS.mode}
  --journeys <number>           Default: ${DEFAULTS.journeys}
  --concurrency <number>        Default: ${DEFAULTS.concurrency}
  --step-delay-ms <number>      Default: ${DEFAULTS.stepDelayMs}
  --request-timeout-ms <number> Default: ${DEFAULTS.requestTimeoutMs}
  --max-attempts <number>       Default: ${DEFAULTS.maxAttempts}
  --product-ids <id,id,...>     Default: api-bot-product-1
  --medusa-url <url>            Overrides MEDUSA_BACKEND_URL
  --country-code <code>         Default: gb
  --source-ingress-url <url>    Overrides FUNNELMETRY_SOURCE_INGRESS_URL
  --source-id <id>              Overrides FUNNELMETRY_SOURCE_ID
  --source-key-id <id>          Overrides FUNNELMETRY_SOURCE_KEY_ID
  --verbose
  --help
`
}

async function main() {
  try {
    const options = parseOptions(process.argv.slice(2))
    if (options.help) {
      console.log(usage())
      return
    }
    const summary = await runBot(options)
    if (summary.journeys_failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`[funnelmetry-api-bot] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
