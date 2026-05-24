import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { tracking } from "../lib/tracking.js";

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@shop.local");

  function submit(e) {
    e.preventDefault();
    tracking.setUserId(email);
    tracking
      .trackCustom("purchase_succeeded", {
        event_category: "behavior",
        metadata: {
          order_id: `ORD${Date.now()}`,
          amount: cart.total(),
          item_count: cart.items.length,
        },
      })
      .catch(() => {});
    cart.clear();
    navigate("/thank-you");
  }

  if (cart.items.length === 0) {
    return <p>Không có sản phẩm để thanh toán.</p>;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Checkout</h2>
      <label>
        Email (login giả lập)
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p>Tổng: {cart.total().toLocaleString("vi-VN")} ₫</p>
      <button type="submit">Xác nhận mua</button>
    </form>
  );
}
