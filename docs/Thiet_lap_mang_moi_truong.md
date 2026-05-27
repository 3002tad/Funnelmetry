# Thiet lap mang moi truong

> **Runtime deploy hôm nay:** [`RUNTIME.md`](RUNTIME.md) — k3s trên WSL2; commerce qua RabbitMQ + connector.

TỔNG HỢP THIẾT LẬP MẠNG + MÔI TRƯỜNG CHẠY DEMO

> Mục tiêu: thiết lập môi trường demo phân tán nhưng ổn định, không phụ thuộc cùng lớp mạng LAN. Server giữ vai trò Headscale + DERP để quản lý tailnet và relay khi NAT khó. Laptop 1 chạy backend/dashboard trong Ubuntu WSL2 và là node backend chính. Laptop 2 chạy web demo trên Windows local, đồng thời chạy Bot Simulator trên cùng máy để tạo hành vi người dùng ổn định. Bot trên server chỉ đóng vai trò dự phòng hoặc dùng khi cần test phân tán.

# 1. Mô hình triển khai tổng quan

Mô hình cập nhật đặt bot giả lập ở Laptop 2, cùng nơi chạy web demo. Cách này giảm phụ thuộc vào đường truyền Server → Laptop 2 khi mạng phải relay qua DERP, đồng thời vẫn kiểm thử đúng pipeline vì Browser SDK trên web demo vẫn gửi event qua tailnet về backend ở Laptop 1.

| Thiết bị | Vai trò chính | Thành phần chạy |
| --- | --- | --- |
| Server Xubuntu | Control plane mạng riêng + relay + bot backup | Headscale, DERP, Bot Simulator dự phòng/Bot Controller tùy chọn |
| Laptop 1 | Node backend/dashboard chính | Ubuntu WSL2, Tailscale, **k3s** (`infra/k8s/sprint3`), Tracking API, Kafka, Streaming, PostgreSQL, Qdrant, Dashboard, Ollama |
| Laptop 2 | Node web demo + bot chính + thiết bị thao tác | Windows local, Tailscale Windows, Web Demo TMĐT, Bot Simulator Playwright, trình duyệt cho giảng viên thao tác |

# 2. Sơ đồ mạng đề xuất

Tailnet do Headscale quản lý

        ┌──────────────────────┐
        │ Server Xubuntu       │
        │ Headscale + DERP     │
        │ Bot backup           │
        └──────────┬───────────┘
                   │
     ┌─────────────┴─────────────┐
     │                           │
┌────▼────────────────┐     ┌────▼────────────────────┐
│ Laptop 1            │     │ Laptop 2                 │
│ Ubuntu WSL2         │     │ Windows local            │
│ Tailscale in WSL2   │     │ Tailscale on Windows     │
│ Backend + Dashboard │◄────│ Web Demo + Bot Simulator │
└─────────────────────┘     └──────────────────────────┘

Luồng chính khi demo:

1.  Giảng viên hoặc bot local thao tác trên Web Demo ở Laptop 2.

2.  Browser Behavior SDK trên Web Demo gửi behavior event về Tracking API ở Laptop 1 qua tailnet.

3.  Khi thao tác add cart/checkout/purchase, Web Demo gọi Demo Commerce Backend ở Laptop 1.

4.  Demo Commerce Backend publish commerce event vào RabbitMQ; Commerce Connector chuẩn hóa event và gửi Tracking API hoặc Kafka.

5.  Kafka + Streaming Processor xử lý realtime, lưu PostgreSQL và sinh insight cho Qdrant.

6.  Dashboard + Chatbot trên Laptop 1 đọc PostgreSQL/Qdrant để hiển thị và trả lời câu hỏi.

# 3. Laptop 1: Backend/Dashboard trong Ubuntu WSL2

Laptop 1 là node backend chính. Tailscale được cài trong Ubuntu WSL2 để WSL2 trở thành một node riêng trong tailnet. Cách này cho phép Laptop 2 gọi thẳng vào backend theo hostname/IP tailnet của Ubuntu WSL2, đồng thời vẫn giữ port-forwarding hiện tại để Windows browser trên Laptop 1 truy cập dashboard/k3s dashboard.

| Nhóm | Cấu hình khuyến nghị |
| --- | --- |
| Hệ điều hành chạy backend | Ubuntu WSL2 |
| Tailscale | Cài trong Ubuntu WSL2, join vào Headscale tailnet |
| Port-forwarding hiện tại | Giữ nguyên để Windows browser truy cập dashboard/k3s dashboard qua localhost |
| Backend stack | Tracking API, Demo Commerce Backend, RabbitMQ, Commerce Connector, Kafka, Streaming Processor, PostgreSQL, Qdrant, Dashboard/Chatbot |
| Gateway | Nên có Nginx/API Gateway để gom /track, /api, /commerce, /dashboard vào một cổng |

