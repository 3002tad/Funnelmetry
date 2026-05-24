import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PRODUCTS } from "../data/products.js";
import { tracking } from "../lib/tracking.js";

export function ProductListPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(() => {
    return PRODUCTS.filter((p) => {
      const matchCat = category === "all" || p.category === category;
      const matchQ =
        !query || p.name.toLowerCase().includes(query.toLowerCase());
      return matchCat && matchQ;
    });
  }, [query, category]);

  function onSearch(e) {
    e.preventDefault();
    tracking.trackSearch(query).catch(() => {});
  }

  function onFilter(next) {
    setCategory(next);
    tracking.trackFilterApply({ category: next }).catch(() => {});
  }

  return (
    <>
      <form className="search-bar" onSubmit={onSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm sản phẩm..."
        />
        <button type="submit">Tìm</button>
      </form>
      <div style={{ marginBottom: "1rem" }}>
        {["all", "fashion", "electronics", "home", "books"].map((c) => (
          <button
            key={c}
            className={category === c ? "" : "secondary"}
            style={{ marginRight: "0.5rem" }}
            onClick={() => onFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid">
        {filtered.map((p) => (
          <div key={p.id} className="card">
            <h3>{p.name}</h3>
            <p>{p.price.toLocaleString("vi-VN")} ₫</p>
            <Link
              to={`/products/${p.id}`}
              onClick={() =>
                tracking.trackProductClick(p.id, `/products/${p.id}`).catch(() => {})
              }
            >
              Xem chi tiết
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
