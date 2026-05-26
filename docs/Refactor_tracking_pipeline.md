# Refactor tracking pipeline

> **Runtime deploy:** [`RUNTIME.md`](RUNTIME.md) — k3s, không RabbitMQ; commerce qua SDK. Tài liệu dưới là spec gốc (có thể khác deploy).

TỔNG HỢP REFACTOR PROJECT

Browser Behavior SDK + Commerce Backend + RabbitMQ Connector + Kafka Streaming + Dashboard/Chatbot

> Mục tiêu refactor: chuyển project cũ từ pipeline xử lý business event demo sang hệ thống thu thập, xử lý và phân tích realtime dữ liệu tracking của website TMĐT. Behavior tracking từ browser là dữ liệu xương sống; commerce event được mô phỏng từ backend qua RabbitMQ; Kafka và streaming tiếp tục là lõi xử lý realtime; PostgreSQL/Qdrant phục vụ dashboard và chatbot AI.

# 0. Design pattern chính và mô hình code

## 0.1. Design pattern chính của project

Pattern chính của project là Event-Driven Architecture kết hợp Realtime Streaming Data Pipeline. Hệ thống không xử lý trực tiếp theo luồng request-response truyền thống, mà chuẩn hóa mọi hành vi người dùng và sự kiện commerce thành event để đưa vào message broker và xử lý realtime.

- Event-Driven Architecture: Browser Behavior SDK, Demo Commerce Backend và Commerce Connector phát sinh event; Kafka/RabbitMQ đóng vai trò message broker; Streaming Processor xử lý event bất đồng bộ.

- Producer–Consumer / Publish–Subscribe: SDK, Commerce Backend, Connector và Tracking API đóng vai trò producer; Commerce Connector và Streaming Processor đóng vai trò consumer.

- Pipeline Pattern: Streaming Processor xử lý event theo chuỗi bước parse, validate, clean, deduplicate, aggregate KPI, lưu PostgreSQL và sinh insight.

- Adapter / Connector Pattern: Commerce Connector chuyển đổi message từ RabbitMQ của Demo Commerce Backend sang schema tracking chung của hệ thống.

- API Gateway Pattern: Nginx/API Gateway điều hướng request từ SDK, dashboard và chatbot tới các service backend phù hợp.

- RAG Pattern: Chatbot kết hợp PostgreSQL để lấy số liệu chính xác và Qdrant để truy xuất insight/ngữ cảnh trước khi AI sinh câu trả lời.

Bảng tóm tắt pattern áp dụng:

| Nhóm | Pattern / Model | Áp dụng trong project |
| --- | --- | --- |
| Kiến trúc tổng thể | Event-Driven Architecture | Luồng event từ SDK/RabbitMQ/Tracking API đến Kafka và Streaming. |
| Giao tiếp bất đồng bộ | Producer–Consumer / Pub-Sub | Producer phát event, consumer xử lý event độc lập. |
| Xử lý dữ liệu | Pipeline Pattern | Parse → Validate → Clean → Aggregate → Persist → Insight. |
| Tích hợp commerce | Adapter / Connector Pattern | Commerce Connector chuẩn hóa event từ RabbitMQ. |
| Điều hướng request | API Gateway Pattern | Nginx route SDK, dashboard, chatbot tới backend service. |
| Chatbot AI | RAG Pattern | PostgreSQL cung cấp số liệu; Qdrant cung cấp insight/ngữ cảnh. |

## 0.2. Mô hình code đề xuất

Về mô hình code, project không nên được mô tả đơn thuần là MVC, vì hệ thống chủ yếu gồm API service, streaming processor, connector, SDK, dashboard và chatbot. Mô hình phù hợp hơn là Modular Layered Architecture.

- Backend API dùng Controller–Service–Repository/Producer: Controller nhận request, Service xử lý validate/enrich/logic, Repository/Producer giao tiếp với PostgreSQL, Kafka hoặc Qdrant.

- Frontend React dùng Component-Based Architecture: dashboard, chatbot UI và demo shop được chia thành page, component, hook và service gọi API.

