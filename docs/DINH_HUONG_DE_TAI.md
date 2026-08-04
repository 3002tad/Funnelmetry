# Định hướng đề tài (tổng hợp)

> File tổng hợp các quyết định về tên đề tài, phạm vi hệ thống, kiến trúc ingestion và hướng phát triển AI, chốt trong quá trình trao đổi trước phản biện. Dùng làm căn cứ khi viết báo cáo và trả lời hội đồng.
>
> **Quy ước đánh số:** Mục 1–10 = Các quyết định gốc (07-10 → 07-11). Mục C–R = Nhật ký trao đổi bổ sung theo trình tự thời gian (07-12 → 08-04).

## 1. Tên đề tài (2026-07-10, cập nhật 2026-08-04)

**Tên nhóm chốt nội bộ (2026-08-04), chờ giảng viên xác nhận trước giữa tháng 8:**

> **"Xây dựng Funnelmetry – hệ thống theo dõi hành vi người dùng và phân tích chuyển đổi thương mại điện tử theo thời gian thực, hỗ trợ phát hiện điểm nghẽn và đề xuất tối ưu bằng học máy"**


Lý do dùng **"hệ thống"** thay vì **"nền tảng"**:
- "Nền tảng" gợi ý multi-tenant/SaaS công cộng, API mở cho bên thứ ba — hệ thống hiện tại chưa đạt mức này, dùng sẽ bị hội đồng hỏi ngược ("sao gọi là nền tảng khi chỉ 1 web-shop demo?").
- "Hệ thống" khẳng định đúng những gì đã build: nhiều thành phần phối hợp end-to-end (SDK → Tracking API → Kafka → Streaming → Postgres/Qdrant → Dashboard/Chatbot), không overclaim.
- Nhất quán với quyết định self-hosted / single-tenant (mục 3) và mục tiêu dồn effort cho AI thay vì cho hạ tầng multi-tenant.

Lý do bổ sung tên **Funnelmetry** và cấu trúc lại tên đề tài:
- **Funnelmetry** ghép từ *funnel* và *measurement/telemetry*, thể hiện đúng vai trò đo lường liên tục hành trình chuyển đổi thay vì gắn thương hiệu với riêng một công nghệ như Kafka, chatbot hay XGBoost. Tên riêng cũng tạo định danh thống nhất cho toàn bộ hệ thống và các thành phần liên quan.
- Phần mô tả sau dấu gạch ngang vẫn xác định rõ đối tượng, miền nghiệp vụ và năng lực chính; vì vậy tên thương hiệu không làm giảm tính học thuật hoặc khiến người đọc phải tự đoán hệ thống làm gì.
- Cụm **"theo dõi hành vi người dùng"** được giữ ở vị trí đầu để làm rõ nguồn input cốt lõi. Cụm **"phân tích chuyển đổi thương mại điện tử"** nêu đích sử dụng của dữ liệu, tránh cách hiểu đây chỉ là một công cụ thu thập clickstream tổng quát.
- Cơ chế đánh giá before-after không còn được liệt kê trong tên để tránh tiêu đề quá dài, nhưng vẫn là một năng lực trong phạm vi hệ thống nhằm kiểm chứng khuyến nghị bằng KPI thực tế (mục 10).
- Không đưa UTM/đa kênh mạng xã hội (mục 9) vào tên vì đây là chiều dữ liệu bổ sung làm giàu input, không phải năng lực cốt lõi khác biệt.

Ánh xạ từng cụm trong tên vào thành phần thật:

| Cụm từ | Thành phần tương ứng |
|---|---|
| Funnelmetry | Tên chung của hệ thống và các thành phần thu thập, xử lý, phân tích dữ liệu |
| theo dõi hành vi người dùng | Browser Behavior SDK + Tracking API |
| phân tích chuyển đổi thương mại điện tử | Behavior event + commerce event → KPI theo sản phẩm/danh mục và time window |
| theo thời gian thực | Kafka + Streaming Processor (flush 5–10s) |
| phát hiện điểm nghẽn | Funnel KPI (`tracking_kpi_1m`) + model ML thay rule-based hiện tại (`insight_generator.py`) |
| đề xuất tối ưu | Insight + Chatbot RAG (dashboard-api, Qdrant, Ollama) |
| học máy | Model dự đoán/phân loại thay threshold cứng; kết quả model làm căn cứ sinh insight và khuyến nghị |

## Mô tả tổng quát hệ thống (theo định hướng mới)

**Funnelmetry** là hệ thống self-hosted hỗ trợ đơn vị thương mại điện tử theo dõi hành vi người dùng và phân tích chuyển đổi theo thời gian thực. Hệ thống kết hợp kiến trúc Event-Driven, Pub/Sub và Streaming Data Pipeline; các thành phần trao đổi qua hợp đồng sự kiện thay vì phụ thuộc trực tiếp vào nhau.

Browser Behavior SDK thu thập tương tác trên website; dữ liệu đơn hàng, thanh toán và doanh thu được nhận từ backend qua message queue hoặc API. Adapter chuẩn hoá các nguồn theo Universal Event Contract trước khi Kafka chuyển sự kiện đến Streaming Processor để làm sạch, liên kết và tổng hợp KPI theo sản phẩm, ngành hàng và cửa sổ thời gian. Reconciliation định lượng sai lệch, giúp trạng thái Order, Payment và Revenue hiện tại hội tụ về dữ liệu nguồn mà không cần truy cập trực tiếp cơ sở dữ liệu nghiệp vụ.

Điểm nhấn của Funnelmetry là luồng phân tích từ KPI Matrix, Feature Matrix đến phát hiện điểm nghẽn, tạo insight, đề xuất hành động và đo lại hiệu quả sau khi áp dụng. Việc tách các giai đoạn bằng contract cho phép thay thế mô hình, cơ chế giải thích hoặc nguồn tri thức mà không phải thiết kế lại toàn bộ pipeline. Kết quả được trình bày trên dashboard để người quản trị theo dõi nguyên nhân, khuyến nghị và sự thay đổi của các chỉ số chuyển đổi. Hệ thống định hướng sử dụng Prometheus/Grafana để theo dõi pipeline và Kubernetes (k3s) để hỗ trợ mở rộng khi lưu lượng tăng. Cấu hình phân tích có thể điều chỉnh theo nhóm sản phẩm hoặc ngành hàng.

## 2. Phạm vi: Hệ thống (self-hosted) — không đi hướng SaaS đa tenant (2026-07-10)

Quyết định: **giữ mô hình hệ thống self-hosted, single-tenant**, không phát triển thành SaaS đa khách hàng.

Lý do:
- SaaS đa tenant đòi hỏi thêm effort lớn không liên quan tới AI: data isolation theo tenant, billing/subscription, tenant-aware auth, onboarding — cạnh tranh trực tiếp thời gian với mục tiêu đi sâu AI trong quỹ 5 tháng còn lại.
- Hạ tầng hiện tại (k3s, 1 namespace, Postgres/Kafka dùng chung) chưa có cơ chế cô lập tenant — làm đúng chuẩn SaaS là một đề tài kỹ thuật khác (system design), không phải hướng AI/thuật toán đã chọn.
- Tránh nhóm câu hỏi phản biện khó về cô lập dữ liệu, mô hình chi phí, khả năng scale đa khách hàng.

Ghi chú cho báo cáo: có thể nhắc 1 câu ở phần "Hướng phát triển" rằng kiến trúc adapter hiện tại cho phép mở rộng thành SaaS đa tenant trong tương lai nếu bổ sung cơ chế cô lập dữ liệu — **chỉ là roadmap, không phải claim hiện tại**.

## 3. Vai trò của Adapter / Ingestion layer (2026-07-10)

**Mục đích cũ (không còn là lý do chính khi self-hosted):** chặn truy cập trực tiếp vào DB người dùng vì lý do bảo mật/multi-tenant (tránh lộ credential).

**Mục đích mới:** Adapter là tầng **chuẩn hoá & diễn giải ngữ nghĩa (schema/protocol translation)** — chuyển đổi các biểu diễn sự kiện không đồng nhất (message MQ, Webhook từ nền tảng tracking có sẵn, hoặc API call trực tiếp) thành event schema thống nhất của hệ thống, bất kể nguồn input là gì.

Kiến trúc ingestion đề xuất (nhiều loại nguồn, cùng 1 tầng adapter):

```
[App-level publish]  → MQ (RabbitMQ/Kafka/...) ──┐
[Webhook forwarding] → GA4/Segment/Custom ────────┼──→ Adapter (schema/semantic normalize) → Tracking API/Kafka core
[API call trực tiếp] → HTTP ─────────────────────┘
```

*Ghi chú: CDC (Debezium) đã bị loại khỏi sơ đồ vì vi phạm nguyên tắc phi xâm lấn CSDL (xem Mục 4 và Mục F). Thay vào đó, dòng thứ 2 phản ánh khả năng nhận dữ liệu từ nền tảng tracking có sẵn (GA4/Segment) qua Webhook (xem Mục O.5).*

Giá trị của ingestion đa nguồn **không phụ thuộc vào việc có phải SaaS đa khách hàng hay không** — một tổ chức tự host vẫn có nhiều hệ thống nội bộ khác công nghệ (web, mobile, backend cũ/mới, MQ khác nhau) cần hợp nhất về cùng 1 schema.

## 4. CDC (Change Data Capture) — Chỉ dùng để So sánh kiến trúc, KHÔNG nằm trong scope (2026-07-10, cập nhật 2026-08-03)

**Quyết định: CDC KHÔNG nằm trong scope hệ thống.** Hệ thống thiết kế theo nguyên tắc phi xâm lấn CSDL (xem Mục O.4), do đó CDC (đòi quyền SUPERUSER/Replication vào DB khách hàng) bị loại trừ hoàn toàn.

CDC chỉ được nhắc đến trong báo cáo ở 2 vị trí:
- **So sánh kiến trúc (Chương Cơ sở lý thuyết):** Phân tích tại sao chọn MQ thay vì CDC (xem Mục F — 4 rào cản thực tế).
- **Hướng phát triển:** Ghi nhận CDC như một tùy chọn mở rộng nếu khách hàng tự quản lý và đồng ý cấp quyền.