## 3.1. Tailscale trong WSL2

Tailscale trong WSL2 giúp backend xuất hiện như một node riêng trong tailnet. Laptop 2 và server có thể gọi trực tiếp vào backend mà không phụ thuộc vào portproxy của Windows host.

curl -fsSL https://tailscale.com/install.sh | sh

sudo tailscale up --login-server https://<headscale-domain>

tailscale status

## 3.2. Port-forwarding dashboard/k3s cho Windows browser

Nếu chỉ cần Windows browser trên cùng Laptop 1 mở dashboard/k3s dashboard thì giữ port-forwarding mặc định qua localhost là đủ.

kubectl port-forward -n kubernetes-dashboard svc/kubernetes-dashboard-kong-proxy 8443:443

Windows browser mở:

https://localhost:8443

Nếu muốn thiết bị khác trong tailnet cũng truy cập được port-forward này, cần bind ra toàn bộ interface. Chỉ nên dùng tạm thời khi debug/demo vì Kubernetes Dashboard là thành phần nhạy cảm.

kubectl port-forward --address 0.0.0.0 -n kubernetes-dashboard svc/kubernetes-dashboard-kong-proxy 8443:443

## 3.3. Route backend nên expose

http://laptop1-wsl-tailnet/track      → Tracking API
http://laptop1-wsl-tailnet/api        → Dashboard/Chatbot API
http://laptop1-wsl-tailnet/commerce   → Demo Commerce Backend
http://laptop1-wsl-tailnet/dashboard  → Dashboard UI

Các service nội bộ không nên expose trực tiếp qua tailnet nếu không cần: Kafka 9092, PostgreSQL 5432, RabbitMQ 5672, Qdrant 6333. Chúng nên nằm trong Docker/k3s internal network.

# 4. Laptop 2: Web Demo + Bot Simulator chạy Windows local

Laptop 2 là nơi chạy web demo cho giảng viên thao tác và cũng là nơi chạy bot chính. Bot mở web demo qua localhost, thao tác bằng Playwright như người dùng thật. Browser SDK trong web demo vẫn gửi event về backend Laptop 1 qua tailnet, nên luồng tracking vẫn đúng với hệ thống thực tế.

| Nhóm | Cấu hình khuyến nghị |
| --- | --- |
| Web demo | Chạy local Windows bằng Node.js/Vite/React |
| Bot Simulator | Chạy local Windows cùng web demo, dùng Playwright CLI-based User Simulator |
| Tailscale | Cài trên Windows và join Headscale tailnet |
| URL web demo cho giảng viên | http://localhost:5173 |
| URL web demo qua tailnet | http://laptop2-tailnet:5173 |
| API backend | Gọi về Laptop 1 WSL tailnet hostname/IP, không gọi localhost |

## 4.1. Chạy web demo để máy khác có thể truy cập

Khi dùng Vite/React, nên bind host 0.0.0.0 để có thể mở từ tailnet khi cần. Với bot local trên cùng Laptop 2, bot có thể dùng localhost để truy cập nhanh và ổn định hơn.

npm run dev -- --host 0.0.0.0

## 4.2. Biến môi trường web demo

VITE_TRACKING_API_URL=http://laptop1-wsl-tailnet/track
VITE_COMMERCE_API_URL=http://laptop1-wsl-tailnet/commerce
VITE_DASHBOARD_API_URL=http://laptop1-wsl-tailnet/api

> Lưu ý: Không dùng localhost trong frontend để gọi backend Laptop 1. localhost trên Laptop 2 chỉ trỏ về chính Laptop 2, không phải backend ở Laptop 1.

## 4.3. Bot Simulator local trên Laptop 2

Bot nên viết dưới dạng Playwright-based User Simulator, chạy bằng CLI local. Bot không gửi event thẳng vào Tracking API mà chỉ thao tác trên Web Demo. Event vẫn được sinh ra bởi Browser SDK và commerce flow của web demo.

| Thành phần bot | Mô tả |
| --- | --- |
| Công nghệ | Node.js + TypeScript hoặc JavaScript + Playwright |
| Cách chạy | CLI script, không cần API service trong MVP |
| Mỗi user giả lập | Một browser context riêng để tách cookie/localStorage/session |
| Luồng đúng | Bot → Web Demo → SDK/Commerce call → Backend Laptop 1 |
| Luồng cần tránh | Bot gửi JSON trực tiếp vào Tracking API như generator cũ |

node bot-simulator/run.js --url=http://localhost:5173 --bots=10 --duration=10m