- Streaming Processor dùng Pipeline Structure: consumer, parser, validator, cleaner, aggregator, sink_postgres và insight_generator được tách thành các bước xử lý rõ ràng.

- Chatbot dùng Service Layer + RAG: chat controller gọi chat service, intent service, SQL query service, RAG service và prompt/model service.

- Bot Simulator là module riêng dùng Playwright/Puppeteer để thao tác trên demo shop như người dùng thật, không gửi thẳng event vào API.

Cấu trúc thư mục gợi ý:

services/
  api/
    tracking/
      tracking.controller.js
      tracking.service.js
      tracking.validator.js
      tracking.producer.js
    dashboard/
      overview.controller.js
      product.service.js
      funnel.repository.js
    chatbot/
      chat.controller.js
      chat.service.js
      intent.service.js
      rag.service.js
  commerce-connector/
  streaming-processor/
    consumer.py
    parser.py
    validator.py
    cleaner.py
    aggregator.py
    sink_postgres.py
    insight_generator.py
clients/
  demo-shop/
  dashboard/
sdk/
  browser-behavior-sdk/
bot-simulator/

Tóm lại, khi trình bày mô hình code nên dùng: Modular Layered Architecture cho toàn project, Controller–Service–Repository/Producer cho backend API, Component-Based Architecture cho React frontend, Pipeline Pattern cho streaming processor và Service Layer + RAG cho chatbot.

# 1. Bối cảnh và mục tiêu

Project hiện tại đã có nền pipeline streaming gồm API/generator, Kafka, streaming processor, PostgreSQL và dashboard. Hướng refactor không xây lại từ đầu mà thay đổi trọng tâm dữ liệu và nghiệp vụ phân tích.

- Dữ liệu chính chuyển từ business event đơn lẻ sang user behavior tracking event.

- Website demo trở thành nguồn phát sinh hành vi thật thông qua thao tác của bot hoặc người dùng.

- Commerce event như add_to_cart, checkout, purchase được phát sinh từ backend demo và đi qua RabbitMQ để mô phỏng tích hợp hệ thống TMĐT thực tế.

- Kafka tiếp tục là message bus trung tâm của analytics pipeline.

- Dashboard và chatbot trở thành lớp khai thác dữ liệu cho người dùng cuối.

# 2. Kiến trúc tổng quan sau refactor

Bot Simulator / User thật
        ↓
Demo Web TMĐT + Browser Behavior SDK
        ↓ behavior events
Tracking API ───────────────→ Kafka ──→ Streaming Processor ──→ PostgreSQL
        ↑                                                        ↓
        │                                                   Insight Generator
        │                                                        ↓
Commerce Connector ← RabbitMQ ← Demo Commerce Backend          Qdrant
        ↑                                                        ↓
        └──────────────────────── Dashboard + Chatbot AI ←───────┘

Luồng này chia rõ dữ liệu thành hai nhóm: behavior event từ trình duyệt và commerce event từ backend demo. Cả hai cuối cùng được chuẩn hóa về một event schema chung để đưa vào Kafka và xử lý realtime.

# 3. Vai trò các thành phần chính

| Thành phần | Vai trò |
| --- | --- |
| Browser Behavior SDK | Chạy trên trình duyệt của web demo, bắt hành vi view, click, scroll, search, product_view và gửi về Tracking API. |
| Demo Commerce Backend | Xử lý các thao tác thương mại giả lập như add cart, checkout, purchase; publish commerce event vào RabbitMQ. |
| RabbitMQ | Đóng vai trò queue nội bộ của website demo, mô phỏng cách hệ thống TMĐT phát sinh sự kiện nghiệp vụ. |
| Commerce Connector | Consume message từ RabbitMQ, validate và chuẩn hóa commerce event, sau đó gửi về Tracking API hoặc Kafka. |
| Tracking API | Cổng ingestion chung cho SDK và connector: nhận event, validate, enrich nhẹ, đẩy vào Kafka. |
| Kafka + Streaming | Xử lý realtime: parse, clean, deduplicate, aggregate KPI và phát hiện insight cơ bản. |
| PostgreSQL | Lưu event sạch, KPI, funnel, product/session analytics để dashboard truy vấn chính xác. |
| Qdrant | Lưu insight/tóm tắt dạng vector để chatbot truy xuất ngữ cảnh phân tích. |
| Dashboard + Chatbot | Hiển thị số liệu và cho phép người dùng hỏi dữ liệu bằng ngôn ngữ tự nhiên. |
| Bot Simulator | Dùng Playwright/Puppeteer để thao tác trên web demo như người dùng thật, không gửi thẳng event vào API. |

