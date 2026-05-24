import { Link } from "react-router-dom";
import { useCart } from "../context/CartContext.jsx";

export function Layout({ children }) {
  const cart = useCart();
  const count = cart.items.reduce((n, i) => n + i.qty, 0);

  return (
    <div className="layout">
      <header>
        <strong>Demo Shop</strong>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/products">Sản phẩm</Link>
          <Link to="/cart">Giỏ ({count})</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
