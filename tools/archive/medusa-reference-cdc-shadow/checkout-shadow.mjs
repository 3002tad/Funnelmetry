// One synthetic Store API checkout against the private cloned Medusa backend.
const base = "http://127.0.0.1:9000"
const key = process.env.SHADOW_PUBLISHABLE_KEY
if (!key) throw new Error("shadow publishable key missing")

async function call(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "x-publishable-api-key": key,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${method} ${path} HTTP ${response.status}: ${String(data.message ?? data.error ?? "unknown").slice(0, 180)}`)
  }
  return data
}

const regionId = "reg_01M5WHNDFJNMPDEBZWAX183NWD"
const variantId = process.env.SHADOW_VARIANT_ID ?? "variant_01M5WHND0HYTG5MSHEGQ69B9D5"
if (!/^variant_[A-Za-z0-9]+$/.test(variantId)) throw new Error("invalid shadow variant ID")
const cart = (await call("/store/carts", "POST", { region_id: regionId })).cart
if (!cart?.id) throw new Error("cart create returned no ID")
console.log(`shadow_cart=${cart.id}`)

await call(`/store/carts/${cart.id}/line-items`, "POST", { variant_id: variantId, quantity: 1 })
await call(`/store/carts/${cart.id}`, "POST", {
  email: `cdc-shadow-${Date.now()}@example.invalid`,
  shipping_address: {
    first_name: "CDC",
    last_name: "Shadow",
    address_1: "1 Example Street",
    city: "Copenhagen",
    country_code: "dk",
    postal_code: "1000",
    phone: "+4500000000",
  },
})

const shippingOptions = (await call(`/store/shipping-options?cart_id=${encodeURIComponent(cart.id)}`)).shipping_options ?? []
const standard = shippingOptions.find((option) => option.name === "Standard Shipping") ?? shippingOptions[0]
if (!standard?.id) throw new Error("no shipping option for shadow cart")
await call(`/store/carts/${cart.id}/shipping-methods`, "POST", { option_id: standard.id })

const collection = (await call("/store/payment-collections", "POST", { cart_id: cart.id })).payment_collection
if (!collection?.id) throw new Error("payment collection missing")
await call(`/store/payment-collections/${collection.id}/payment-sessions`, "POST", { provider_id: "pp_system_default" })

if (process.env.SHADOW_STOP_BEFORE_COMPLETE === "1") {
  console.log(`shadow_payment_collection=${collection.id}`)
  console.log("checkout_stage=ready_for_fault_injection")
  process.exit(0)
}

const result = await call(`/store/carts/${cart.id}/complete`, "POST", {})
console.log(`completion_type=${result.type ?? "unknown"}`)
if (result.type === "order" && result.order?.id) {
  console.log(`shadow_order=${result.order.id}`)
} else {
  console.log(`completion_error=${String(result.error?.message ?? result.error ?? "unknown").slice(0, 180)}`)
  process.exitCode = 2
}