# 4. Luồng dữ liệu chi tiết

## 4.1. Luồng Behavior Tracking

Browser Behavior SDK
  → POST /track hoặc /track/batch
  → Tracking API validate event
  → Kafka topic: tracking_events_raw
  → Streaming Processor
  → PostgreSQL: tracking_events_clean, tracking_kpi_1m
  → Dashboard/Chatbot

- Phù hợp cho các event: page_view, product_view, product_click, scroll_depth, search, filter_apply.

- anonymous_id và session_id là bắt buộc để phân tích hành trình người dùng kể cả khi không đăng nhập.

- user_id chỉ có khi web demo có bước login giả lập.

## 4.2. Luồng Commerce Event qua RabbitMQ

Demo Commerce Backend
  → publish commerce event vào RabbitMQ
  → Commerce Connector consume message
  → chuẩn hóa về tracking schema chung
  → gửi Tracking API hoặc gửi thẳng Kafka
  → Streaming Processor xử lý như các event khác

- Phù hợp cho các event: add_to_cart, checkout_start, purchase_succeeded, payment_failed, cart_abandoned.

- Mô phỏng cách website TMĐT thật phát sinh event nghiệp vụ từ backend.

- Không để browser SDK đọc trực tiếp RabbitMQ để tránh lộ credential và phức tạp bảo mật.

# 5. Event schema đề xuất

Tất cả event, dù đến từ browser SDK hay RabbitMQ connector, nên được chuẩn hóa về schema chung để streaming processor xử lý thống nhất.

{
  "event_id": "evt_001",
  "event_source": "browser_sdk | commerce_backend_rabbitmq",
  "event_category": "behavior | commerce",
  "event_type": "product_view | add_to_cart | checkout_start | purchase_succeeded",
  "anonymous_id": "anon_123",
  "session_id": "sess_456",
  "user_id": null,
  "page_url": "/products/P001",
  "product_id": "P001",
  "timestamp": "2026-05-21T10:00:00Z",
  "metadata": {}
}

## 5.1. Ví dụ behavior event

{
  "event_id": "evt_1001",
  "event_source": "browser_sdk",
  "event_category": "behavior",
  "event_type": "product_view",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_001",
  "user_id": null,
  "page_url": "/products/P001",
  "product_id": "P001",
  "timestamp": "2026-05-21T10:00:00Z",
  "metadata": {
    "device": "desktop",
    "browser": "Chrome"
  }
}

## 5.2. Ví dụ commerce event

{
  "event_id": "evt_2001",
  "event_source": "commerce_backend_rabbitmq",
  "event_category": "commerce",
  "event_type": "purchase_succeeded",
  "anonymous_id": "anon_a1b2",
  "session_id": "sess_001",
  "user_id": "user_001",
  "page_url": "/checkout",
  "product_id": "P001",
  "timestamp": "2026-05-21T10:05:00Z",
  "metadata": {
    "order_id": "ORD001",
    "amount": 250000,
    "quantity": 1
  }
}

# 6. PostgreSQL schema tối thiểu

PostgreSQL là nguồn số liệu chính xác cho dashboard và chatbot. MVP nên có tối thiểu các bảng sau.

