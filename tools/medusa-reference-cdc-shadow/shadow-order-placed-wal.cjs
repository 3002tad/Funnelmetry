"use strict"

// Disposable, shadow-only native-event probe. This file is bind-mounted into
// the compiled Medusa backend; it is not the production installer binding.
const { ContainerRegistrationKeys } = require("@medusajs/framework/utils")

const prefix = "funnelmetry.shadow-order-placed.v1"
let injectedFailureConsumed = false

async function shadowOrderPlacedWal({ event, container }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const orderId = event?.data?.id
    if (typeof orderId !== "string" || !orderId.startsWith("order_")) {
      throw new Error("native order.placed is missing a valid order ID")
    }

    const { normalizeCurrencyCode, normalizeMajorAmount } = await import(
      "@3002tad/funnelmetry-backend-integration-kit"
    )
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "created_at", "currency_code", "total", "cart.id"],
      filters: { id: orderId },
    })
    const order = data?.[0]
    const cart = Array.isArray(order?.cart) ? order.cart[0] : order?.cart
    const occurredAt = order?.created_at && new Date(order.created_at).toISOString()
    const currencyCode = normalizeCurrencyCode(order?.currency_code)
    const totalAmount = normalizeMajorAmount(order?.total)
    if (!order || !cart?.id || !occurredAt || !currencyCode || !totalAmount) {
      throw new Error("native order.placed lacks order/cart/time/amount/currency")
    }

    const marker = {
      event_id: `medusa:order.placed:${orderId}`,
      source_event_type: "medusa.order_placed",
      source_schema_version: "2.0",
      order_id: orderId,
      cart_id: cart.id,
      occurred_at: occurredAt,
      currency_code: currencyCode,
      total_amount: totalAmount,
      amount_unit: "major",
      amount_semantics: "medusa.order.total",
    }
    if (process.env.SHADOW_WAL_PROBE_FAIL_BEFORE_EMIT === "1") {
      throw new Error("injected shadow failure before WAL write")
    }
    if (process.env.SHADOW_WAL_PROBE_FAIL_BEFORE_EMIT === "throw-once" && !injectedFailureConsumed) {
      injectedFailureConsumed = true
      throw new Error("injected one-time shadow failure before WAL write")
    }
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    await pg.raw("select pg_logical_emit_message(?, ?, ?)", [
      true,
      prefix,
      JSON.stringify(marker),
    ])
    logger.info(`CDC shadow WAL marker emitted for ${orderId}`)
  } catch (error) {
    logger.warn(
      `CDC shadow WAL marker failed for native order.placed: ${error instanceof Error ? error.message : "unknown error"}`
    )
    if (process.env.SHADOW_WAL_PROBE_FAIL_BEFORE_EMIT === "throw-once") throw error
  }
}

module.exports = {
  default: shadowOrderPlacedWal,
  config: { event: "order.placed" },
}