Ghi chú: Commerce-backend hiện tại dùng dual-write pattern (ghi state vào `orders.store.js` + publish event lên RabbitMQ là 2 bước tách biệt, có rủi ro mất event). Giải pháp trong scope là cơ chế Idempotency/Retry (Bài báo #1), không phải CDC.

## 5. Định hướng AI — đi sâu, quỹ thời gian còn 4 tháng (2026-07-10, cập nhật 2026-08-03)

Quyết định: **rút phạm vi ingestion/hạ tầng về mức tối thiểu, dồn effort cho AI/thuật toán**.

- Hiện tại: `insight_generator.py` dùng rule-based threshold (VD: `add_to_cart >= 3 và purchases == 0` → sinh insight text), không phải model học máy.
- **Đã chốt hướng Classification (XGBoost)**, nhưng dataset chính chưa được giảng viên chốt. Retailrocket và REES46 là hai ứng viên; chỉ quyết định sau khi chốt Universal Input Schema và runtime feature contract để tránh training-serving skew.
- Cần có: chuẩn bị dữ liệu/nhãn (Weak Supervision — Mục M), huấn luyện, và đánh giá định lượng so với baseline rule-based hiện tại (F1-Score, Precision, Recall) — đây là phần tạo "đóng góp khoa học" cho luận văn.
- Multi-backend simulator (mục 6) chỉ giữ ở mức tối thiểu, không đầu tư thêm effort ngoài phần đủ để demo.

## 6. Luồng tích hợp tham chiếu và khả năng mở rộng (2026-07-10, cập nhật 2026-08-03)

- Chỉ triển khai **một reference pipeline hoàn chỉnh**: Web-shop Node.js + Browser SDK cho behavior; backend + RabbitMQ + Worker + Adapter cho business event; cả hai hội tụ tại Tracking API/Kafka.
- Không xây thêm website/backend đầy đủ bằng PHP, Java hoặc Python. Khả năng mở rộng nguồn được chứng minh bằng Universal Event Contract có version, Source Adapter Interface, bảng mapping và contract/conformance test.
- Nguồn mới chỉ bổ sung Adapter ở biên. Streaming Processor, KPI và Model A1 chỉ nhận Universal Schema, không phụ thuộc ngôn ngữ, broker hay schema nội bộ của hệ thống khách hàng.
- Phải phân biệt rõ phần **đã triển khai** (SDK + Node.js/RabbitMQ Adapter) với extension specification (Webhook/Segment/Custom API).

## 7. Khảo sát hệ thống tương đồng (2026-07-10)

| Nhóm | Đại diện | Khác biệt với hệ thống đang xây |
|---|---|---|
| Web/Product Analytics (SaaS) | GA4, Mixpanel, Amplitude, Heap | Đóng (black-box), không self-hosted, AI insight hạn chế hoặc chi phí cao |
| Web/Product Analytics (self-hosted) | PostHog, Matomo, Snowplow | Có thể tự triển khai nhưng chưa đồng thời tập trung vào streaming Kafka realtime + AI insight/chatbot tích hợp sẵn |
| Session Replay/Heatmap | Hotjar, FullStory, Contentsquare, Glassbox | Thiên về UX friction, không phải KPI funnel, chi phí enterprise cao |
| CDP | Segment, Antsomi CDP 365, Insider, CleverTap | Mạnh về routing/marketing personalization, không tập trung phân tích funnel kỹ thuật + AI dự đoán |
| CRO | VWO, Optimizely | Dựa trên A/B testing thực nghiệm, không phải phân tích hành vi realtime bằng AI |
| TMĐT Việt Nam tích hợp sẵn | Haravan Insight, Sapo Analytics | Báo cáo doanh thu/đơn hàng cơ bản, ít AI insight hành vi sâu |

**Định vị khác biệt của đề tài:** self-hosted + kiến trúc streaming realtime (Kafka) rõ ràng + AI insight/dự đoán + chatbot RAG tích hợp sẵn + thiết kế theo hành vi mua sắm thị trường TMĐT Việt Nam — tổ hợp năng lực mà các nhóm giải pháp được khảo sát chưa đồng thời tập trung đầy đủ.

## 8. Việc cần nhất quán khi viết báo cáo (2026-07-10)

- Toàn bộ báo cáo dùng "hệ thống", không dùng "nền tảng" cho tên chính thức.
- Kiến trúc mô tả: 1 tổ chức/tenant, auth JWT role-based nội bộ (shop/chat/admin) — không nhắc tenant isolation như một tính năng đã có.
- Adapter/ingestion trình bày là hợp nhất dữ liệu đa nguồn **nội bộ** (không phải phục vụ nhiều khách hàng bên ngoài).
- SaaS đa tenant chỉ được nhắc ở phần "Hướng phát triển" như tiềm năng mở rộng, không phải mục tiêu hiện tại.

## 9. Attribution nguồn traffic mạng xã hội — UTM tagging (2026-07-11)

**Ý tưởng:** phân tích được lượt truy cập web đến từ link sản phẩm đính kèm trong bài đăng Facebook/TikTok/Zalo (tương tự cách ChatGPT gắn `utm_source=chatgpt.com` vào link trả lời).

**Khả thi** — dùng kỹ thuật chuẩn UTM parameter tracking, tương thích với kiến trúc SDK hiện có:

1. Link chia sẻ lên mạng xã hội được gắn query param: `?utm_source=facebook&utm_medium=social&utm_campaign=post_xxx`.
2. Browser Behavior SDK đọc `window.location.search` ở lần load trang đầu (first-touch), lưu `utm_source/medium/campaign` vào session-scoped storage (cùng cơ chế `anonymous_id`/`session_id` đã có).
3. Đính kèm vào `metadata` JSONB của event khi gửi lên Tracking API — không đổi schema lớn.
4. Streaming Processor aggregate thêm KPI theo nguồn (đề xuất bảng `traffic_source_kpi_1m`: views, add_to_cart, purchases, conversion_rate theo từng `utm_source`) → funnel cắt lát theo kênh (Facebook/TikTok/Zalo/organic).

**Giới hạn cần nêu rõ khi bảo vệ:**
- Phụ thuộc kỷ luật gắn tag khi đăng bài (không phải giới hạn kỹ thuật, mà là quy trình vận hành) → giải quyết bằng module tạo tag tự động (xem dưới).
- `document.referrer` không đáng tin cậy làm phương án chính (in-app browser của FB/TikTok/Zalo thường trả referrer rỗng hoặc domain trung gian) — UTM param do chính hệ thống kiểm soát mới đáng tin cậy.
- Cần test thực tế hành vi in-app webview (localStorage/cookie) trên từng nền tảng khi demo.

**Giá trị cho phần AI (mục 5):** thêm 1 chiều dữ liệu để model học "kênh nào dẫn traffic chuyển đổi tốt hơn", giúp phần "đề xuất tối ưu" ra khuyến nghị gắn với hành vi kinh doanh thật (VD: "nên tăng tần suất đăng bài trên kênh X vì tỉ lệ chuyển đổi cao hơn Y%").

### Module tạo tag tự động (đề xuất bổ sung, effort nhỏ)

Để loại bỏ rủi ro gắn tag thủ công sai/thiếu, xây 1 module nhỏ (không phải service riêng, không phải link-shortener đầy đủ):

- **Function thuần** `generateTrackableLink({ baseUrl, productId, source, medium, campaign })` → trả về URL đã gắn `utm_*` chuẩn hoá.
- **Whitelist/enum** cho `source` (`facebook`, `tiktok`, `zalo`, `chatgpt`, `organic`...) và `medium` (`social`, `ads`, `message`, `referral`...) — validate ở tầng API để tránh phân mảnh dữ liệu khi aggregate KPI.
- **1 endpoint admin nhỏ** (`POST /api/admin/links/generate`) + form đơn giản trong Dashboard UI (cùng khu vực `AdminInsightsPage`/`AdminSetupPage`) để nhân viên chọn sản phẩm + kênh + campaign → nhận link đã gắn tag để đăng bài.
- **(Tuỳ chọn)** bảng `campaign_links` (product_id, source, medium, campaign, created_at) lưu lịch sử link đã tạo, phục vụ đối chiếu hiệu quả từng chiến dịch.

Effort ước tính nhỏ, không ảnh hưởng tới quỹ thời gian dành cho phần AI (mục 5).

## 10. Tự động tracking & đánh giá lại hiệu quả khuyến nghị — feedback loop (2026-07-11)

**Ý tưởng:** ngoài phát hiện điểm nghẽn + sinh khuyến nghị (mục 5), hệ thống tự động theo dõi khuyến nghị nào đã được áp dụng và đánh giá lại hiệu quả thực tế sau khi áp dụng.

**Lý do nên làm:** đây chính là phần **"đánh giá hiệu quả tối ưu kinh doanh"** trong tên đề tài gốc ban đầu (mục 1), nay được cụ thể hoá thành một tính năng đo lường được, thay vì một cụm từ trừu tượng. Nếu dừng ở sinh insight/khuyến nghị, hệ thống chỉ đạt mức descriptive/diagnostic analytics (giống phần lớn công cụ ở mục 7). Thêm vòng đánh giá lại biến nó thành **prescriptive analytics có kiểm chứng** — khuyến nghị đưa ra có tác dụng thật hay không — là điểm khác biệt hiếm gặp, kể cả so với SaaS thương mại.

**Giới hạn về phương pháp (cần nêu rõ khi bảo vệ):** vì chỉ có 1 shop demo, không thể làm A/B test có nhóm đối chứng song song. Phương pháp áp dụng là **so sánh trước/sau theo mốc thời gian áp dụng hành động (before-after)** — kết quả mang tính tương quan, không khẳng định quan hệ nhân quả tuyệt đối (có thể bị nhiễu bởi mùa vụ, chiến dịch khác chạy song song). Hướng nâng cấp thành A/B test thật (chia traffic ngẫu nhiên) nên đưa vào phần "hướng phát triển".

**Thiết kế tối thiểu:**
1. Bảng mới `recommendation_actions`: `insight_id` (liên kết insight đã sinh ra), `action_description`, `applied_at`, `target_metric` (VD: `conversion_rate` của product X hoặc funnel stage Y).
2. Admin đánh dấu "đã áp dụng" khuyến nghị qua Dashboard (khu vực `AdminInsightsPage` đã có sẵn) → ghi `applied_at`.
3. Sau khi đủ 1 khoảng thời gian tương đương (cùng độ dài với window trước đó) → job đánh giá tự động so sánh KPI cùng metric, cùng đối tượng, giữa window trước và sau `applied_at` (tái dùng `tracking_kpi_1m`/`product_kpi_1m` đã có), tính delta %, có thể thêm kiểm định thống kê đơn giản (t-test) nếu đủ dữ liệu.
4. Kết quả đánh giá lưu thành 1 insight loại mới (`evaluation_result`) → đưa vào Qdrant để chatbot RAG trả lời được câu hỏi "khuyến nghị trước đó có hiệu quả không?".
5. Dashboard: biểu đồ so sánh trước/sau cho từng khuyến nghị đã áp dụng.

**Tham số Window — 2 chế độ:**
- **Chế độ Dev/Demo (Bot simulator):** Window size = 30 phút–1 giờ, min samples = 30 sessions/window. Ghi chú rõ trong báo cáo rằng window rút ngắn cho mục đích demo.
- **Khuyến nghị thực tế (Production):** Window size = 7 ngày trước/sau `applied_at`, min samples = 100 sessions/window để t-test có ý nghĩa thống kê (CLT). Nếu admin áp dụng nhiều khuyến nghị cùng lúc → hệ thống ghi nhận cùng window nhưng không claim nhân quả riêng lẻ cho từng khuyến nghị (ghi rõ hạn chế trong báo cáo).

**Effort & vị trí trong kế hoạch 5 tháng:** trung bình-nhỏ (logic so sánh KPI + 1 bảng mới + UI đánh dấu, tái dùng hạ tầng KPI đã có) — nhỏ hơn nhiều so với xây model ML từ đầu, không xung đột với ưu tiên đi sâu AI (mục 5), mà bổ sung thêm 1 chiều đánh giá khác cho luận văn.

### C. Lựa chọn model LLM cho chatbot — Model B (2026-07-12)

Làm rõ trước: khái niệm "thinking" (chain-of-thought) chỉ áp dụng cho **Model B (chatbot Ollama)**, không áp dụng cho Model A (mục 5, model dự đoán/phân loại trên dữ liệu dạng bảng — không phải LLM).

Vì VPS GPU chỉ thuê **đúng 1 tháng, đúng thời điểm phản biện** (cửa sổ rủi ro cao, không có thời gian debug), và vì chatbot không phải trọng tâm học thuật chính (Model A mới là phần "bằng học máy" được chấm điểm) → **ưu tiên độ ổn định & tốc độ phản hồi hơn số lượng tham số hoặc khả năng thinking**.

**Model đề xuất:** **Qwen3-4B** — fit gọn trong 4GB VRAM, có chế độ thinking bật/tắt tường minh (`/think`, `/no_think`).
- Chạy **non-thinking làm mặc định** trong toàn bộ luồng demo (nhanh, ổn định, ít rủi ro khi demo trực tiếp).
- Chỉ **bật thinking mode 1 lần, có chủ đích** khi muốn minh hoạ khả năng suy luận trước hội đồng (VD giải thích lý do 1 khuyến nghị cụ thể), không chạy thinking mode làm hành vi mặc định.
- Phương án dự phòng nếu cần chất lượng cao hơn: **DeepSeek-R1-Distill-Qwen-7B** (Q4_K_M ~4.3–4.7GB, cần offload nhẹ sang CPU nhờ RAM 24GB dư dả) — chấp nhận độ trễ cao hơn.

### D. Kiến trúc Lai 4 Model/Engine — Phân tách vai trò AI (2026-07-13)

Hệ thống được chia cắt thành 4 chốt chặn (Pipeline) chuyên biệt, áp dụng triết lý "Dùng đúng công cụ cho đúng bài toán" (Separation of Concerns).

| | Model A1 (Kẻ chẩn đoán) | Model A2 (Kẻ kê đơn) | Model B (Người phát ngôn) | Evaluation Engine (Kẻ kiểm chứng) |
|---|---|---|---|---|
| **Nhiệm vụ** | Đọc dữ liệu Streaming (Clickstream) để phát hiện Lỗi/Điểm nghẽn rớt phễu. | Nhận Lỗi từ Model A1, đối chiếu ma trận luật để sinh ra Đề xuất hành động kinh doanh. | Đọc kết quả từ Qdrant (Lỗi + Đề xuất + Đánh giá) và diễn giải bằng ngôn ngữ tự nhiên. | Đo lường tỷ lệ chuyển đổi KPI trước-sau khi Admin áp dụng đề xuất để đánh giá độ hiệu quả. |
| **Bản chất** | Model Học máy truyền thống (VD: Classification/XGBoost). | Ưu tiên Hệ chuyên gia (Rule-based). Có thể nâng cấp thành Model ML chuyên biệt (Recommender System) nếu đồ án còn dư thời gian. | LLM RAG thuần túy (Qwen3-4B). | Thuật toán thống kê tất định (Before-after delta, t-test). |
| **Có phải "học máy"?**| Có — Trọng tâm học thuật (Data Science) của đề tài. | Tạm thời là Không (Dùng logic tĩnh để đảm bảo tiến độ). Có thể chuyển thành ML ở pha sau. | Có — Ứng dụng Generative AI (Lớp trình bày). | Không — Thống kê mô tả/kiểm định. |
| **Tài nguyên** | Chạy liên tục (24/7) xử lý Real-time cực nhanh trên **CPU**. | Chạy liên tục song song cùng Model A1 trên **CPU**. | Chạy On-demand (Chỉ khi Admin hỏi), bắt buộc cần **GPU**. | Tính toán nhẹ nhàng bằng truy vấn SQL/Python trên **CPU**. |

Luồng phối hợp (Pipeline):
```text
[Streaming Data]
       ↓
Model A1 (Machine Learning) → Phát hiện: "Sản phẩm X rớt phễu tại Giỏ hàng" 
       ↓
Model A2 (Rule-based)       → Ánh xạ lỗi thành đề xuất: "Tặng voucher Freeship"
       ↓
(Lưu cả 2 thông tin trên vào Qdrant)
       ↓
                                          Model B (Chatbot RAG) ← Đọc Qdrant
                                                 ↓
                                          Diễn giải: "Chào Admin, hệ thống báo Sản phẩm X đang kẹt ở giỏ hàng. Đề xuất từ hệ chuyên gia là Tặng voucher Freeship."
                                                 ↓
Admin duyệt và áp dụng hành động (applied_at)
       ↓
Evaluation Engine (Thống kê Before-After) → Đánh giá hiệu quả voucher → Lưu kết quả Qdrant
```

Kiến trúc 4 thành phần này là minh chứng xuất sắc cho tư duy thiết kế hệ thống (System Design): 
1. Không nhồi nhét mọi thứ vào 1 model ML (tránh làm quá tải tiến độ). 
2. Không nhồi nhét mọi thứ vào LLM (tránh ảo giác và tốn tài nguyên). 
3. Phân tách rõ ràng giữa thuật toán chẩn đoán (ML), logic nghiệp vụ (Rule-based), giao diện ngôn ngữ tự nhiên (LLM), và đo lường khoa học (Stats).

### E. Chốt hướng bài báo khoa học — khung còn 1 tháng (2026-07-13, cập nhật 2026-08-03)

Sau khi so sánh 2 hướng:
- (1) **Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho SDK và Adapter trong ingestion thời gian thực bằng idempotency + retry có kiểm soát + batching giới hạn**
- (2) **Online Funnel Bottleneck Detection bằng mô hình nhẹ thay rule-based**

Đã **chốt chọn hướng (1)** làm bài báo chính trong 1 tháng còn lại: "Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho hệ thống thu thập thời gian thực thông qua tính lũy đẳng (Idempotency), Batching và Retry có kiểm soát". Phát triển song song với đồ án theo tỷ lệ effort 70/30 hoặc 80/20 nghiêng về bài báo trong tháng đầu.

Lý do chốt:
- Phù hợp thời hạn 1 tháng hơn hướng ML: không phụ thuộc nhiều vào bài toán gán nhãn dữ liệu và vòng lặp tuning model.
- Dễ tạo thực nghiệm tái lập: fault injection theo kịch bản (network timeout, broker chậm, restart adapter, burst traffic).
- Dễ phản biện bằng chỉ số kỹ thuật rõ ràng, ít tranh luận chủ quan hơn hướng ML.

Chỉ số đánh giá chính cho bài báo:
- `event_loss_rate`
- `duplicate_rate`
- `integrity_violation_rate` (missing/duplicate/invalid)
- `p95_end_to_end_latency`
- `throughput_events_per_second`

Phạm vi thực hiện trong bài báo:
- SDK: event envelope + batching giới hạn + retry có kiểm soát.
- Adapter/ingest: kiểm tra toàn vẹn + idempotency + phân loại lỗi retryable/non-retryable.
- So sánh với baseline ingestion hiện tại để lượng hoá lợi ích.

Ghi chú báo cáo/pha phản biện:
- Hướng (2) được phát triển song song cho đồ án nhưng không là trọng tâm bài báo 1 tháng.

### F. Cập nhật thiết kế và Phản biện kiến trúc (2026-07-13)

**1. Sửa đổi tên bài báo khoa học:**
- Tên cũ (có dấu "+", thiếu tính học thuật): "Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho SDK và Adapter trong ingestion thời gian thực bằng idempotency + retry có kiểm soát + batching giới hạn".
- **Tên mới đề xuất (chuẩn học thuật):** *"Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho hệ thống thu thập thời gian thực thông qua tính lũy đẳng (Idempotency), Batching và Retry có kiểm soát"*. Việc bỏ dấu "+" và dùng các từ nối chuẩn giúp tiêu đề chuyên nghiệp và mang tính hàn lâm hơn.

**2. Phạm vi bảo vệ dữ liệu của bài báo:**
Bài báo đảm bảo toàn vẹn dữ liệu cho cả **Behavior Event** (từ SDK) và đặc biệt là **Business Event** (Commerce). Việc đếm sai (mất mát hoặc nhân bản) các Business Event (`add_to_cart`, `order_completed`) sẽ làm sai lệch nghiêm trọng tính toán KPI của hệ thống. Do đó, cơ chế Idempotency ở Adapter là tấm khiên bắt buộc để chống việc nhận đúp đơn hàng từ luồng Backend (ví dụ khi thỏ trắng RabbitMQ gửi lại tin nhắn do rớt mạng).

**3. Phản biện kiến trúc: "Tại sao không dùng CDC cho Business Data thay vì thiết kế Message Queue?"**
CDC (như Debezium) đọc trực tiếp từ WAL log nên không gây khóa bảng. Tuy nhiên, dưới góc độ thiết kế Phần mềm Tracking (Application-level), hệ thống kiên quyết dùng Message Queue (Event-Driven) vì các rào cản thực tế của CDC:
- **Rào cản Cấp quyền (Replication Privileges):** CDC đòi hỏi quyền truy cập sâu (SUPERUSER/Replication) vào log CSDL của khách hàng. Việc cấp quyền này cho một Tool bên thứ 3 là rủi ro bảo mật khổng lồ (Compliance Risk). MQ an toàn hơn vì khách hàng chủ động đẩy (Push) dữ liệu ra.
- **Bài toán Rác logic (Database State vs Business Event):** CDC theo dõi 'Trạng thái dữ liệu' (Row-level changes). Một thao tác "Thanh toán" có thể sinh ra 8 thay đổi rời rạc trên 4 bảng khác nhau (Orders, Items, Users, Inventory). Nếu dùng CDC, hệ thống Tracking phải hứng 8 mảnh vỡ này và viết thuật toán Join phức tạp để "dịch ngược" thành 1 sự kiện. Thiết kế MQ đẩy trách nhiệm gom data cho Backend Web-shop: khi giao dịch xong, Web-shop chỉ bắn ra 1 cục JSON duy nhất (`{"event": "order_completed"}`). Ranh giới hệ thống (Bounded Contexts) được bảo vệ.
- **Khớp nối cấu trúc (Tightly Coupled):** CDC bị gãy vỡ nếu khách hàng đổi tên cột/bảng. MQ sử dụng "Hợp đồng dữ liệu" (Data Contract JSON cố định), giúp Tracking là công cụ Plug & Play độc lập hoàn toàn với Schema của khách hàng.
- **Kết luận:** Sự đánh đổi của kiến trúc MQ là rủi ro rớt/trùng tin nhắn. Module Idempotency, Batching và Retry có mục tiêu giảm và đo lường các rủi ro đó trong ranh giới ingestion. Không claim “khắc phục hoàn toàn” hoặc “ngang CDC” trước khi có thực nghiệm; dual-write gap từ OLTP commit đến publish vẫn là giới hạn nếu chưa có Transactional Outbox.

### G. Nhật ký trao đổi Cập nhật AI & Dữ liệu (2026-07-14)

**1. Phương pháp gán nhãn cho Mô hình Học máy (Model A):**
Các dataset thô (như Retailrocket) không có sẵn nhãn điểm nghẽn (bottleneck). Giải pháp là dùng **Weak Supervision (Giám sát yếu) / Heuristic Labeling**:
- Gom nhóm raw events theo Session/Window thành các Features (lượt view, lượt add_to_cart, giá...).
- Dùng các luật Rule-based hiện có để gán nhãn tự động trên tập dữ liệu lịch sử (VD: `views >= 10` & `add_to_cart == 0` -> Nhãn: Rớt phễu do xem).
- Huấn luyện mô hình phân loại (Classification như XGBoost) trên tập dữ liệu đã gán nhãn để mô hình tự học các đặc trưng phi tuyến tính phức tạp thay thế cho bộ luật if/else cứng nhắc. Tùy chọn nâng cao là dùng Unsupervised Learning (Anomaly Detection).

**2. Chiến lược thu thập dữ liệu ngữ nghĩa (Metadata):**
Tuân thủ tuyệt đối nguyên tắc Phi xâm lấn: **Không kết nối Database khách hàng để lấy thông tin sản phẩm.**
- **Thu thập qua SDK:** Khách hàng (Web-shop) nhúng dữ liệu vào giao diện (thông qua `data-* attributes` hoặc `window.dataLayer`). SDK lấy dữ liệu này đóng gói thành `metadata` gửi về Tracking API.
- **Xử lý nội dung mô tả dài:** KHÔNG thu thập nội dung text dài (mô tả sản phẩm) qua event stream để tránh phình to payload, tốn băng thông Kafka và làm nhiễu mô hình phân tích dạng bảng. Thay vào đó, thu thập hành vi tương tác với mô tả (thời gian xem, cuộn chuột). Nếu Chatbot cần đọc mô tả, nó sẽ quét (scrape) trực tiếp URL công khai hoặc đồng bộ qua Product Feed API định kỳ.

**3. Phản biện về Băng thông mạng của kiến trúc Self-hosted:**
Dữ liệu đổ dồn về hạ tầng của khách hàng không phải là nhược điểm chí mạng khi so với việc dùng SaaS:
- Băng thông Ingress (đầu vào) của Cloud/VPS thường là miễn phí. Payload là dạng text JSON siêu nhẹ.
- **Cơ chế Batching của SDK (từ bài báo NCKH)** giúp gộp các event lại, giảm 80-90% số lượng request mạng (TCP overhead).
- Đánh đổi lại, khách hàng có chi phí phần cứng cố định (thay vì giá SaaS tăng theo cấp số nhân của Event volume) và quan trọng nhất là bảo vệ được **100% Data Ownership** (Sở hữu dữ liệu lõi).

### H. Nhật ký trao đổi Chiến lược Huấn luyện Mô hình AI (2026-07-15)

Việc giải quyết trọn vẹn 2 tác vụ: **(1) Phát hiện điểm nghẽn** và **(2) Đề xuất hành động** cần được cân nhắc kỹ lưỡng về khối lượng công việc và kiến trúc. Dưới đây là 2 phương án đã được đưa lên bàn cân:

**Phương án 1: Train 2 Model Học máy chuyên biệt (Lý tưởng nhưng khối lượng công việc khổng lồ)**
- **Model A1 (Bottleneck Detector):** Dùng dataset **REES46 Multi-category** (dữ liệu Clickstream) để train mô hình phân loại rớt phễu (VD: XGBoost). Đầu ra là nhãn điểm nghẽn.
- **Model A2 (Action Recommender):** Lấy kết quả điểm nghẽn từ Model A1, kết hợp với dataset `Olist Marketing Funnel` để train một mô hình thứ hai chuyên gợi ý hành động kinh doanh (tặng voucher, freeship...).
- **Đánh giá:** Kiến trúc rất đẹp và tách bạch rõ ràng (Separation of Concerns), giải quyết được bài toán thiếu data nếu gộp vào 1 model end-to-end. Tuy nhiên, khối lượng công việc (Data cleaning, Feature Engineering, Labeling, Training) sẽ **tăng lên gấp đôi**, tạo ra rủi ro cực lớn làm chậm tiến độ 5 tháng của đồ án.

**Phương án 2: Chiến lược Lai - Train 1 Model + Rule-based (Phương án tối ưu tiến độ - KHUYÊN DÙNG)**
Để vẫn đảm bảo yếu tố "bằng học máy" của đề tài mà không làm quá tải công việc, ta sẽ phân bổ nguồn lực theo hướng "chọn việc mà làm":
- **Khâu Phát hiện (Chốt chặn 1 - Bắt buộc dùng ML):** Dồn toàn bộ nỗ lực Học máy (ML) để train duy nhất **Model A1** (XGBoost với REES46). Việc này giúp tập trung thời gian để chăm chút kỹ phần tinh chỉnh mô hình và biểu đồ đánh giá (Precision/Recall) cho báo cáo.
- **Khâu Đề xuất (Chốt chặn 2 - Giao quyền cho hệ thống khác):** KHÔNG train thêm model ML (A2) truyền thống. Thay vào đó, áp dụng cơ chế:
  - **Ma trận Rule-based tĩnh:** Ánh xạ thẳng lỗi từ Model A1 sang hành động cố định thông qua file config (VD: Báo lỗi bỏ giỏ hàng -> Đề xuất mã freeship).
  - **Diễn giải bằng Model B (Chatbot RAG):** Model B đọc cấu hình đề xuất này từ Qdrant, sau đó đóng vai trò "Lớp trình bày" để thông báo cho Admin một cách tự nhiên. **Tuyệt đối không nhúng Web Search Tool hay chức năng Agentic phức tạp** để giữ an toàn cho kiến trúc ban đầu.
- **Đánh giá:** Đây là chiến lược cực kỳ thông minh. Nó vừa đáp ứng trọn vẹn hàm lượng học thuật cốt lõi (có model XGBoost được train bài bản), vừa giữ nguyên được cấu trúc 3 thành phần hệ thống ban đầu, đảm bảo tuyệt đối tiến độ đồ án mà không bị lan man sang các mảng Agent phức tạp.

### I. Nhật ký trao đổi về Cơ chế thu thập và Định dạng Dữ liệu (2026-07-15)

**1. Cơ chế Ingestion (Quét/Lấy dữ liệu):**
Hệ thống hoàn toàn tuân thủ nguyên tắc **Phi xâm lấn (Non-invasive)** — tuyệt đối không chủ động quét (crawl) hay truy cập trực tiếp vào Database của khách hàng. Thay vào đó, dữ liệu được thu thập thụ động qua 2 luồng:
- **Client-side (Behavior Events):** Browser SDK gắn trên Web-shop bắt các tương tác (click, view, scroll) và đẩy (Push) về Tracking API qua HTTP.
- **Server-side (Business Events):** Adapter lắng nghe (Subscribe) từ hệ thống Message Queue (như RabbitMQ) của khách hàng để bắt các sự kiện nghiệp vụ quan trọng nhằm tránh sai lệch luồng thanh toán.

**2. Các định dạng dữ liệu được xử lý:**
Hệ thống xử lý mượt mà luồng chuyển đổi dữ liệu qua các pipeline:
- **Dữ liệu Bán cấu trúc (Semi-structured - Chủ đạo):** Định dạng **JSON** linh hoạt luân chuyển từ SDK -> Tracking API -> Kafka. JSON cho phép các event giữ nguyên cấu trúc lõi (`session_id`, `timestamp`) trong khi phần `properties` có thể co giãn tự do theo từng loại tương tác.
- **Dữ liệu Có cấu trúc (Structured - Cho ML):** Streaming Processor (Python) tiêu thụ JSON, làm sạch và gom nhóm (Window Aggregation) thành dữ liệu dạng Bảng (Tabular/Vector số liệu). Đây là đầu vào chuẩn mực cho Model A1 (XGBoost) và để lưu trữ dài hạn trong PostgreSQL.
- **Dữ liệu Phi cấu trúc (Unstructured - Bị hạn chế):** Hệ thống lõi Real-time **TỪ CHỐI** đọc và lưu trữ các đoạn text dài (ví dụ: mô tả sản phẩm, review) để tránh phình to băng thông Kafka. Ngoại lệ duy nhất là các câu văn bản "Insight/Đề xuất" sinh ra từ Model A1 và A2, được chuyển thành vector lưu vào **Qdrant** phục vụ riêng cho Chatbot Model B (RAG) đọc hiểu.

### J. Đề xuất Hướng Bài báo Khoa học thứ 2 — Trọng tâm AI/Model A1 (2026-07-16)

Nếu đồ án còn quỹ thời gian và cần tăng cường hàm lượng học thuật hàn lâm (Academic Rigor) về mảng Học máy (Machine Learning) để gây ấn tượng mạnh với hội đồng, định hướng xuất bản thêm một bài báo thứ 2 là hoàn toàn khả thi.

**Tên bài báo đề xuất:**
> *"Phát hiện Bất thường trong Phễu chuyển đổi Thương mại Điện tử thông qua Mô hình Học kết hợp (Ensemble Learning) trên Dòng dữ liệu Clickstream thời gian thực dựa trên Phương pháp Giám sát yếu"*

**1. Vấn đề nghiên cứu (Pain Point):**
Dữ liệu hành vi người dùng (Clickstream) như tập REES46 tuy có khối lượng khổng lồ nhưng lại ở dạng **không có nhãn (unlabeled)**. Việc gán nhãn thủ công để xác định đâu là "điểm nghẽn/bất thường" là bất khả thi, dẫn đến khó khăn trong việc huấn luyện các mô hình Học có giám sát (Supervised Learning) truyền thống.

**2. Giải pháp và Hàm lượng Khoa học (Scientific Contribution):**
Bài báo sẽ giải quyết triệt để vấn đề trên bằng 2 phương pháp tiên tiến:
- **Học giám sát yếu (Weak Supervision):** Sử dụng các luật Heuristic (Rule-based) để tự động hóa quá trình gán nhãn (Auto-labeling) cho hàng triệu dòng sự kiện thô. (Ví dụ: Số lần xem > 10 nhưng Add to cart = 0 sẽ được gán nhãn là 'Rớt phễu do xem').
- **Học kết hợp (Ensemble Learning):** Sử dụng tập dữ liệu vừa được gán nhãn yếu để huấn luyện mô hình **XGBoost (Model A1)**. Mô hình này sẽ học các đặc trưng phi tuyến tính phức tạp (Pattern Recognition) để vượt qua giới hạn cứng nhắc của bộ luật Heuristic ban đầu.

**3. Chỉ số Đánh giá (Metrics):**
Bài báo sẽ tập trung chứng minh tính hiệu quả qua các biểu đồ và chỉ số định lượng:
- **Độ chính xác (Accuracy Metrics):** So sánh F1-Score, Precision, Recall giữa mô hình XGBoost và Baseline (Chỉ dùng Rule-based thuần túy).
- **Hiệu năng hệ thống (System Performance):** Đo lường độ trễ dự đoán (Inference Latency) khi mô hình xử lý chuỗi dữ liệu (Tumbling Window) trong môi trường Real-time trên kiến trúc Streaming.

Hướng nghiên cứu này bám sát tuyệt đối vào module Model A1 của kiến trúc hệ thống, biến một bài toán Kỹ thuật dữ liệu (Data Engineering) thành một công trình khoa học Trí tuệ nhân tạo (AI) bài bản.

### K. Khảo sát Dataset phục vụ Huấn luyện Model A1 (2026-07-17)

Để huấn luyện mô hình XGBoost (Model A1) cho bài toán Phát hiện Bất thường Phễu, hệ thống cần các tập dữ liệu Clickstream có chứa đầy đủ các loại hành vi (view, cart, purchase). Dưới đây là bảng xếp hạng ưu tiên sau khảo sát trên Kaggle và Hugging Face:

| Hạng | Dataset | Nguồn | Kích thước | Cột chính | Ưu/Nhược |
|---|---|---|---|---|---|
| 🥇 | **REES46 Multi-category Store** | [Kaggle](https://kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store) + [HuggingFace](https://huggingface.co/datasets/kevykibbz/ecommerce-behavior-data-from-multi-category-store_oct-nov_2019) | ~285M events | `event_time`, `event_type` (view/cart/remove_from_cart/purchase), `product_id`, `category_code`, `brand`, `price`, `user_session` | Có `price`, `brand`, `remove_from_cart` sẵn. Load 1 dòng trên HF. Rất lớn (~9GB), cần lọc subset. |
| 🥈 | **Retailrocket** | [Kaggle](https://kaggle.com/datasets/retailrocket/ecommerce-dataset) | ~2.7M events | `timestamp`, `visitorid`, `event` (view/addtocart/transaction), `itemid` | Kinh điển, được trích dẫn nhiều trong bài báo. Giá trị bị hash, không có `price` trực tiếp. |
| 🥉 | **REES46 Cosmetics Shop** | [Kaggle](https://kaggle.com/datasets/mkechinov/ecommerce-events-history-in-cosmetics-shop) | ~20M events | Giống Multi-category | Bản nhẹ để prototype nhanh. Chỉ 1 ngành. |
| 4 | **Taobao (PI2I)** | [HuggingFace](https://huggingface.co/datasets/PI2I/PI2I) | ~130M interactions | `user_id`, `item_id`, `category_id`, `behavior_type` (click/cart/fav/buy) | Cross-validate trên domain Trung Quốc. Có event `fav`. Không có `price`. |
| 5 | **YOOCHOOSE (RecSys 2015)** | `pip install rs_datasets` | ~33M clicks + ~1M buys | `session_id`, `timestamp`, `item_id`, `category`, `price` (buys) | Benchmark học thuật. Không có `add_to_cart`. |
| 6 | **Online Shoppers UCI** | [UCI ML Repository](https://archive.ics.uci.edu/dataset/468) | ~12K sessions | `BounceRates`, `ExitRates`, `PageValues`, `Revenue` (Yes/No) | Có sẵn nhãn → dùng làm Baseline so sánh. Quá nhỏ cho train chính. |
| 7 | **Bitext Retail Chatbot** | [HuggingFace](https://huggingface.co/datasets/bitext/Bitext-retail-ecommerce-llm-chatbot-training-dataset) | ~27K mẫu Q&A | `instruction`, `category`, `intent`, `response` | Cho Model B (Chatbot). Dùng làm test set đánh giá chất lượng diễn giải. |

**Đề xuất nội bộ, chưa được giảng viên chốt:** REES46 có lợi thế `price`, `brand`, `remove_from_cart`, `user_session`; Retailrocket nhẹ hơn và phù hợp prototype. Quyết định cuối dựa trên mức độ khớp với Universal Input Schema, feature có thể thu được ở runtime và chi phí xử lý trong quỹ thời gian còn lại.

### L. Quy trình biến Dataset thô thành Dữ liệu Huấn luyện (2026-07-17)

**Bước 1 — Sessionization (Gom nhóm theo phiên):**
Gom raw events rời rạc thành bản ghi tổng hợp: `GROUP BY session_id, product_id`. Kết quả: mỗi dòng mô tả toàn bộ hành trình của 1 user với 1 sản phẩm trong 1 phiên.

**Bước 2 — Feature Engineering (Trích xuất đặc trưng - Tạo biến X):**
Từ bản ghi tổng hợp, tính toán các cột số liệu: `view_count`, `cart_count`, `remove_count`, `total_time_spent`, `price_category_ratio` (giá sản phẩm / giá trung bình danh mục).

**Bước 3 — Weak Supervision (Tự động gán nhãn - Tạo biến Y):**
Áp dụng bộ luật Heuristic có nguồn trích dẫn học thuật (xem Mục M) để gán nhãn cho từng bản ghi.

**Bước 4 — Huấn luyện XGBoost (Model A1):**
Xóa cột định danh (`session_id`, `product_id`). Chia Train/Test (80/20). Đưa ma trận X và vector Y vào XGBoost Classifier. Đánh giá bằng F1-Score, Precision, Recall so với Baseline Rule-based.

**Bước 5 — Model Serving (Deploy vào Pipeline):**
Sau khi train và đánh giá hoàn tất, model được xuất thành file ổn định để chạy trong Streaming Pipeline:
1. Train offline (Jupyter/Script) → `joblib.dump(model, 'model_a1.joblib')`.
2. Streaming Processor load model 1 lần khi khởi động: `model = joblib.load('model_a1.joblib')`.
3. Mỗi khi Window Aggregation hoàn tất (mỗi 1 phút), gọi `model.predict_proba(features)` → sinh insight với xác suất.
4. Retrain: Chạy lại script với dữ liệu mới → thay file `.joblib` → restart Pod.

Đây là mô hình **Batch Training + Online Inference** — đơn giản, ổn định, phù hợp quy mô đồ án. Online Learning (model tự cập nhật liên tục) đưa vào "Hướng phát triển".

### M. Thiết kế Luật gán nhãn có Cơ sở Học thuật (Heuristic Rules with Citations) (2026-07-17)

Mọi tiêu chí gán nhãn (Weak Supervision) đều PHẢI được neo (anchor) vào các nghiên cứu uy tín trong ngành. Không được tùy tiện nhìn dataset rồi quy định.

**Bảng Ma trận Gán nhãn:**

| Điều kiện từ Dataset | Nhãn | Trạng thái (Class) | Nguồn tham chiếu |
|---|---|---|---|
| `purchase > 0` | 0 | Chuyển đổi thành công | Ngầm định |
| `view_count <= 2` AND `cart == 0` | 0 | Không có ý định (Bounce) | Google Analytics Benchmarks — Định nghĩa Bounce Rate |
| `cart > 0` AND `remove_from_cart > 0` AND `purchase == 0` | 1 | Nghẽn chi phí (Price Shock) | **Baymard Institute (2024):** Tỷ lệ bỏ giỏ hàng trung bình toàn cầu = 70.19%. Nguyên nhân #1 (48%): Chi phí phát sinh quá cao (phí ship, thuế). Nguyên nhân #3 (25%): Không tin tưởng trang web. |
| `view_count > Q3(view)` AND `cart == 0` | 2 | Lưỡng lự thông tin (Consideration) | **Mô hình ZMOT (Google)** + **Mô hình AIDA**: Khách hàng lặp lại hành vi xem vượt ngưỡng trung bình (Q3 Quartile) nhưng không phát sinh Cart = tín hiệu thiếu thông tin so sánh hoặc rào cản niềm tin (Trust Barrier). |

*Ghi chú: Q3(view) được tính trực tiếp từ dataset (Statistical Thresholding), không phải con số cố định.*

**Hành động tương ứng của Model A2 (Rule-based):**
- Nhãn 1 (Price Shock) → Tặng Voucher Freeship / Discount 10%.
- Nhãn 2 (Consideration) → Popup tư vấn / Hiển thị bảng so sánh tính năng.

### N. Biện luận: Tại sao cần Học máy khi đã có Rule-based (2026-07-18)

Đây là câu hỏi phản biện chắc chắn hội đồng sẽ hỏi. Lập luận bảo vệ gồm 3 điểm:

**1. Rule-based bị "Mù ngữ cảnh" (Context Blindness):**
Rule chỉ dùng 2-3 chiều dữ liệu (view_count, cart_count). Trong khi dataset có hàng chục chiều khác (price, brand, category, dwell_time). XGBoost tự động phát hiện các mối liên hệ ẩn (Hidden Patterns) giữa TẤT CẢ các chiều mà con người không thể viết IF/THEN bao quát hết.

**2. Khả năng Khái quát hóa (Generalization):**
Rule quy định cứng `view >= 5` mới là Nghẽn. XGBoost nhận ra: với Điện thoại đắt tiền, chỉ cần `view = 3` + `dwell_time > 2 phút` thì xác suất rớt phễu đã lên 90%. Với Mỹ phẩm giá rẻ, phải `view = 8` mới đáng lo. XGBoost "bẻ cong" ngưỡng cứng thành ranh giới phân loại uyển chuyển cho từng ngữ cảnh.

**3. Đầu ra Xác suất (Probabilistic Output) thay vì Nhị phân (Binary):**
Rule trả về Có/Không. XGBoost trả về xác suất (VD: 72% khả năng rớt phễu). Nhờ đó hệ thống tối ưu chi phí Marketing: Xác suất > 80% → Voucher 50K (tốn kém), 60-80% → Freeship 15K. Rule-based hoàn toàn bất lực với bài toán tối ưu chi phí này.

**Kết luận để chốt với hội đồng:**
> "Rule-based chỉ đóng vai trò Người mồi lửa (Bootstrapper) tạo nhãn thô. Mô hình Học máy (XGBoost) đóng vai trò Người tối ưu (Optimizer), học biểu diễn phi tuyến tính phức tạp từ hàng chục chiều dữ liệu mà bộ luật tĩnh không thể bao quát nổi."

### O. Consistency Dữ liệu Behavior — Phân tích, Giải pháp và Phản biện (2026-07-18 → 2026-07-20)

#### O.1. Bài toán gốc: Tại sao Behavior Data không thể Consistency 100%?

Khác với Business Data (chạy server-to-server qua MQ, có confirm hai chiều), Behavior Data được bắt ở **phía trình duyệt (Client-side)**. Giữa SDK và server có "Mạng Internet công cộng", nơi xảy ra:

| Nguyên nhân mất dữ liệu | SDK có biết không? | Khắc phục được? |
|---|---|---|
| User đóng tab trước khi batch event kịp gửi | Không | Beacon API |
| Ad-blocker chặn request tới Tracking API | Không | Không thể (blind spot cố hữu) |
| Mất mạng giữa chừng | Có (nếu có retry) | LocalStorage Buffer |
| User tắt JavaScript | SDK không chạy → Mù hoàn toàn | Không thể |
| Bot/Crawler giả lập hành vi (Dữ liệu thừa) | Không | Bot detection |

**Kết luận kiến trúc:** Không tồn tại khái niệm Consistency 100% cho Client-side Tracking. Ngay cả Google Analytics hay Amplitude cũng chấp nhận tỷ lệ hụt 5-15%. Hệ thống phân định rạch ròi:
- **Business Data (Đơn hàng):** yêu cầu độ tin cậy cao; source publisher confirm bảo vệ bước giao vào MQ, còn durable ingestion receipt/Kafka ACK là điểm bắt đầu claim của Tracking. Không mặc định 100% từ OLTP commit nếu chưa có Transactional Outbox.
- **Behavior Data (Hành vi):** Bản chất là dữ liệu Thống kê (Statistical), mục tiêu là **đo lường được sai số** và duy trì Coverage Rate trên 90%.

#### O.2. Kỹ thuật giảm thiểu mất mát tại nguồn (SDK-level Mitigations)

**Beacon API (Chống mất khi đóng tab):**
Khi user đóng tab/chuyển trang, `navigator.sendBeacon()` cho phép trình duyệt xếp request gửi nền ở chế độ best-effort, giúp giảm mất event trên SSR. Beacon không phải cam kết server đã nhận; vẫn cần telemetry và đối soát.

**LocalStorage Buffer (Chống mất khi mất mạng):**
Nếu `fetch()` tới Tracking API thất bại → SDK lưu event vào `localStorage` → Lần truy cập sau, SDK đọc queue và gửi lại (Retry from buffer).

**SDK Heartbeat (Đo hoạt động sau khi SDK đã load):**
SDK gửi tín hiệu "ping" định kỳ để đo session đã khởi tạo SDK còn hoạt động. Heartbeat không đo được session bị ad-blocker chặn ngay từ đầu vì server không biết mẫu số đó tồn tại; không dùng riêng heartbeat để tuyên bố coverage toàn bộ traffic.

#### O.3. Phân tích sâu: SSR vs CSR/SPA — Hai bài toán Consistency ngược nhau

**SSR (Server-Side Rendering — PHP, Django, Rails, Next.js SSR):**
- Mỗi lần chuyển trang = full HTTP request → **Server biết mọi pageview** (access log đầy đủ).
- Nhưng SDK bị "chết đi sống lại" liên tục → Dễ mất event buffer khi chuyển trang.
- Giải pháp: Beacon API + Server render `<meta name="x-request-id">` để đối chiếu.
- Consistency: **Dễ đo** (có server log làm ground truth) nhưng **dễ mất event**.

**CSR / SPA (Client-Side Rendering — React, Vue, Angular):**
- Chỉ 1 HTTP request ban đầu, sau đó mọi chuyển trang là client-side routing.
- **Server mù hoàn toàn** về các lần chuyển trang sau (access log chỉ ghi 1 request).
- Nhưng SDK sống suốt session, không bị hủy → Bắt event đầy đủ hơn SSR.
- SDK hook vào Router events (`history.pushState`, `popstate`) để phát sinh `page_view`.
- Consistency: **Khó đo** (không có server-side ground truth) nhưng **ít mất event**.

**SPA có thể giảm mất event khi navigation, nhưng agreement không đồng nghĩa accuracy:**
Nếu khách hàng cũng ghi nhận behavior data, SDK của họ cũng chạy client-side, cũng bị ảnh hưởng bởi cùng yếu tố mất mát:
- Ad-blocker chặn → chặn CẢ SDK của hệ thống lẫn SDK của khách hàng.
- JS tắt → CẢ HAI SDK đều không chạy.
- Mất mạng → CẢ HAI đều mất event cùng lúc.

Hai SDK client-side có thể cùng chịu một số blind spot, nhưng không được suy ra chúng luôn mất cùng một tập event: filter list, first/third-party endpoint, consent, thời điểm init và retry strategy có thể khác nhau. Agreement cao giữa hai SDK không chứng minh coverage cao so với hành vi thực tế.

| Tiêu chí | SSR | CSR / SPA |
|---|---|---|
| SDK tồn tại | Bị hủy mỗi lần chuyển trang | Sống suốt session |
| Rủi ro mất event | **Cao** (page unload) | **Thấp** |
| Server biết pageview? | **Có** (access log đầy đủ) | **Không** (chỉ biết lần load đầu) |
| Có source of truth server-side? | **Có** → Dễ đối chiếu | **Không** |
| Đối chiếu hai SDK | Có access log làm mốc page request | Chỉ đo agreement; cần ground truth bổ sung |
| Kỹ thuật Correlation ID | Server render `<meta name="x-request-id">` | SDK tự sinh `page_view_id` |

#### O.4. Định nghĩa lại "Phi xâm lấn" — Ranh giới thật sự (2026-07-18)

Câu hỏi cốt lõi: Giữa "phi xâm lấn code" và "phi xâm lấn DB", cái nào đánh đổi được?

**Trả lời: Phi xâm lấn CODE là cái đánh đổi được.** Hệ thống đã đang đánh đổi nó rồi:
- Gắn `<script src="sdk.js">` vào HTML → Xâm lấn code ✅ (đang làm)
- Cài MQ publisher để bắn business events → Xâm lấn code ✅ (đang làm)
- Truy cập DB đọc bảng khách hàng → ❌ Tuyệt đối không
- CDC đọc WAL log → ❌ Tuyệt đối không

**Ranh giới thật sự:**
- **Được phép:** Khách hàng **THÊM** (add) thành phần mới (script, middleware, MQ publisher). Chỉ đọc luồng dữ liệu đi qua, chỉ đẩy ra (push), không sửa logic nghiệp vụ, gỡ ra bất kỳ lúc nào.
- **Không được phép:** Hệ thống Tracking **THÒ TAY VÀO** (pull) tài nguyên nội bộ (database, file system, internal API). Đòi credentials, lộ PII, gắn chặt vào schema.

**Tóm gọn:** *"Phi xâm lấn = Phi xâm lấn dữ liệu (DB), không phải phi xâm lấn tích hợp (Code). Giống cài ổ cắm điện trên tường, không phải đục tường kéo dây."*

#### O.5. Cơ chế tích hợp Kép và Chuẩn hóa đầu vào (2026-07-20)

**Dual-Integration Strategy — Tùy tình huống khách hàng:**

| Tình huống | Phương thức | Xâm lấn Frontend |
|---|---|---|
| **ĐÃ CÓ tracking** (GA4, Segment, Mixpanel) | **Data Connector (Webhook Ingestion):** Cấu hình GTM/Segment forward bản copy event sang `POST /api/ingest/webhook`. | **0%** — Không viết thêm 1 dòng JS. |
| **CHƯA CÓ tracking** | **Drop-in SDK:** 1 dòng `<script src="sdk.js">`. SDK tự bắt pageview (`history.pushState`) và click (`data-track` attributes). Tên thay thế: **"Low-code Tracking SDK"** hoặc **"Declarative Tracking SDK"** (vì interaction events cần khai báo `data-track`, không phải auto thuần túy). | **Cực thấp** — 1 dòng script. |

**Anti-Corruption Layer (ACL) — Chuẩn hóa đa nguồn:**
Khi nhận dữ liệu từ nhiều nền tảng, hệ thống triển khai Adapter Pattern:
- Mỗi nguồn có endpoint riêng: `/api/ingest/segment`, `/api/ingest/ga4`, `/api/ingest/custom`.
- Mỗi Adapter "dịch" JSON đặc thù sang **Universal Schema** chuẩn nội bộ (`event_id`, `session_id`, `event_type`, `timestamp`, `properties`).
- Dữ liệu qua Validator trước khi vào Kafka. Dữ liệu lỗi bị ném vào **Dead Letter Queue (DLQ)**.
- Pipeline lõi (Streaming + ML) chỉ tiêu thụ duy nhất Universal Schema → Thêm nền tảng mới chỉ cần viết 1 Adapter, không đụng ML.

#### O.6. Phản biện: "Self-hosted thì tại sao không đọc DB luôn?" (2026-07-20)

Dù hệ thống Tracking cài trên cùng cụm server/Kubernetes với Web-shop, vẫn PHẢI tách biệt vì:
- **Bounded Context (DDD):** Kể cả các team cùng công ty cũng không dùng chung DB. Web-shop đổi schema → Tracking sập.
- **Productization:** Hệ thống là sản phẩm Plug & Play, không phải code thuê cho 1 web cụ thể. Nếu chọc DB web A, mang sang web B phải viết lại.
- **Least Privilege:** Tracking phục vụ Marketing/Data, không cần và không được phép truy cập bảng chứa mật khẩu/thẻ tín dụng/PII.

#### O.7. Đo lường sai số — Phương pháp Đối chiếu chéo nội bộ (2026-07-20)

Khi khách hàng **không có hệ thống tracking nào khác** (trường hợp khắc nghiệt nhất), hệ thống vẫn tự đo được sai số bằng cách dùng **luồng Business Data (MQ) làm mỏ neo**:

**Phương pháp Cross-Validation MQ ↔ SDK:**
1. Rút 1.000 `session_id` có `order_completed` từ luồng MQ (tin cậy 100%).
2. Quét trong DB Behavior (SDK): Tìm thấy 930 sessions có sự kiện `page_view`, `add_to_cart`.
3. 70 sessions còn lại phải phân loại tiếp: thiếu correlation, session hết hạn, non-browser order, event đến trễ hoặc probable capture loss; không mặc định tất cả do ad-blocker.
4. **Công bố:** `purchase_behavior_link_rate = 93%`. Đây là coverage của nhóm đã mua hàng, không đại diện toàn bộ behavior traffic.

**Bổ sung SDK Telemetry (Tự đo nội bộ):**

| Chỉ số | Cách đo | Ý nghĩa |
|---|---|---|
| **Send Success Rate** | `events_acked_200 / events_attempted` | Tỷ lệ gửi thành công (mạng ổn định) |
| **Beacon Fallback Rate** | `events_sent_via_beacon / total_events` | Tỷ lệ event phải dùng beacon (user đóng tab) |
| **Buffer Overflow Rate** | `events_dropped_from_localstorage / total_events` | Tỷ lệ event bị mất do buffer đầy |

**Hạn chế:** Telemetry không đo được ad-blocker (SDK không load → `events_attempted = 0`). Chỉ phép đối chiếu MQ mới bắt được blind spot này.

**Bản đồ Consistency toàn hệ thống:**

| Loại dữ liệu | Cơ chế thu thập | Consistency | Lý do |
|---|---|---|---|
| **Business Data sau durable ingestion receipt** | MQ Adapter + Tracking receipt/Kafka ACK | At-least-once từ durable handoff | Không bao gồm dual-write gap từ OLTP commit đến source handoff |
| **Behavior: Pageview** *(ý tưởng, chưa triển khai)* | Server-side Middleware *(Hướng phát triển)* | ~100% | Không đi qua browser — chưa nằm trong scope, chỉ là ý tưởng |
| **Behavior: Interaction** (click, scroll) | Browser SDK (client-side) | ~93-95% | Phụ thuộc browser, đo sai số qua MQ cross-validation |

**Câu chốt trước hội đồng:**
> "Hệ thống không cố gắng giải bài toán bất khả thi là chống Ad-blocker. Hệ thống bảo vệ business event bằng stable ID, retry và idempotency sau durable ingestion receipt; dùng reconciliation để đo phần sai lệch trước handoff, đối chiếu business↔SDK để đo coverage của journey liên kết được và công bố riêng các blind spot behavior."

### P. Chốt trọng tâm Input và kế hoạch điều chỉnh theo code hiện tại (2026-08-03)

#### P.1. Phạm vi sản phẩm và tiến độ

- Bài báo NCKH và đồ án là hai sản phẩm riêng nhưng dùng chung ingestion/event contract.
- Bài báo còn **1 tháng**, tập trung toàn vẹn ingestion; đồ án còn **4 tháng**, tập trung Model A1 và vòng đề xuất–đánh giá.
- Trong tháng đầu phát triển song song theo tỷ lệ **70/30 hoặc 80/20** nghiêng về bài báo. Nhánh ML phải hoàn thành input/feature contract, dataset profiling và baseline để không khởi động lại từ đầu sau khi nộp bài.
- Phần mềm chính là hệ thống phân tích điểm nghẽn chuyển đổi TMĐT self-hosted. SDK và Adapter là integration kit; Kafka/Postgres/Qdrant/Ollama là hạ tầng hỗ trợ.

#### P.2. Reference pipeline và hợp đồng mở rộng

```text
Web-shop Node.js
├── Browser SDK (behavior) ───────────────────┐
└── Backend → RabbitMQ → Worker → Adapter ────┤
                                              ↓
                                    Tracking API → Kafka
                                              ↓
                               Streaming → KPI/ML → Dashboard
```

Khả năng mở rộng nguồn khác được chứng minh bằng: JSON Schema `universal-event.v1`, bảng required field theo event type, Source Adapter Interface, mapping specification, compatibility policy và conformance fixtures/tests. Không cần triển khai thêm backend đầy đủ bằng ngôn ngữ khác.

#### P.3. Phân loại input theo ngữ nghĩa và thẩm quyền

| Tín hiệu | Nguồn | Vai trò |
|---|---|---|
| `checkout_start` | Browser SDK | Ý định bắt đầu checkout |
| `order_created_observed` | SDK sau HTTP 201 | Frontend đã quan sát kết quả tạo đơn; dùng đối chiếu coverage |
| `order.created` → `order_created` | Backend/RabbitMQ | Backend đã tạo đơn pending; không cộng lại checkout intent |
| `order.confirmed` | Backend/Worker/RabbitMQ | Order được chấp nhận xử lý; nguồn authoritative cho order conversion |
| `payment.captured` | Payment/Worker/RabbitMQ | Thanh toán thành công; nguồn authoritative cho payment conversion và gross revenue |
| `refund.completed` | Payment/Refund service | Hiệu chỉnh refunded amount và net revenue |
| `order.cancelled` | Backend/Worker | Order không tiếp tục xử lý; không đồng nhất với payment failure |
| `checkout_request_failed` | Browser SDK | Request checkout thất bại theo quan sát client; không đồng nghĩa `payment.failed` |
| `payment.failed` | Worker/backend | Kết quả payment authoritative |

Response tạo đơn nên trả `business_event_id` và `correlation_id`. Client-observed event có `event_id` riêng nhưng liên kết bằng `logical_business_event_id`. Không cộng observed event và authoritative event vào cùng KPI.

#### P.4. Feature contract trước khi chốt dataset

Mỗi feature phải có bảng đối chiếu: dataset có hay không, runtime lấy từ SDK/backend/product context nào, required hay optional, thời điểm feature sẵn có. Chỉ feature tồn tại ở cả training và serving mới vào model chính. Sau bước này mới chốt Retailrocket hay REES46.

#### P.5. Hành động kỹ thuật theo mô hình code hiện tại (chưa triển khai)

1. **Event semantics:** bỏ `purchase_succeeded` phát ngay khi API mới trả `pending`; phân biệt `checkout_request_failed` với `payment.failed`; tránh map cả browser `checkout_start` và backend `order.created` vào một KPI.
2. **SDK:** sinh stable `event_id` trước khi enqueue; thêm bounded batching, retry backoff/jitter, per-event ACK, `sequence_number`, Beacon/pagehide và queue-overflow telemetry.
3. **Commerce boundary:** code hiện ghi MongoDB rồi publish RabbitMQ nên còn dual-write gap. Nếu nghiên cứu cam kết từ OLTP commit thì cần Transactional Outbox; trong phạm vi 1 tháng giới hạn cam kết từ durable ingestion receipt/Kafka ACK, dùng reconciliation đo phần trước handoff và ghi Outbox là integration profile tùy chọn.
4. **Worker:** kiểm tra idempotency của reserve inventory và từng state transition; tránh trường hợp cập nhật trạng thái thành công nhưng publish event thất bại.
5. **Adapter/Tracking API:** durable idempotency thay cache RAM; ACK RabbitMQ chỉ sau durable acceptance; không trả `accepted` cho event bị mapper bỏ qua mà không ghi raw/Kafka.
6. **Streaming:** manual Kafka offset commit sau persistence; lỗi Postgres không được xóa buffer; chỉ aggregate event thực sự mới để duplicate không làm tăng KPI.
7. **Cohesion:** chọn một Browser SDK canonical thay vì duy trì hai bản lệch nhau; web-shop MongoDB + worker là reference commerce implementation, `services/commerce-backend` chỉ là stand-in/test fixture.
8. **Kiểm thử bài báo:** baseline và proposed mechanism trên network timeout, ACK loss, API restart, broker delay và burst traffic; đo loss, duplicate, integrity violation, p95 latency và throughput.

#### P.6. Ranh giới consistency dùng trong báo cáo

- Behavior consistency tách thành completeness, uniqueness, correctness, ordering và timeliness.
- Client-observed response là tín hiệu kiểm chứng, không thay authoritative business event.
- `purchase_behavior_link_rate` chỉ đo nhóm order ghép được với behavior; không phải coverage của toàn bộ visitor.
- Claim at-least-once chỉ bắt đầu sau durable ingestion receipt/Kafka broker ACK nếu chưa triển khai Outbox. Không dùng các cụm “100%”, “exactly-once toàn hệ thống” hoặc “ngang CDC” khi chưa có bằng chứng thực nghiệm.

### Q. Chốt lại mức xâm lấn và pipeline consistency có thể định lượng (2026-08-03)

#### Q.1. Phản biện phương án Transactional Outbox

Nếu yêu cầu “mọi order đã commit vào MongoDB đều phải xuất hiện trong analytics”, luồng `save order → publish RabbitMQ` không đủ vì có dual-write gap. Transactional Outbox có thể đóng khoảng trống này bằng cách ghi business state và outbox event trong cùng transaction; Outbox Relay sau đó publish message, retry và đánh dấu `published` sau publisher confirm.

Tuy nhiên, Outbox buộc hệ thống nguồn phải thay đổi transaction, code persistence và thêm collection/table. Nó khác CDC ở chỗ backend chủ động tạo semantic business event và Tracking không cần quyền oplog/WAL, nhưng vẫn là một cơ chế xâm lấn code và database. Tạo Outbox ở một database độc lập không giải quyết vấn đề vì lại tạo một dual-write mới nếu không có distributed transaction.

Vì vậy, Outbox không được chọn làm integration profile mặc định của đề tài. Nó chỉ là **commit-aware/strong-consistency profile tùy chọn** khi khách hàng chấp nhận thay đổi persistence. CDC là profile tùy chọn khác khi khách hàng không thể sửa backend nhưng chấp nhận cấp quyền database. Hệ thống lõi chỉ phụ thuộc Universal Event Contract, không bắt buộc nguồn dùng Outbox, CDC, RabbitMQ hay Webhook.

#### Q.2. Định nghĩa vận hành về “phi xâm lấn”

Trong đề tài, “phi xâm lấn” không có nghĩa là zero-code. Định nghĩa được chốt là:

> **Phi xâm lấn tầng dữ liệu và xâm lấn tối thiểu tại tầng tích hợp:** Tracking không nhận DB credentials, không đọc trực tiếp OLTP, không thay đổi schema, trigger, repository hoặc transaction của hệ thống nguồn. Các thay đổi được giới hạn ở Browser SDK, message/API integration và source-owned export; chúng phải biệt lập, có thể tháo bỏ và không làm thay đổi kết quả nghiệp vụ.

Các hard constraint:

- Không cấp database credentials cho Tracking; không sử dụng query trực tiếp, trigger, CDC/WAL/oplog hoặc Outbox trong profile mặc định.
- Tracking failure không làm rollback checkout/order/payment của hệ thống nguồn.
- Tắt SDK/Adapter/Tracking thì nghiệp vụ nguồn vẫn hoạt động và không cần rollback database migration.
- Source-specific logic dừng tại Adapter; core streaming, KPI và ML chỉ nhận Universal Schema.

Không dùng một điểm “xâm lấn” tổng hợp có trọng số tùy ý. Báo cáo theo **Integration Footprint đa chiều**: layer bị chạm, số integration point/file/LOC, dependency và quyền mới, thay đổi deployment, p95 overhead, khả năng rollback và mức coupling với business code/schema.

| Mức | Loại can thiệp | Ví dụ |
|---:|---|---|
| 0 | Không can thiệp | Consume MQ/API/export có sẵn |
| 1 | Cấu hình | Endpoint, API key, broker binding |
| 2 | Integration boundary | SDK bootstrap, một publisher/export module |
| 3 | Thay đổi business flow | Instrument nhiều controller/service/component |
| 4 | Thay đổi persistence | Transaction, repository, schema, Outbox |
| 5 | Truy cập sâu dữ liệu | CDC, oplog/WAL, DB credentials |

Mục tiêu reference profile: Database level 0; Frontend level 2; Backend level 0–2; Infrastructure level 1; Reconciliation level 1–2.

#### Q.3. Mức xâm lấn theo layer

| Layer | Mức cho phép | Ranh giới |
|---|---|---|
| Frontend | Một SDK bootstrap; auto-capture mặc định; semantic hook tùy chọn | Không sửa từng button trong base profile; client event không authoritative cho purchase/revenue |
| Backend có MQ/API sẵn | Cấu hình/credential + external Adapter | Không đổi source code nghiệp vụ |
| Backend chưa có event interface | Tối đa một integration publisher ở Service/Domain boundary | Không đặt Tracking trong Repository, không đổi transaction, không rải lời gọi ở nhiều controller |
| Reconciliation | Tái dùng report/export/API; nếu thiếu thì source-owned push job | Tracking không chạy query tùy ý và không biết schema DB |
| Infrastructure | Queue binding, secret, network policy | Least privilege; có thể thu hồi độc lập |
| Database | Không can thiệp trong profile mặc định | Không schema/trigger/transaction/credential |

Hai integration profile công bố:

1. **Minimal Invasion:** Browser SDK + existing RabbitMQ/API + existing export/report. Backend level 0–1, DB level 0. Đây là reference profile ưu tiên.
2. **Standard Integration:** Browser SDK + một Backend Publisher/Webhook + source-pushed Reconciliation Manifest. Backend level 2, DB level 0. Dùng khi nguồn chưa có MQ/export phù hợp.

Nếu đồng thời yêu cầu không sửa frontend, không sửa backend, không truy cập DB/CDC và nguồn không có MQ/API/export/log, bài toán không có điểm quan sát và không khả thi về nguyên lý.

#### Q.4. Pipeline được chọn: realtime fast path + reconciliation control path

```text
SYSTEM NGUỒN
├── Browser SDK ───────────── behavior ────────────┐
├── Existing MQ/API/Webhook ─ business event ─────┤
└── Source-owned Export/Manifest ──────────────┐   │
                                              │   ▼
TRACKING                                      │ Source Adapter
                                              │   ↓
                                              │ Normalize → Validate
                                              │   ↓
                                              │ Durable Ingest → Kafka
                                              │   ↓
                                              │ Streaming Processor
                                              │   ├── Canonical Event Ledger
                                              │   ├── KPI/PostgreSQL
                                              │   └── Insight/Qdrant
                                              ▼
                                         Reconciliation
                                              ↓
                                  Compare → Replay/Backfill
                                              ↓
                                   quay lại Universal Pipeline
```

Realtime path tối ưu độ trễ. Reconciliation path phát hiện phần đã commit ở nguồn nhưng không đi qua handoff. Missing event phải replay qua cùng Normalize–Validate–Kafka–Streaming pipeline, không ghi thẳng vào KPI. PostgreSQL/canonical ledger là nguồn consistency; Qdrant là derived store có thể rebuild.

Tracking API chỉ trả `accepted` sau durable acceptance, không ACK tại controller/cache RAM. RabbitMQ consumer chỉ ACK source message sau receipt này. Adapter retry cùng stable `event_id`; Kafka consumer commit offset sau persistence; canonical event và KPI projection phải idempotent để physical duplicate không tăng KPI.

#### Q.5. Ba contract làm rõ input

1. **Business Event Contract:** `event_id`, `logical_event_key`, `event_type`, `aggregate_id`, `aggregate_version`, `committed_at`, `correlation_id`, payload và schema version.
2. **Ingestion Receipt Contract:** `event_id`, `ingestion_id`, `accepted|duplicate|rejected`, `accepted_at`; `accepted` chỉ có nghĩa khi event đã được handoff bền vững.
3. **Reconciliation Manifest Contract:** window, watermark, authoritative count/revenue và tối thiểu ID/hash + version/status. Count-only chỉ phát hiện sai lệch; muốn định vị và repair cần logical key/detail hoặc Source Replay API.

Manifest có thể được nguồn chủ động push qua API/MQ/file. Source tự đọc dữ liệu bằng report/API thuộc quyền kiểm soát của họ; Tracking không nhận quyền DB. Nếu một order chỉ tồn tại trong DB và không để lại dấu vết qua MQ/API/export/log/CDC thì Tracking không thể phân biệt nó với order chưa từng tồn tại, nên không thể guarantee hoặc định lượng commit-to-analytics.

#### Q.6. State của dữ liệu và phép đo consistency

Luồng trạng thái event:

```text
source emitted → accepted → persisted → analytics_applied → reconciled
```

Cửa sổ dữ liệu:

```text
OPEN → PROVISIONAL → RECONCILING → RECONCILED | DEGRADED
```

Dashboard có thể dùng dữ liệu provisional để realtime; Model A1/training set chỉ dùng cửa sổ reconciled hoặc phải kèm quality flag. Với `S` là tập authoritative từ manifest và `A` là tập analytics trên cửa sổ đã đóng:

- `missing_rate = |S − A| / |S|`
- `phantom_rate = |A − S| / |A|`
- `state_mismatch_rate = count(same ID but different version/status) / |S|`
- `revenue_deviation = |revenue_source − revenue_analytics| / revenue_source`
- `convergence_lag = analytics_correct_at − committed_at`

Ngưỡng đề xuất cho reference pipeline, là target thực nghiệm chứ không phải chuẩn phổ quát:

| Metric | Realtime | Sau reconciliation |
|---|---:|---:|
| Business completeness | ≥99,9% trong 60 giây | 100% trên cửa sổ đã đóng |
| Revenue deviation | ≤0,1% | 0% |
| State mismatch | ≤0,1% | 0% |
| Duplicate ảnh hưởng KPI | 0 | 0 |
| Silent drop | 0 | 0 |
| Handoff-to-dashboard | p95 ≤5 giây | — |
| Convergence với reconciliation mỗi 5 phút | — | p99 ≤7–10 phút |

“100% sau reconciliation” là điều kiện đóng cửa sổ; cửa sổ còn missing phải mang trạng thái `DEGRADED`, không được âm thầm công bố hoàn chỉnh.

#### Q.7. Behavior pipeline và vai trò frontend confirm

Behavior được đo theo các chặng `generated → queued → accepted → persisted → analytics_applied`, dùng stable `event_id`, `session_sequence`, local queue/retry và receipt. Các metric gồm `observable_delivery_rate`, `sequence_gap_rate`, `queue_drop_rate` và `purchase_behavior_link_rate`.

Target demo: `persisted/accepted = 100%` sau hội tụ; `accepted/generated ≥99%` trong browser đã load SDK; sequence gap ≤1%; queue overflow ≤0,1%; purchase–behavior link ≥95% trong môi trường kiểm soát. Session bị chặn trước khi SDK load là unknown population; muốn đo initialization coverage cần mẫu số từ CDN/gateway/access log.

Frontend confirm chỉ sinh `order_created_observed`, không phải purchase authoritative. Ba nguồn được dùng để phân loại lỗi:

| Manifest nguồn | Business event | Frontend observed | Diễn giải |
|---:|---:|---:|---|
| Có | Có | Có | Journey đầy đủ |
| Có | Có | Không | Mất behavior/correlation |
| Có | Không | Có | Business event thiếu trước handoff |
| Có | Không | Không | Chỉ reconciliation phát hiện order |
| Không | Có | Bất kỳ | Phantom/sai trạng thái/sai cửa sổ |

#### Q.8. Giá trị đồ án và cách định vị đóng góp

“Phi xâm lấn” tự nó chỉ là đặc tính sản phẩm, chưa đủ làm đóng góp học thuật. Cách định vị được chọn:

> **Thiết kế pipeline phân tích dữ liệu thời gian thực có khả năng định lượng và phục hồi sai lệch dữ liệu dưới ràng buộc không truy cập trực tiếp OLTP database.**

Ba tầng đóng góp:

1. **Integration framework:** Browser SDK, Source Adapter, Universal Event/Receipt/Reconciliation Contract và một reference pipeline hoàn chỉnh.
2. **Observable consistency:** stable ID, durable receipt, retry, idempotency, canonical ledger, reconciliation và quality state.
3. **Downstream analytics validity:** đánh giá mất/trùng/sai correlation ảnh hưởng funnel KPI, feature và Model A1 thế nào; kiểm tra mức phục hồi sau reconciliation.

Baseline thực nghiệm:

- B0: fire-and-forget, không receipt/retry.
- B1: stable ID + durable receipt + retry + idempotency.
- B2: B1 + reconciliation.

Fault injection: network timeout, ACK loss, API/broker/consumer restart, broker delay, duplicate, out-of-order, burst traffic và mất event trước handoff. Đo loss, duplicate delivery/KPI impact, latency, throughput, convergence, integration footprint và độ lệch KPI/model.

Không biến “phi xâm lấn” thành mục tiêu duy nhất. Trong đồ án, nó là ràng buộc; đóng góp hệ thống là consistency quan sát/repair được; Model A1 là đóng góp phân tích. Bài báo 1 tháng có thể giới hạn ở handoff-to-analytics reliability, còn đồ án 4 tháng mở rộng reconciliation và ảnh hưởng input quality tới Model A1.

#### Q.9. Câu cần xác nhận với giảng viên

> “Phi xâm lấn” có được hiểu là không truy cập/thay đổi database và không sửa business transaction, nhưng cho phép một SDK bootstrap ở frontend, tối đa một integration module tại backend boundary và một source-owned reconciliation export hay không?

Câu phản biện ngắn trước hội đồng:

> Nhóm không claim zero-code. Nhóm bảo vệ persistence và business semantics boundary: không DB credential/schema/transaction change; integration chỉ nằm ở SDK/Adapter/publisher/export có thể tháo bỏ. Đổi lại, nhóm không claim exactly-once từ OLTP commit mà bảo đảm từ durable receipt, dùng reconciliation để đo và sửa phần sai lệch trước handoff trong một cửa sổ hữu hạn.

#### Q.10. Reconciliation Manifest không bắt buộc là một service/API mới

Phản biện mới: nếu hệ thống nguồn đã có Report API ổn định và cấp quyền cho pipeline đọc report, việc xây thêm một push-manifest service có thể là overengineering. **Manifest không có ưu thế tuyệt đối so với Report API; giá trị của nó nằm ở semantics và contract, không nằm ở push hay pull.**

Cần phân biệt:

- Nếu Tracking được cấp DB credential để đọc reporting view trực tiếp thì vẫn có database coupling, query workload và quyền truy cập cần kiểm soát.
- Nếu Tracking chỉ gọi một business/report API có sẵn thì đây đã là integration boundary phù hợp; không cần bắt khách hàng tạo thêm service. Một Report Adapter chuẩn hóa response thành internal `ReconciliationManifest`.

Thiết kế tổng quát:

```text
Reconciliation Provider
├── Pull Report API Provider
├── Push Manifest Provider
├── File/CSV Export Provider
└── MQ Control Message Provider
                ↓
      Internal ReconciliationManifest
                ↓
             Reconciler
```

Core Reconciler chỉ phụ thuộc internal contract. Report/API/export của từng nguồn được cô lập trong Provider/Adapter, giữ loose coupling và tránh bắt mọi khách hàng dùng cùng một phương thức vận chuyển.

Một reconciliation source đủ chất lượng cần có:

- Cửa sổ dữ liệu đóng, `snapshot_id` hoặc `as_of` để pagination không đọc các trạng thái khác nhau.
- `watermark` và grace period để xử lý late event.
- Schema version, terminal status, record ID/hash, aggregate version và committed/updated time.
- Control totals như record count, gross revenue và checksum để phát hiện thiếu page/snapshot drift.
- Data minimization và least-privilege credential; không trả PII/payment detail không cần thiết.
- Cơ chế lấy detail hoặc replay theo logical key nếu muốn tự sửa missing event.
- Rate limit/cache/read replica hoặc resource budget để report query không ảnh hưởng OLTP.

Nếu Report API chỉ trả trạng thái mới nhất và không có snapshot/watermark, kết quả có thể thay đổi trong lúc pagination và không đủ làm ground truth tái lập. Nếu chỉ có count/revenue thì đo được discrepancy nhưng không định vị hoặc repair record thiếu.

Quyết định cho reference pipeline:

> Ưu tiên tái sử dụng Existing/Source-owned Report API, pull theo watermark qua Reconciliation Adapter và tạo internal manifest. Chỉ dùng push manifest khi source không muốn Tracking chủ động gọi API, cần precompute/lọc dữ liệu/ký snapshot hoặc muốn kiểm soát lịch và workload export.

Vì vậy tài liệu dùng `ReconciliationManifest` như **biểu diễn chuẩn nội bộ của một snapshot đối soát**, không đồng nhất nó với một API mới. Điều cần chứng minh là snapshot đóng, control totals, khả năng audit/replay và contract thống nhất; không phải số lượng service được tạo thêm.

### R. Chốt business projection, pipeline hoàn chỉnh và customization theo ngành hàng TMĐT (2026-08-04)

#### R.1. Refactor business state theo ngữ nghĩa thực tế

Hiện tại web-shop dùng một Order aggregate với chuỗi `pending → processing → inventory_reserved → paid → completed`; `completed` đang đồng thời đại diện tạo đơn, thanh toán, purchase và revenue. Hướng refactor không tiếp tục mở rộng một trường status chung mà tách tối thiểu Order và Payment:

```text
Order:
PENDING_PAYMENT → CONFIRMED | CANCELLED

Payment:
PENDING → CAPTURED | FAILED
CAPTURED → REFUNDED
```

- `order.confirmed`: order conversion.
- `payment.captured`: payment conversion và gross revenue.
- `refund.completed`: refunded amount; `net_revenue = captured_amount − refunded_amount`.
- `order_created_observed`: frontend đã quan sát HTTP response, không phải business outcome authoritative.
- Không dùng một `purchase_succeeded` duy nhất cho order, payment và revenue.
- Fulfillment, partial refund, return và chargeback được mô tả bằng contract/hướng mở rộng; không biến đồ án analytics thành dự án xây full e-commerce.

Universal Contract chuẩn hóa semantic event nhưng không ép hệ thống người dùng đổi status/schema. Source Adapter mapping các trạng thái như `PAID`, `PAYMENT_SUCCESS`, `PROCESSING + paid_at` về canonical event tương ứng.

#### R.2. Phạm vi Reconciliation đã chốt

Reconciliation có hai nhiệm vụ:

1. Định lượng agreement/sai lệch giữa source snapshot và analytics.
2. Nếu source cung cấp đủ dữ liệu, làm current Order/Payment projection và revenue hội tụ đúng.

Reconciliation **không khôi phục hoặc bịa lại business event history**. Nếu source chỉ cho biết Payment hiện là `REFUNDED`, hệ thống không tự tạo một `refund.completed` quá khứ với timestamp giả. Thay vào đó ghi correction record có `source_snapshot_id`, trạng thái/amount authoritative, `applied_at` và reason; raw/canonical event cũ không bị xóa hoặc sửa.

```text
Raw event history        → những gì realtime pipeline đã nhận
Current projection       → trạng thái Order/Payment/revenue hiện tại
Reconciliation evidence  → mức agreement và correction đã áp dụng
```

Các metric trước repair: missing, phantom, state mismatch, revenue deviation. Sau repair: residual mismatch, repair success rate và convergence lag. `phantom` không tự động bị xóa vì có thể do filter, pagination, time window, late update hoặc archive. Snapshot không đủ tin cậy hoặc correction không hoàn tất làm window mang trạng thái `DEGRADED`.

Claim chính xác: analytics hội tụ về trạng thái source snapshot công bố; không chứng minh source phản ánh thực tế tuyệt đối.

#### R.3. Identity, Version và Watermark Contract

Bốn định danh không được dùng lẫn nhau:

| Trường | Vai trò |
|---|---|
| `event_id` | Định danh một lần delivery/message; tracing và physical dedup |
| `entity_key` (`source_id + aggregate_type + aggregate_id`) | Ghép Order/Payment giữa realtime và report |
| `aggregate_version` | Xác định state nào mới hơn; chống áp dụng một transition hai lần |
| `correlation_id` | Nối behavior journey–order–payment; không dùng dedup |

`logical_event_key = tenant/source + aggregate_type + aggregate_id + aggregate_version`. Source phát lại cùng logical transition với `event_id` mới vẫn không được tăng KPI lần hai.

Quy tắc correction:

- Source version cao hơn analytics: áp correction.
- Cùng version nhưng khác status/amount: integrity mismatch, source snapshot thắng theo contract.
- Source version thấp hơn analytics: snapshot stale, không rollback projection mới.
- Chỉ có `updated_at`: được correction với confidence thấp hơn.
- Không có cả version và timestamp tin cậy: chỉ đo aggregate, không auto-correct.

Capability level:

- Có `aggregate_version`: đủ điều kiện đạt `RECONCILED`.
- Chỉ có `updated_at`: `VERIFIED_WITH_LIMITATIONS`.
- Thiếu cả hai: chỉ count/revenue discrepancy.

Reference web-shop phải có version đầy đủ để chứng minh pipeline chuẩn; integration bên ngoài không bị ép sửa DB mà Adapter khai báo capability. Snapshot phải có `snapshot_id/as_of`, watermark và grace period để dữ liệu cũ không ghi đè state mới.

#### R.4. Durable Receipt Contract

Kafka broker ACK được chọn làm durable handoff boundary:

```text
Adapter → Tracking validate → Kafka durable ACK → Tracking receipt → Adapter ACK RabbitMQ
```

Receipt status:

| Status | Ý nghĩa |
|---|---|
| `accepted` | Kafka đã nhận bền vững; chưa đồng nghĩa KPI đã cập nhật |
| `duplicate` | Logical event đã tồn tại; không áp KPI lại |
| `rejected` | Contract/data sai, không retry mù |
| `retryable_failure` | Chưa durable; phải gửi lại cùng stable ID |

State sau receipt: `accepted → persisted → analytics_applied → reconciled`. Browser SDK chỉ xóa event khỏi local queue khi nhận per-event receipt phù hợp; batch có lỗi phải trả kết quả từng event, không ACK cả batch một cách mơ hồ.

#### R.5. Làm rõ các ghi chú của giảng viên về phạm vi pipeline

Các cụm trong nhật ký được xác nhận lại:

- **“Tập trung hết vào tất cả”**: hoàn thiện một vertical pipeline end-to-end, không chỉ tập trung module cốt lõi. Mỗi stage phải có implementation thật và input/output contract; độ sâu học thuật vẫn có thể tập trung input consistency, feature engineering và Model A1.
- **“Chia measure cho từng mặt hàng; measure lấy từ matrix”**: matrix là KPI theo `product × time window`; measure được dùng tạo input feature, không chỉ hiển thị dashboard.
- **“ShellCheck”** là ghi nhầm; thuật ngữ đúng là **self-check**. Ý nghĩa cụ thể của self-check vẫn cần xác nhận: module tự kiểm tra integration/data health hay lời nhắc nhóm tự rà soát thiết kế.
- Ba buổi trao đổi đầu mới tập trung làm rõ input và hệ thống thực sự là gì; processing, feature/model, insight và evaluation phía sau chưa được trao đổi với giảng viên.

Pipeline phải hoàn thiện:

```text
Source Integration → Input Contract → Durable Ingestion
→ Validate/Clean/Dedup → Session/Window Processing
→ Product KPI Matrix → Feature Matrix → Model A1
→ Insight/Recommendation → Dashboard/Chatbot → Evaluation
```

#### R.6. Product KPI Matrix và Feature Matrix

Grain cơ sở: **một dòng = một sản phẩm trong một time window**.

Core measures đề xuất:

- Behavior: views, clicks, add-to-carts, remove-from-carts, checkout starts, unique sessions.
- Business: confirmed orders, captured payments, failed payments, refunded amount, gross/net revenue.
- Data quality: missing/duplicate/sequence-gap rate, behavior–business link rate và reconciliation status.

Derived features: view-to-cart, cart-to-checkout, checkout-to-order, order-to-payment, abandonment, revenue/session, AOV, delta so với window trước và category/product historical baseline.

Tách rõ:

```text
KPI Matrix
= product × window measures/rates phục vụ dashboard, reconciliation, evaluation

Feature Matrix
= KPI Matrix + rolling statistics + baseline + trend/delta
 + quality flags + product/category context dùng cho Model A1
```

Gợi ý ban đầu để thảo luận downstream: KPI storage base window 1 phút; feature observation window 15–60 phút; historical baseline 24 giờ/7 ngày. Không chốt chính thức trước khi làm rõ traffic density, event-time/processing-time, tumbling/sliding window, late-event recompute và target của Model A1.

Điểm rủi ro cần phản biện: nếu label được tạo trực tiếp từ cùng KPI threshold trong feature row thì model chỉ học lại rule. Weak supervision phải được công bố và cần test set/ground truth độc lập; có thể dùng Bot Simulator hoặc thiết kế features ở window W để dự đoán outcome/bottleneck ở W+1.

#### R.7. Customization chỉ trong phạm vi mặt hàng/ngành hàng TMĐT

Không claim hỗ trợ domain ngân hàng, giáo dục, y tế hoặc logistics. Hệ thống chỉ customize logic phân tích giữa các product/category trong TMĐT thông qua versioned `AnalysisProfile`.

Profile có thể cấu hình: category taxonomy, funnel, time window, minimum sample, measure/feature được bật, historical baseline, alert threshold, recommendation rule và dashboard priority. Core Event Contract, ingestion, reconciliation và Model A1 interface không đổi.

Phân cấp:

```text
E-commerce Default Profile
        ↓
Category Profile
        ↓
Product Override giới hạn
```

Product override chỉ thay threshold, minimum sample, baseline, ưu tiên/loại trừ measure; không tạo model riêng cho từng sản phẩm. Chiến lược mặc định là một Model A1 dùng feature schema chuẩn, có `category/profile_id`, price band và category baseline; chỉ train category-specific model khi đủ dữ liệu, coi là hướng mở rộng.

Mỗi feature row/prediction phải mang `analysis_profile_id`, `feature_schema_version` và model version. Nếu profile đổi feature/window/label làm schema không tương thích, model phải báo `INCOMPATIBLE_PROFILE`, yêu cầu retrain hoặc fallback rule-based; không dự đoán âm thầm bằng artifact cũ.

Reference demo đề xuất dùng hai profile trên cùng pipeline, ví dụ Electronics và Cosmetics/Fast-moving. Chúng có thể khác observation window, minimum sample, baseline, optional features và recommendation, nhưng cùng Universal Event Pipeline. Đây là bằng chứng customization và loose coupling mà không xây thêm website/backend.

#### R.8. Các nội dung thật sự còn cần làm rõ với giảng viên

1. Giảng viên xác nhận tên đề tài nhóm đã chốt nội bộ trước giữa tháng 8.
2. `self-check` là một system capability kiểm tra SDK/MQ/schema/correlation/data quality/profile readiness hay là yêu cầu nhóm tự kiểm tra thiết kế.
3. Model A1 nhận một `product × time-window` row và phải dự đoán đầu ra nào: target/label, prediction horizon, một hay nhiều bottleneck, minimum traffic để kết luận.
4. Chiến lược windowing/sessionization/late event và cách tạo ground truth/weak label chưa được trao đổi.
5. Contract đầu ra Model A1, cách sinh recommendation, vai trò Model B và Evaluation Engine phía sau chưa được giảng viên phản biện.
6. Mức customization cần chứng minh: đề xuất hai Analysis Profile trong TMĐT; cần xác nhận như vậy đã đủ hay giảng viên muốn category-specific model thật.
7. Cách chứng minh “pipeline hoàn chỉnh”: acceptance criteria cho từng stage, benchmark integration/performance/bandwidth và baseline B0–B2.