CREATE TABLE tracking_events_clean (
  event_id VARCHAR(100) PRIMARY KEY,
  event_time TIMESTAMP NOT NULL,
  event_source VARCHAR(80),
  event_category VARCHAR(50),
  event_type VARCHAR(80),
  anonymous_id VARCHAR(100),
  session_id VARCHAR(100),
  user_id VARCHAR(100),
  page_url TEXT,
  product_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tracking_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  total_events INT DEFAULT 0,
  page_views INT DEFAULT 0,
  product_views INT DEFAULT 0,
  clicks INT DEFAULT 0,
  searches INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  checkout_start INT DEFAULT 0,
  purchases INT DEFAULT 0,
  unique_sessions INT DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start)
);

CREATE TABLE product_kpi_1m (
  window_start TIMESTAMP NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  product_views INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  purchases INT DEFAULT 0,
  add_to_cart_rate NUMERIC DEFAULT 0,
  purchase_rate NUMERIC DEFAULT 0,
  PRIMARY KEY (window_start, product_id)
);

# 7. Dashboard + Chatbot

## 7.1. Dashboard nên có

- Overview cards: Total Events, Active Sessions, Page Views, Product Views, Add To Cart, Checkout, Purchases, Conversion Rate.

- Realtime Event Stream: hiển thị event mới nhất theo thời gian.

- Conversion Funnel: page_view → product_view → add_to_cart → checkout_start → purchase.

- Product Analytics: top viewed products, top add-to-cart products, high-view low-purchase products.

- System Status cơ bản: API, Kafka, Streaming, PostgreSQL, RabbitMQ connector.

## 7.2. Chatbot nên có

- Cho phép hỏi dữ liệu bằng ngôn ngữ tự nhiên.

- Với câu hỏi số liệu, chatbot query PostgreSQL.

- Với câu hỏi phân tích/gợi ý, chatbot kết hợp PostgreSQL và Qdrant.

- Không để model AI tự tính toán số liệu quan trọng; số liệu phải lấy từ DB.

Các câu hỏi MVP nên hỗ trợ:

- Tóm tắt tình hình website hiện tại.

- Top sản phẩm được xem nhiều nhất là gì?

- Sản phẩm nào nhiều view nhưng ít mua?

- Người dùng rớt nhiều nhất ở bước nào trong funnel?

- Có bao nhiêu session đang hoạt động?

- Gợi ý tối ưu sản phẩm có conversion thấp.

# 8. API endpoint đề xuất

| Endpoint | Phương thức | Mục đích |
| --- | --- | --- |
| /track | POST | Nhận một tracking event từ SDK hoặc connector. |
| /track/batch | POST | Nhận nhiều tracking event trong một request. |
| /api/overview | GET | Trả KPI tổng quan cho dashboard. |
| /api/events/recent | GET | Trả danh sách event mới nhất. |
| /api/funnel | GET | Trả số liệu funnel. |
| /api/products/top | GET | Trả top product theo view/add_to_cart/purchase. |
| /api/chat | POST | Nhận câu hỏi và trả lời bằng chatbot. |
| /health | GET | Health check cho Kubernetes/Nginx. |

# 9. Mapping refactor từ project cũ

| Module cũ | Module sau refactor | Cách tận dụng |
| --- | --- | --- |
| generator-api | tracking-api | Tận dụng phần nhận request và publish Kafka; đổi endpoint, schema và topic. |
| clients/generator | demo-shop | Tận dụng React app cũ làm web demo TMĐT, gắn Behavior SDK. |
| spark-streaming | streaming-processor | Giữ Spark/Kafka/PostgreSQL integration; đổi schema và logic KPI. |
| dashboard-api | dashboard-api + chatbot-api | Giữ service cũ, thêm endpoint overview/funnel/products/chat. |
| clients/dashboard | tracking dashboard + chatbot UI | Đổi card/chart từ business KPI sang behavior analytics. |
| infra/docker/k8s | infra mới | Giữ Kafka/PostgreSQL/Nginx/K8s, thêm RabbitMQ/Qdrant nếu kịp. |
| producer-poller | bỏ hoặc legacy | Không đưa vào luồng chính vì Tracking API publish trực tiếp Kafka. |

# 10. Phạm vi triển khai trong 12 ngày

## 10.1. Must-have

- Demo shop có các trang cơ bản: home, product list, product detail, cart, checkout, thank you.

- Browser Behavior SDK bắt view/click/scroll/search/product_view.

