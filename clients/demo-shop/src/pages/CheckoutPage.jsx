import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";
import { tracking } from "../lib/tracking.js";

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@shop.local");

  async function submit(e) {
    e.preventDefault();
    tracking.setUserId(email);
    const orderId = `ORD${Date.now()}`;

    await tracking.trackCustom("checkout_start", {
      metadata: { order_id: orderId, amount: cart.total(), item_count: cart.items.length },
    }).catch(() => {});

    for (const item of cart.items) {
      await tracking
        .trackCustom("purchase_succeeded", {
          product_id: item.id,
          metadata: {
            order_id: orderId,
            amount: item.price * item.qty,
            quantity: item.qty,
          },
        })
        .catch(() => {});
    }

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
