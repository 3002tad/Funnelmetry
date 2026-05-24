import { createContext, useContext, useMemo, useState } from "react";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);

  const api = useMemo(
    () => ({
      items,
      add(product) {
        setItems((prev) => {
          const found = prev.find((i) => i.id === product.id);
          if (found) {
            return prev.map((i) =>
              i.id === product.id ? { ...i, qty: i.qty + 1 } : i
            );
          }
          return [...prev, { ...product, qty: 1 }];
        });
      },
      clear() {
        setItems([]);
      },
      total() {
        return items.reduce((sum, i) => sum + i.price * i.qty, 0);
      },
    }),
    [items]
  );

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart outside CartProvider");
  return ctx;
}