- Tracking API nhận event và đẩy Kafka.

- Kafka + Streaming xử lý realtime và ghi PostgreSQL.

- Dashboard hiển thị overview, recent events, funnel.

- Bot giả lập thao tác trên web demo.

## 10.2. Should-have

- Demo Commerce Backend publish add_to_cart/checkout/purchase vào RabbitMQ.

- Commerce Connector consume RabbitMQ và gửi Tracking API/Kafka.

- Product analytics: top viewed, high-view low-purchase.

- Chatbot intent-based truy vấn PostgreSQL.

## 10.3. Nice-to-have

- Qdrant lưu insight vector.

- Model AI nhỏ chạy local hoặc qua API nội bộ.

- Autoscaling/KEDA theo Kafka lag.

- CI/CD + ArgoCD đầy đủ.

- System monitoring sâu bằng Prometheus/Grafana.

# 11. Rủi ro và cách giảm scope

| Rủi ro | Tác động | Cách giảm scope |
| --- | --- | --- |
| RabbitMQ + Connector tốn thời gian | Chậm tiến độ backend | Cho commerce event đi trực tiếp từ SDK/Tracking API, để RabbitMQ là mở rộng. |
| Qdrant/RAG phức tạp | Chatbot không ổn định | Làm chatbot dựa trên PostgreSQL trước, Qdrant bổ sung sau. |
| Kubernetes lỗi deploy | Demo không chạy | Có Docker Compose backup. |
| Bot chạy không ổn định | Dữ liệu demo ít | Chuẩn bị thêm nút thao tác thủ công trên web demo. |
| Streaming aggregation lỗi | Dashboard thiếu KPI | Dashboard query trực tiếp tracking_events_clean trong MVP. |

# 12. Kết luận thiết kế

Hướng refactor đề xuất là hợp lý nếu giữ nguyên nguyên tắc: behavior tracking là xương sống, commerce event là luồng bổ sung từ backend, Kafka là message bus trung tâm của analytics pipeline, PostgreSQL là nguồn số liệu chính xác, Qdrant là nơi lưu insight cho chatbot.

- Không để browser SDK đọc trực tiếp RabbitMQ.

- Không để AI tự tính số liệu thay database.

- Không microservice hóa quá sớm trong MVP.

- Không phân tích sâu order/payment/refund như hệ thống nghiệp vụ thật.

- Tập trung demo end-to-end: bot thao tác → SDK/backend phát event → RabbitMQ/Kafka → streaming → dashboard/chatbot.

# 13. Bổ sung: Khả năng trả lời câu hỏi phân tích sản phẩm và banner

Phần này bổ sung yêu cầu phân tích theo ngôn ngữ tự nhiên cho chatbot/dashboard: hệ thống cần trả lời được các câu hỏi như “Tại sao sản phẩm A được view/click nhiều nhưng doanh thu lại ít?” hoặc “Banner B có được xem nhiều hay không?”. Đây là nhóm câu hỏi quan trọng vì thể hiện giá trị của hệ thống không chỉ ở biểu đồ realtime, mà còn ở khả năng giải thích dữ liệu hành vi và chuyển đổi.

## 13.1. Nguyên tắc trả lời

- PostgreSQL là nguồn số liệu chính xác cho các chỉ số như view, click, add_to_cart, purchase, revenue, impression và CTR.

- Qdrant lưu insight/tóm tắt để chatbot truy xuất ngữ cảnh phân tích, không thay thế số liệu từ database.

- Model AI nhỏ chỉ đóng vai trò diễn giải, tổng hợp và đề xuất; không tự bịa hoặc tự tính các KPI quan trọng.

- Các câu hỏi “tại sao” nên được trả lời dưới dạng giả thuyết phân tích dựa trên funnel, không khẳng định quan hệ nhân quả tuyệt đối nếu chưa có A/B test hoặc khảo sát người dùng.

## 13.2. Câu hỏi: Vì sao sản phẩm A view/click nhiều nhưng doanh thu ít?

