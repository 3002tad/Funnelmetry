# commerce-backend (Web Demo API — stand-in)

HTTP API mô phỏng **web-shop backend** trên k3s cho đến khi `clients/web-shop` publish RabbitMQ trực tiếp.

- `POST /api/orders` — tạo đơn, publish `order.created` → exchange `ecommerce.events` (topic)
- Legacy: `POST /commerce/*` — tương thích cũ

**Không** chạy trên Laptop 2; web-shop gọi `COMMERCE_BACKEND_URL=http://<WSL_IP>:30330`.

Luồng đầy đủ: [`docs/RabbitMQ Integration Guide.docx`](../../docs/RabbitMQ%20Integration%20Guide.docx) · [`docs/RUNTIME.md`](../../docs/RUNTIME.md) §6.