Các scenario nên có:

- Browse only: vào trang chủ, scroll, click sản phẩm, xem trang chi tiết rồi thoát.

- Product interested: search/filter, xem nhiều sản phẩm, click qua lại giữa các trang.

- Add to cart abandon: xem sản phẩm, add to cart, mở giỏ hàng rồi thoát.

- Checkout abandon: add to cart, vào checkout nhưng không purchase.

- Purchase success: xem sản phẩm, add to cart, checkout và hoàn tất purchase.

# 5. Server: Headscale + DERP + Bot backup

Server Xubuntu đóng vai trò ổn định mạng riêng. Headscale quản lý tailnet, DERP làm relay fallback khi mạng 4G/phòng lab gặp NAT khó. Bot trên server không còn là bot chính; chỉ giữ làm phương án dự phòng hoặc dùng để chứng minh demo phân tán nếu cần.

| Thành phần | Vai trò |
| --- | --- |
| Headscale | Quản lý node, key, namespace/user, policy tailnet self-host |
| DERP | Relay dự phòng khi direct connection giữa node thất bại do NAT/firewall |
| Bot backup | Tùy chọn: truy cập web demo qua tailnet để test phân tán hoặc tạo thêm traffic khi Laptop 2 không đủ tài nguyên |
| Bot Controller | Tùy chọn: giao diện/API để chỉnh số bot, kịch bản, tốc độ chạy |

node bot-simulator/run.js --url=http://laptop2-tailnet:5173 --bots=10 --duration=10m

# 6. Quy ước URL, hostname và port

| Đối tượng | Hostname/URL đề xuất | Ghi chú |
| --- | --- | --- |
| Laptop 1 WSL2 backend | laptop1-wsl-tailnet | Node Tailscale nằm trong Ubuntu WSL2 |
| Laptop 2 web demo | laptop2-tailnet | Node Tailscale nằm trên Windows |
| Server headscale/DERP | server-tailnet | Node server trong tailnet |
| Tracking API | http://laptop1-wsl-tailnet/track | SDK gửi event về đây |
| Commerce API | http://laptop1-wsl-tailnet/commerce | Web demo gọi khi add cart/checkout/purchase |
| Dashboard | http://laptop1-wsl-tailnet/dashboard | Mở từ Laptop 1 hoặc Laptop 2 |
| Web demo local | http://localhost:5173 | Giảng viên và bot local trên Laptop 2 truy cập |
| Web demo tailnet | http://laptop2-tailnet:5173 | Server bot hoặc máy khác trong tailnet truy cập |

| Port | Nơi chạy | Expose ra tailnet? | Ghi chú |
| --- | --- | --- | --- |
| 80/8080 | Laptop 1 WSL2 | Có | Gateway/API/Dashboard nếu gom qua Nginx |
| 5173 | Laptop 2 Windows | Có khi cần | Web demo Vite/React; bot local có thể dùng localhost |
| 8443 | Laptop 1 WSL2 | Không mặc định | k3s dashboard port-forward cho Windows localhost; chỉ mở tailnet khi cần |
| 9092 | Laptop 1 nội bộ | Không | Kafka nội bộ Docker/k3s |
| 5672 | Laptop 1 nội bộ | Không | RabbitMQ AMQP nội bộ |
| 5432 | Laptop 1 nội bộ | Không | PostgreSQL nội bộ |
| 6333 | Laptop 1 nội bộ | Không | Qdrant nội bộ |

# 7. CORS, bảo mật và phạm vi expose

- Tracking API phải allow origin của Web Demo: http://localhost:5173 và http://laptop2-tailnet:5173.

- Trong demo mode có thể allow * để giảm lỗi, nhưng báo cáo nên ghi rõ production sẽ giới hạn origin.

- Không expose Kafka, PostgreSQL, RabbitMQ, Qdrant trực tiếp ra tailnet hoặc Internet nếu không cần.

- Nếu dùng k3s dashboard port-forward --address 0.0.0.0, chỉ bật trong thời gian debug/demo và tắt ngay sau đó.

- Bot nên thao tác trên Web Demo, không gửi thẳng event vào Tracking API, để chứng minh SDK hoạt động thật.

# 8. Checklist kiểm tra trước demo