Để trả lời câu hỏi này, hệ thống cần nối được hành trình của người dùng theo product_id và session_id. Các event tối thiểu cần có gồm product_view, product_click, add_to_cart, checkout_start, purchase_succeeded và payment_failed. Nếu có thêm source, campaign_id hoặc banner_id thì chatbot có thể phân tích sâu hơn nguồn traffic nào tạo ra view/click nhưng không chuyển đổi.

| Dấu hiệu dữ liệu | Diễn giải có thể đưa ra |
| --- | --- |
| View/click cao nhưng add_to_cart thấp | Người dùng quan tâm ban đầu nhưng trang chi tiết chưa đủ thuyết phục. Có thể kiểm tra giá, mô tả, hình ảnh, đánh giá hoặc CTA. |
| Add_to_cart cao nhưng checkout_start thấp | Người dùng thêm giỏ nhưng chưa sẵn sàng mua. Có thể liên quan đến phí ship, tổng tiền, voucher hoặc trải nghiệm giỏ hàng. |
| Checkout_start cao nhưng purchase thấp | Điểm rơi nằm ở checkout/payment. Có thể kiểm tra form thanh toán, lỗi payment, tốc độ xử lý hoặc chính sách vận chuyển. |
| Purchase có nhưng revenue thấp | Sản phẩm có giá trị đơn hàng thấp, số lượng mua thấp hoặc bị giảm mạnh bởi khuyến mãi/voucher. |
| Click cao từ banner/campaign nhưng purchase thấp | Banner/campaign thu hút sự chú ý nhưng landing page hoặc sản phẩm sau khi click chưa phù hợp kỳ vọng người dùng. |

Ví dụ câu trả lời chatbot mong muốn:

Trong 30 phút gần nhất, sản phẩm P001 có 2.500 lượt view và 900 lượt click, nhưng chỉ có 40 lượt add_to_cart và 5 purchase. Điểm rơi lớn nhất nằm ở bước click -> add_to_cart. Điều này cho thấy người dùng quan tâm ban đầu nhưng chưa đủ động lực thêm vào giỏ. Nên kiểm tra lại giá, mô tả, hình ảnh, đánh giá sản phẩm hoặc vị trí nút thêm vào giỏ.

## 13.3. Câu hỏi: Banner B có được xem nhiều hay không?

Để trả lời câu hỏi về banner, hệ thống không nên chỉ dựa vào page_view vì người dùng vào trang không có nghĩa là đã nhìn thấy banner. Behavior SDK cần bổ sung event banner_impression và banner_click. Một impression nên được ghi nhận khi banner xuất hiện trong viewport đủ điều kiện, ví dụ hiển thị ít nhất 50% diện tích trong tối thiểu 1 giây.

| Event | Ý nghĩa | Field quan trọng |
| --- | --- | --- |
| banner_impression | Banner thật sự xuất hiện trong vùng nhìn thấy của người dùng. | banner_id, banner_name, position, page_url, campaign_id, viewport_visible_percent |
| banner_click | Người dùng click vào banner. | banner_id, target_url, target_product_id, campaign_id, session_id |
| product_view sau banner_click | Người dùng vào trang sản phẩm/landing page sau khi click banner. | source_component=banner, banner_id, product_id |
| purchase_succeeded sau banner_click | Banner có đóng góp vào chuyển đổi/mua hàng. | banner_id hoặc campaign_id, product_id, amount |

Ví dụ event banner_impression:

{
  "event_id": "evt_banner_001",
  "event_source": "browser_sdk",
  "event_category": "behavior",
  "event_type": "banner_impression",
  "anonymous_id": "anon_123",
  "session_id": "sess_456",
  "page_url": "/",
  "timestamp": "2026-05-21T10:00:00Z",
  "metadata": {
    "banner_id": "B001",
    "banner_name": "Summer Sale Banner",
    "position": "homepage_top",
    "campaign_id": "CMP_SUMMER",
    "viewport_visible_percent": 75
  }
}

Ví dụ câu trả lời chatbot mong muốn:

