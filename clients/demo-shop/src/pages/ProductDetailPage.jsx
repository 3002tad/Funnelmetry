import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { PRODUCTS } from "../data/products.js";
import { tracking } from "../lib/tracking.js";

export function ProductDetailPage() {
  const { productId } = useParams();
  const cart = useCart();
  const product = PRODUCTS.find((p) => p.id === productId);

  useEffect(() => {
    if (product) {
      tracking.trackProductView(product.id, `/products/${product.id}`).catch(() => {});
    }
  }, [product]);

  if (!product) {
    return <p>Không tìm thấy sản phẩm.</p>;
  }

  return (
    <div className="card">
      <h2>{product.name}</h2>
      <p>{product.price.toLocaleString("vi-VN")} ₫</p>
      <p className="status">Mã: {product.id}</p>
      <button
        onClick={() => {
          cart.add(product);
          tracking
            .trackCustom("add_to_cart", {
              event_category: "behavior",
              product_id: product.id,
              metadata: { price: product.price, qty: 1 },
            })
            .catch(() => {});
        }}
      >
        Thêm vào giỏ
      </button>
      <div style={{ marginTop: "1rem" }}>
        <Link to="/products">← Quay lại</Link>
      </div>
    </div>
  );
}
