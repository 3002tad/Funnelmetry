const key = process.env.SHADOW_PUBLISHABLE_KEY
const cartId = process.env.SHADOW_CART_ID
if (!key || !/^cart_[A-Za-z0-9]+$/.test(cartId ?? "")) throw new Error("shadow key/cart missing")

const response = await fetch(`http://127.0.0.1:9000/store/carts/${cartId}/complete`, {
  method: "POST",
  headers: { "x-publishable-api-key": key, "content-type": "application/json" },
  body: "{}",
})
const result = await response.json().catch(() => ({}))
console.log(`shadow_cart=${cartId}`)
console.log(`completion_http=${response.status}`)
console.log(`completion_type=${result.type ?? "unknown"}`)
if (result.order?.id) console.log(`shadow_order=${result.order.id}`)
if (result.error) console.log(`completion_error=${String(result.error.message ?? result.error).slice(0, 180)}`)