Banner B001 được xem nhiều trong 30 phút gần nhất: 1.200 impressions, 180 clicks, CTR đạt 15%. Banner này đang đứng thứ 2 trong nhóm banner homepage. Tuy nhiên, sau khi click vào banner, tỉ lệ add_to_cart của sản phẩm đích chỉ đạt 3%, thấp hơn mức trung bình 8%.

## 13.4. Bổ sung field vào event schema

Schema chung vẫn giữ nguyên các field cốt lõi, nhưng nên bổ sung các field tùy chọn trong metadata hoặc top-level để hỗ trợ phân tích product/banner/campaign.

- product_id, product_name, category_id, price, quantity, amount, currency.

- banner_id, banner_name, banner_position, campaign_id, target_url, target_product_id.

- source_component: banner, product_card, search_result, recommendation, category_page.

- funnel_step: view, click, add_to_cart, checkout, purchase.

- attribution fields: referrer, source_page, campaign_id, session_id.

## 13.5. Bảng KPI bổ sung

Để chatbot và dashboard trả lời nhanh, streaming processor nên tạo thêm KPI theo sản phẩm và banner.

CREATE TABLE banner_kpi_1m (
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  banner_id VARCHAR(100),
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  target_product_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start, banner_id)
);

CREATE TABLE product_revenue_kpi_1m (
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  product_id VARCHAR(100),
  views INT DEFAULT 0,
  clicks INT DEFAULT 0,
  add_to_cart INT DEFAULT 0,
  checkout_start INT DEFAULT 0,
  purchases INT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  view_to_cart_rate NUMERIC DEFAULT 0,
  purchase_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (window_start, product_id)
);

## 13.6. API/Chatbot intent bổ sung

| Endpoint/Intent | Mục đích |
| --- | --- |
| GET /api/products/anomalies | Trả danh sách sản phẩm view/click cao nhưng add_to_cart, purchase hoặc revenue thấp. |
| GET /api/products/:productId/funnel | Trả funnel chi tiết theo sản phẩm. |
| GET /api/banners/top | Trả top banner theo impression/click/CTR. |
| GET /api/banners/:bannerId/performance | Trả hiệu quả của một banner cụ thể, gồm impression, click, CTR và conversion downstream. |
| chat intent: explain_low_revenue_product | Trả lời câu hỏi vì sao sản phẩm có view/click cao nhưng doanh thu thấp. |
| chat intent: banner_performance | Trả lời câu hỏi banner có được xem/click nhiều hay không. |

## 13.7. Cập nhật Dashboard

- Product Insight: danh sách sản phẩm high-view low-purchase hoặc high-click low-revenue.

- Product Funnel Detail: view -> click -> add_to_cart -> checkout_start -> purchase theo từng sản phẩm.

- Banner Performance: impressions, clicks, CTR, downstream product_view, add_to_cart, purchase.

- AI Insight Panel: hiển thị insight mới nhất như “Sản phẩm P001 có click cao nhưng add_to_cart thấp” hoặc “Banner B001 có CTR tốt nhưng conversion thấp”.

## 13.8. Giới hạn phân tích

- Hệ thống có thể đưa ra nguyên nhân có khả năng cao dựa trên dữ liệu funnel, nhưng không khẳng định nguyên nhân tuyệt đối.

- Muốn kết luận nhân quả cần bổ sung A/B testing, khảo sát người dùng hoặc dữ liệu nghiệp vụ thực tế từ hệ thống bán hàng.

- Nếu commerce event chỉ là dữ liệu demo, phần doanh thu cần được mô tả là doanh thu mô phỏng, không phải dữ liệu giao dịch thật.

- Banner impression cần định nghĩa rõ điều kiện ghi nhận để tránh đếm sai hoặc đếm quá nhiều.

Kết luận bổ sung: Với các event và KPI trên, hệ thống có thể trả lời được các câu hỏi phân tích như sản phẩm nhiều view/click nhưng doanh thu thấp, hoặc banner có được xem/click nhiều hay không. Giá trị chính của chatbot là giúp người dùng chuyển từ việc tự đọc biểu đồ sang hỏi trực tiếp bằng ngôn ngữ tự nhiên.
