import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { CartProvider } from "./context/CartContext.jsx";
import "./lib/tracking.js";
import { CartPage } from "./pages/CartPage.jsx";
import { CheckoutPage } from "./pages/CheckoutPage.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { ProductDetailPage } from "./pages/ProductDetailPage.jsx";
import { ProductListPage } from "./pages/ProductListPage.jsx";
import { ThankYouPage } from "./pages/ThankYouPage.jsx";

export default function App() {
  return (
    <CartProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductListPage />} />
          <Route path="/products/:productId" element={<ProductDetailPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/thank-you" element={<ThankYouPage />} />
        </Routes>
      </Layout>
    </CartProvider>
  );
}