| Vị trí | Việc cần kiểm tra | Lệnh/URL gợi ý |
| --- | --- | --- |
| Laptop 1 WSL2 | Kiểm tra tailnet backend online | tailscale status |
| Laptop 1 WSL2 | Kiểm tra NAT/DERP/direct connection | tailscale netcheck |
| Laptop 2 Windows | Kiểm tra gọi được API Laptop 1 | curl http://laptop1-wsl-tailnet/health |
| Laptop 2 Windows | Start web demo | npm run dev -- --host 0.0.0.0 |
| Laptop 2 Windows | Chạy bot local | node bot-simulator/run.js --url=http://localhost:5173 --bots=10 --duration=10m |
| Server | Kiểm tra web demo tailnet nếu dùng bot backup | curl http://laptop2-tailnet:5173 |
| Laptop 1 Windows browser | Mở k3s dashboard port-forward | https://localhost:8443 |

# 9. Kịch bản demo đề xuất

1.  Bật Headscale + DERP trên server, kiểm tra các node đều online trong tailnet.

2.  Trên Laptop 1 WSL2, start backend/dashboard bằng Docker Compose hoặc k3s.

3.  Trên Laptop 2 Windows, start web demo bằng lệnh host 0.0.0.0.

4.  Mở Dashboard trên Laptop 1 hoặc Laptop 2.

5.  Giảng viên thao tác web demo: xem sản phẩm, click banner, scroll, add cart, checkout.

6.  Chạy bot local trên Laptop 2 để tạo thêm nhiều session giả lập.

7.  Quan sát dashboard realtime event stream, funnel, product analytics.

8.  Hỏi chatbot: “Sản phẩm nào view/click nhiều nhưng doanh thu thấp?” hoặc “Banner nào được xem nhiều?”.

9.  Nếu muốn chứng minh phân tán/DERP, chạy thêm bot backup trên server trỏ vào http://laptop2-tailnet:5173.

# 10. Rủi ro và cách xử lý

| Rủi ro | Dấu hiệu | Cách xử lý nhanh |
| --- | --- | --- |
| WSL2 Tailscale không online | Laptop 2 không gọi được laptop1-wsl-tailnet | Chạy lại tailscale up, kiểm tra headscale node list, restart WSL nếu cần |
| Windows browser không mở được dashboard port-forward | https://localhost:8443 lỗi | Kiểm tra kubectl port-forward còn chạy, service/pod dashboard còn running |
| Bot local không thao tác ổn định | Playwright timeout hoặc browser lag | Giảm BOT_COUNT, tăng delay, chạy headless=true khi cần tạo tải |
| CORS lỗi khi SDK gửi event | Browser console báo CORS | Allow origin http://localhost:5173 và http://laptop2-tailnet:5173 hoặc tạm allow * |
| Frontend gọi sai backend | Event không vào Tracking API | Kiểm tra .env không dùng localhost cho API Laptop 1 |
| DERP relay latency cao | Dashboard cập nhật chậm khi dùng bot backup server | Dùng bot local Laptop 2 làm luồng chính, giảm bot backup |
| Laptop 1 quá tải | Kafka/Streaming lag, dashboard chậm | Giảm bot, tắt Qdrant/model local nếu chưa cần, dùng PostgreSQL query trực tiếp |
| Laptop 2 quá tải | Web demo giật, bot chạy chậm | Giảm BOT_COUNT, chạy bot headless, hoặc chuyển một phần bot sang server backup |

# 11. Phương án dự phòng

- Backup 1: nếu Laptop 2 không truy cập được backend, chạy web demo trực tiếp trên Laptop 1 và dùng localhost.

- Backup 2: nếu bot local Laptop 2 bị lag, giảm số bot hoặc chạy bot backup trên server.

- Backup 3: nếu server/DERP lỗi, vẫn demo được tối thiểu bằng Laptop 2 → Laptop 1 nếu cùng LAN hoặc hotspot tạm.

- Backup 4: nếu k3s lỗi, chạy Docker Compose bản all-in-one trên Laptop 1.

- Backup 5: nếu Qdrant/model AI lỗi, chatbot fallback sang intent-based query PostgreSQL.

# 12. Kết luận cấu hình đề xuất

Cấu hình cập nhật phù hợp hơn cho demo thực tế: server giữ vai trò Headscale + DERP + bot backup; Laptop 1 chạy backend/dashboard trong Ubuntu WSL2 và join tailnet bằng Tailscale trong WSL2; Laptop 2 chạy web demo và bot simulator trên Windows local. Bot local giúp giảm rủi ro mạng Server → Laptop 2, nhưng vẫn tạo event đúng cách vì bot thao tác trên web demo và SDK gửi event về backend qua tailnet.

> Chốt thiết kế: Luồng demo chính nên là: Bot/Giảng viên thao tác trên Laptop 2 → Web Demo/SDK → Tracking API Laptop 1 → Kafka/RabbitMQ/Streaming → PostgreSQL/Qdrant → Dashboard/Chatbot. Server chỉ cần đảm bảo tailnet ổn định và có thể chạy bot backup khi cần.
