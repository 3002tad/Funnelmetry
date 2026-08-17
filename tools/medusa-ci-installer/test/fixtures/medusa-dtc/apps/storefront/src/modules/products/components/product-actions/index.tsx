import { addToCart } from "@lib/data/cart"
async function action() {
    await addToCart({
      variantId: selectedVariant.id,
      quantity: 1,
      countryCode,
    })
}
