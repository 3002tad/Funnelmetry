import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { tracking } from "../lib/tracking.js";

export function CartPage() {
  const cart = useCart();

  if (cart.items.length === 0) {
    return (
      <>
        <p>Giỏ hàng trống.</p>
        <Link to="/products">Mua sắm ngay</Link>
      </>
    );
  }

  return (
    <>
      <h2>Giỏ hàng</h2>
      <ul className="cart-list">
        {cart.items.map((i) => (
          <li key={i.id}>
            <span>
              {i.name} × {i.qty}
            </span>
            <span>{(i.price * i.qty).toLocaleString("vi-VN")} ₫</span>
          </li>
        ))}
      </ul>
      <p>
        <strong>Tổng: {cart.total().toLocaleString("vi-VN")} ₫</strong>
      </p>
      <Link
        to="/checkout"
        onClick={() =>
          tracking
            .trackCustom("checkout_start", {
              event_category: "behavior",
              metadata: { item_count: cart.items.length, total: cart.total() },
            })
            .catch(() => {})
        }
      >
        <button>Thanh toán</button>
      </Link>
    </>
  );
}
