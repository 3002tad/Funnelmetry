import { Link } from "react-router-dom";

export function ThankYouPage() {
  return (
    <div className="card">
      <h2>Cảm ơn bạn!</h2>
      <p>Đơn hàng demo đã hoàn tất. Event purchase đã được gửi qua SDK.</p>
      <Link to="/">
        <button>Về trang chủ</button>
      </Link>
    </div>
  );
}
