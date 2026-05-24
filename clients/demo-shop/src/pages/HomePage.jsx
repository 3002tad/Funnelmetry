import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BANNER } from "../data/products.js";
import { tracking } from "../lib/tracking.js";

export function HomePage() {
  useEffect(() => {
    tracking.trackBannerImpression(BANNER).catch(() => {});
  }, []);

  return (
    <>
      <div
        className="banner"
        role="button"
        tabIndex={0}
        onClick={() => {
          tracking.trackBannerClick(BANNER).catch(() => {});
          window.location.href = BANNER.target_url;
        }}
      >
        <h2>{BANNER.banner_name}</h2>
        <p>Giảm giá mùa hè — click để xem sản phẩm nổi bật</p>
      </div>
      <p>Chào mừng đến cửa hàng demo. Dữ liệu hành vi được gửi qua Behavior SDK.</p>
      <Link to="/products">
        <button>Xem danh sách sản phẩm</button>
      </Link>
    </>
  );
}
