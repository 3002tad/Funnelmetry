# Định hướng đề tài (tổng hợp)

> File tổng hợp các quyết định về tên đề tài, phạm vi hệ thống, kiến trúc ingestion và hướng phát triển AI, chốt trong quá trình trao đổi trước phản biện. Dùng làm căn cứ khi viết báo cáo và trả lời hội đồng.

## 1. Tên đề tài

**Tên đã chốt:**

> **Phương án 1: "Xây dựng hệ thống theo dõi hành vi thời gian thực và phát hiện điểm nghẽn chuyển đổi thương mại điện tử bằng học máy, tích hợp cơ chế đề xuất và đánh giá hiệu quả tối ưu"**

> **Phương án 2: "Xây dựng hệ thống thời gian thực theo dõi hành vi và phát hiện điểm nghẽn chuyển đổi thương mại điện tử bằng học máy, tích hợp cơ chế đề xuất và đánh giá hiệu quả tối ưu"**


Lý do dùng **"hệ thống"** thay vì **"nền tảng"**:
- "Nền tảng" gợi ý multi-tenant/SaaS công cộng, API mở cho bên thứ ba — hệ thống hiện tại chưa đạt mức này, dùng sẽ bị hội đồng hỏi ngược ("sao gọi là nền tảng khi chỉ 1 web-shop demo?").
- "Hệ thống" khẳng định đúng những gì đã build: nhiều thành phần phối hợp end-to-end (SDK → Tracking API → Kafka → Streaming → Postgres/Qdrant → Dashboard/Chatbot), không overclaim.
- Nhất quán với quyết định self-hosted / single-tenant (mục 3) và mục tiêu dồn effort cho AI thay vì cho hạ tầng multi-tenant.

Lý do đổi `"ứng dụng đề xuất tối ưu"` → `"tích hợp cơ chế đề xuất và đánh giá hiệu quả tối ưu"`:
- Phản ánh đúng vòng lặp khép kín đã bổ sung ở mục 10 (khuyến nghị → áp dụng → đo lại hiệu quả bằng KPI before-after), không chỉ dừng ở sinh khuyến nghị một chiều.
- Khôi phục lại đúng ý "đánh giá hiệu quả tối ưu kinh doanh" của tên đề tài gốc ban đầu, nhưng giờ đã có thiết kế cụ thể/đo lường được nên không còn bị đánh giá là mơ hồ.
- Không đưa UTM/đa kênh mạng xã hội (mục 9) vào tên vì đây là chiều dữ liệu bổ sung làm giàu input, không phải năng lực cốt lõi khác biệt — nên trình bày ở tagline/mục tiêu chi tiết, tránh làm tên dài loãng trọng tâm.

Ánh xạ từng cụm trong tên vào thành phần thật:

| Cụm từ | Thành phần tương ứng |
|---|---|
| theo dõi hành vi | Browser Behavior SDK + Tracking API |
| thời gian thực | Kafka + Streaming Processor (flush 5–10s) |
| phát hiện điểm nghẽn chuyển đổi | Funnel KPI (`tracking_kpi_1m`) + model ML thay rule-based hiện tại (`insight_generator.py`) |
| học máy | Model dự đoán/phân loại thay threshold cứng |
| cơ chế đề xuất | Insight + Chatbot RAG (dashboard-api, Qdrant, Ollama) |
| đánh giá hiệu quả tối ưu | Feedback loop before-after KPI cho khuyến nghị đã áp dụng (mục 10) |

## Mô tả tổng quát hệ thống (theo định hướng mới)

Hệ thống là giải pháp theo dõi hành vi người dùng và phân tích chuyển đổi thời gian thực cho website thương mại điện tử, triển khai theo kiến trúc self-hosted trên Kubernetes (k3s). Dữ liệu hành vi từ Browser Behavior SDK và dữ liệu commerce từ backend được chuẩn hoá qua tầng adapter, đưa vào Kafka và xử lý bởi Streaming Processor để tính KPI theo thời gian thực. Trên nền dữ liệu này, một model học máy được huấn luyện để phát hiện điểm nghẽn trong phễu chuyển đổi, thay thế cơ chế rule-based ban đầu và sinh insight lưu trong Qdrant. Một chatbot RAG dùng LLM diễn giải các insight thành khuyến nghị hành động cụ thể cho người quản trị. Khi khuyến nghị được áp dụng, một Evaluation Engine tự động so sánh KPI trước và sau để đánh giá hiệu quả thực tế, khép kín vòng lặp từ phát hiện vấn đề đến đo lường kết quả. Kiến trúc ingestion được thiết kế mở, cho phép mở rộng thêm ngôn ngữ backend và message queue khác nhau, hướng tới một hệ thống phân tích chuyển đổi phù hợp đặc thù thị trường thương mại điện tử Việt Nam.

## 2. Phạm vi: Hệ thống (self-hosted) — không đi hướng SaaS đa tenant

Quyết định: **giữ mô hình hệ thống self-hosted, single-tenant**, không phát triển thành SaaS đa khách hàng.

Lý do:
- SaaS đa tenant đòi hỏi thêm effort lớn không liên quan tới AI: data isolation theo tenant, billing/subscription, tenant-aware auth, onboarding — cạnh tranh trực tiếp thời gian với mục tiêu đi sâu AI trong quỹ 5 tháng còn lại.
- Hạ tầng hiện tại (k3s, 1 namespace, Postgres/Kafka dùng chung) chưa có cơ chế cô lập tenant — làm đúng chuẩn SaaS là một đề tài kỹ thuật khác (system design), không phải hướng AI/thuật toán đã chọn.
- Tránh nhóm câu hỏi phản biện khó về cô lập dữ liệu, mô hình chi phí, khả năng scale đa khách hàng.

Ghi chú cho báo cáo: có thể nhắc 1 câu ở phần "Hướng phát triển" rằng kiến trúc adapter hiện tại cho phép mở rộng thành SaaS đa tenant trong tương lai nếu bổ sung cơ chế cô lập dữ liệu — **chỉ là roadmap, không phải claim hiện tại**.

## 3. Vai trò của Adapter / Ingestion layer (đã điều chỉnh)

**Mục đích cũ (không còn là lý do chính khi self-hosted):** chặn truy cập trực tiếp vào DB người dùng vì lý do bảo mật/multi-tenant (tránh lộ credential).

**Mục đích mới:** Adapter là tầng **chuẩn hoá & diễn giải ngữ nghĩa (schema/protocol translation)** — chuyển đổi các biểu diễn sự kiện không đồng nhất (message MQ, raw change-event từ CDC, hoặc API call trực tiếp) thành event schema thống nhất của hệ thống, bất kể nguồn input là gì.

Kiến trúc ingestion đề xuất (nhiều loại nguồn, cùng 1 tầng adapter):

```
[App-level publish]  → MQ (RabbitMQ/Kafka/...) ──┐
[DB tự có sẵn]       → CDC (Debezium)  ──────────┼──→ Adapter (schema/semantic normalize) → Tracking API/Kafka core
[API call trực tiếp] → HTTP ─────────────────────┘
```

Lý do CDC không thay thế hoàn toàn adapter: CDC chỉ cho biết "1 dòng DB vừa đổi giá trị" (raw row-level change), không tự biết đây là sự kiện nghiệp vụ gì (`order.completed`, `checkout_start`...). Việc diễn giải state transition → business event vẫn cần logic của adapter.

Giá trị của ingestion đa nguồn **không phụ thuộc vào việc có phải SaaS đa khách hàng hay không** — một tổ chức tự host vẫn có nhiều hệ thống nội bộ khác công nghệ (web, mobile, backend cũ/mới, MQ khác nhau) cần hợp nhất về cùng 1 schema.

## 4. CDC (Change Data Capture)

- Hiện tại **chưa dùng CDC** — commerce-backend đang publish event thủ công ở tầng ứng dụng (dual-write pattern: ghi state vào `orders.store.js` và publish event lên RabbitMQ là 2 bước tách biệt, có rủi ro mất event nếu 1 trong 2 bước lỗi).
- CDC (Debezium trên Postgres WAL) là hướng giải quyết rủi ro dual-write này, đồng thời là một loại nguồn ingestion mới cho adapter (mục 3).
- Đề xuất vị trí trong báo cáo: nêu như điểm so sánh kiến trúc (tại sao hiện dùng publish thủ công cho demo) hoặc như hướng phát triển.

## 5. Định hướng AI (đi sâu, quỹ thời gian 5 tháng)

Quyết định: **rút phạm vi ingestion/hạ tầng về mức tối thiểu, dồn effort cho AI/thuật toán**.

- Hiện tại: `insight_generator.py` dùng rule-based threshold (VD: `add_to_cart >= 3 và purchases == 0` → sinh insight text), không phải model học máy.
- Hướng phát triển: thay/bổ sung bằng model học máy thật cho 1 bài toán cụ thể — cần chọn 1 trong số: dự đoán khả năng rớt ở từng bước funnel theo session (classification), dự đoán xu hướng doanh thu/KPI ngắn hạn (forecasting), hoặc phát hiện bất thường funnel bằng model thay vì threshold (anomaly detection).
- Cần có: chuẩn bị dữ liệu/nhãn, huấn luyện, và đánh giá định lượng so với baseline rule-based hiện tại (precision/recall, RMSE...) — đây là phần tạo "đóng góp khoa học" cho luận văn.
- Multi-backend simulator (mục 6) chỉ giữ ở mức tối thiểu, không đầu tư thêm effort ngoài phần đủ để demo.

## 6. Demo đa nguồn (theo gợi ý giảng viên)

- Không cần xây dựng full website cho từng ngôn ngữ/framework khác nhau.
- Chỉ cần **backend simulator** (script/service giả lập gửi event) cho vài stack khác nhau (VD: Node.js, Python/Flask, PHP, Java) qua vài loại MQ khác nhau (RabbitMQ, Kafka trực tiếp...), mỗi loại có 1 adapter tương ứng chuẩn hoá về schema chung.
- Mục đích: chứng minh bằng thực nghiệm khả năng tích hợp đa nguồn (đa ngôn ngữ backend, đa message queue) của hệ thống, tránh bị đánh giá là overclaim.
- Giữ ở mức tối thiểu (1–2 simulator bổ sung ngoài RabbitMQ hiện có) để không cạnh tranh effort với mục tiêu AI (mục 5).

## 7. Khảo sát hệ thống tương đồng (tóm tắt — chi tiết xem lịch sử trao đổi)

| Nhóm | Đại diện | Khác biệt với hệ thống đang xây |
|---|---|---|
| Web/Product Analytics (SaaS) | GA4, Mixpanel, Amplitude, Heap | Đóng (black-box), không self-hosted, AI insight hạn chế hoặc chi phí cao |
| Web/Product Analytics (open-source) | PostHog, Matomo, Snowplow | Self-hosted nhưng thiếu kiến trúc streaming Kafka realtime + AI insight/chatbot tích hợp sẵn |
| Session Replay/Heatmap | Hotjar, FullStory, Contentsquare, Glassbox | Thiên về UX friction, không phải KPI funnel, chi phí enterprise cao |
| CDP | Segment, Antsomi CDP 365, Insider, CleverTap | Mạnh về routing/marketing personalization, không tập trung phân tích funnel kỹ thuật + AI dự đoán |
| CRO | VWO, Optimizely | Dựa trên A/B testing thực nghiệm, không phải phân tích hành vi realtime bằng AI |
| TMĐT Việt Nam tích hợp sẵn | Haravan Insight, Sapo Analytics | Báo cáo doanh thu/đơn hàng cơ bản, ít AI insight hành vi sâu |

**Định vị khác biệt của đề tài:** self-hosted + kiến trúc streaming realtime (Kafka) rõ ràng + AI insight/dự đoán + chatbot RAG tích hợp sẵn + thiết kế theo hành vi mua sắm thị trường TMĐT Việt Nam — khoảng trống mà cả nhóm SaaS đóng lẫn nhóm open-source hiện có đều chưa lấp đầy đồng thời.

## 8. Việc cần nhất quán khi viết báo cáo

- Toàn bộ báo cáo dùng "hệ thống", không dùng "nền tảng" cho tên chính thức.
- Kiến trúc mô tả: 1 tổ chức/tenant, auth JWT role-based nội bộ (shop/chat/admin) — không nhắc tenant isolation như một tính năng đã có.
- Adapter/ingestion trình bày là hợp nhất dữ liệu đa nguồn **nội bộ** (không phải phục vụ nhiều khách hàng bên ngoài).
- SaaS đa tenant chỉ được nhắc ở phần "Hướng phát triển" như tiềm năng mở rộng, không phải mục tiêu hiện tại.

## 9. Attribution nguồn traffic mạng xã hội (UTM tagging)

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

## 10. Tự động tracking & đánh giá lại hiệu quả khuyến nghị (feedback loop)

**Ý tưởng:** ngoài phát hiện điểm nghẽn + sinh khuyến nghị (mục 5), hệ thống tự động theo dõi khuyến nghị nào đã được áp dụng và đánh giá lại hiệu quả thực tế sau khi áp dụng.

**Lý do nên làm:** đây chính là phần **"đánh giá hiệu quả tối ưu kinh doanh"** trong tên đề tài gốc ban đầu (mục 1), nay được cụ thể hoá thành một tính năng đo lường được, thay vì một cụm từ trừu tượng. Nếu dừng ở sinh insight/khuyến nghị, hệ thống chỉ đạt mức descriptive/diagnostic analytics (giống phần lớn công cụ ở mục 7). Thêm vòng đánh giá lại biến nó thành **prescriptive analytics có kiểm chứng** — khuyến nghị đưa ra có tác dụng thật hay không — là điểm khác biệt hiếm gặp, kể cả so với SaaS thương mại.

**Giới hạn về phương pháp (cần nêu rõ khi bảo vệ):** vì chỉ có 1 shop demo, không thể làm A/B test có nhóm đối chứng song song. Phương pháp áp dụng là **so sánh trước/sau theo mốc thời gian áp dụng hành động (before-after)** — kết quả mang tính tương quan, không khẳng định quan hệ nhân quả tuyệt đối (có thể bị nhiễu bởi mùa vụ, chiến dịch khác chạy song song). Hướng nâng cấp thành A/B test thật (chia traffic ngẫu nhiên) nên đưa vào phần "hướng phát triển".

**Thiết kế tối thiểu:**
1. Bảng mới `recommendation_actions`: `insight_id` (liên kết insight đã sinh ra), `action_description`, `applied_at`, `target_metric` (VD: `conversion_rate` của product X hoặc funnel stage Y).
2. Admin đánh dấu "đã áp dụng" khuyến nghị qua Dashboard (khu vực `AdminInsightsPage` đã có sẵn) → ghi `applied_at`.
3. Sau khi đủ 1 khoảng thời gian tương đương (cùng độ dài với window trước đó) → job đánh giá tự động so sánh KPI cùng metric, cùng đối tượng, giữa window trước và sau `applied_at` (tái dùng `tracking_kpi_1m`/`product_kpi_1m` đã có), tính delta %, có thể thêm kiểm định thống kê đơn giản (t-test) nếu đủ dữ liệu.
4. Kết quả đánh giá lưu thành 1 insight loại mới (`evaluation_result`) → đưa vào Qdrant để chatbot RAG trả lời được câu hỏi "khuyến nghị trước đó có hiệu quả không?".
5. Dashboard: biểu đồ so sánh trước/sau cho từng khuyến nghị đã áp dụng.

**Effort & vị trí trong kế hoạch 5 tháng:** trung bình-nhỏ (logic so sánh KPI + 1 bảng mới + UI đánh dấu, tái dùng hạ tầng KPI đã có) — nhỏ hơn nhiều so với xây model ML từ đầu, không xung đột với ưu tiên đi sâu AI (mục 5), mà bổ sung thêm 1 chiều đánh giá khác cho luận văn.

### C. Lựa chọn model LLM cho chatbot (Model B) — có cần khả năng "thinking" không

Làm rõ trước: khái niệm "thinking" (chain-of-thought) chỉ áp dụng cho **Model B (chatbot Ollama)**, không áp dụng cho Model A (mục 5, model dự đoán/phân loại trên dữ liệu dạng bảng — không phải LLM).

Vì VPS GPU chỉ thuê **đúng 1 tháng, đúng thời điểm phản biện** (cửa sổ rủi ro cao, không có thời gian debug), và vì chatbot không phải trọng tâm học thuật chính (Model A mới là phần "bằng học máy" được chấm điểm) → **ưu tiên độ ổn định & tốc độ phản hồi hơn số lượng tham số hoặc khả năng thinking**.

**Model đề xuất:** **Qwen3-4B** — fit gọn trong 4GB VRAM, có chế độ thinking bật/tắt tường minh (`/think`, `/no_think`).
- Chạy **non-thinking làm mặc định** trong toàn bộ luồng demo (nhanh, ổn định, ít rủi ro khi demo trực tiếp).
- Chỉ **bật thinking mode 1 lần, có chủ đích** khi muốn minh hoạ khả năng suy luận trước hội đồng (VD giải thích lý do 1 khuyến nghị cụ thể), không chạy thinking mode làm hành vi mặc định.
- Phương án dự phòng nếu cần chất lượng cao hơn: **DeepSeek-R1-Distill-Qwen-7B** (Q4_K_M ~4.3–4.7GB, cần offload nhẹ sang CPU nhờ RAM 24GB dư dả) — chấp nhận độ trễ cao hơn.

### D. Làm rõ vai trò 4 thành phần AI/Phân tích (Cập nhật Kiến trúc Lai - Tách biệt 4 Model/Engine)

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

### E. Chốt hướng bài báo khoa học (khung 2 tháng)

Sau khi so sánh 2 hướng:
- (1) **Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho SDK và Adapter trong ingestion thời gian thực bằng idempotency + retry có kiểm soát + batching giới hạn**
- (2) **Online Funnel Bottleneck Detection bằng mô hình nhẹ thay rule-based**

Đã **chốt chọn hướng (1)** làm bài báo chính trong 2 tháng: "Thiết kế cơ chế đảm bảo toàn vẹn dữ liệu cho hệ thống thu thập thời gian thực thông qua tính lũy đẳng (Idempotency), Batching và Retry có kiểm soát"(Tên này bỏ chữ SDK và Adapter ở tiêu đề để bao quát hơn, các term này sẽ giải thích trong phần Abstract/Tóm tắt). 

Lý do chốt:
- Phù hợp thời hạn 2 tháng hơn: không phụ thuộc nhiều vào bài toán gán nhãn dữ liệu và vòng lặp tuning model.
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
- Hướng (2) giữ ở mức **hướng phát triển** (hoặc thử nghiệm phụ nếu còn thời gian), không là trọng tâm bài báo 2 tháng.

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
- **Kết luận:** Sự đánh đổi của kiến trúc MQ là rủi ro rớt/trùng tin nhắn. Tuy nhiên, **Module Đảm bảo toàn vẹn dữ liệu (Idempotency, Batching, Retry)** được code trực tiếp vào lõi SDK và Adapter của đồ án đã khắc phục hoàn toàn nhược điểm này, giúp kiến trúc MQ đạt độ tin cậy ngang CDC mà không phải gánh chịu rào cản xâm lấn.

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
- **Model A1 (Bottleneck Detector):** Dùng dataset `Retailrocket` (dữ liệu Clickstream) để train mô hình phân loại rớt phễu (VD: XGBoost). Đầu ra là nhãn điểm nghẽn.
- **Model A2 (Action Recommender):** Lấy kết quả điểm nghẽn từ Model A1, kết hợp với dataset `Olist Marketing Funnel` để train một mô hình thứ hai chuyên gợi ý hành động kinh doanh (tặng voucher, freeship...).
- **Đánh giá:** Kiến trúc rất đẹp và tách bạch rõ ràng (Separation of Concerns), giải quyết được bài toán thiếu data nếu gộp vào 1 model end-to-end. Tuy nhiên, khối lượng công việc (Data cleaning, Feature Engineering, Labeling, Training) sẽ **tăng lên gấp đôi**, tạo ra rủi ro cực lớn làm chậm tiến độ 5 tháng của đồ án.

**Phương án 2: Chiến lược Lai - Train 1 Model + Rule-based (Phương án tối ưu tiến độ - KHUYÊN DÙNG)**
Để vẫn đảm bảo yếu tố "bằng học máy" của đề tài mà không làm quá tải công việc, ta sẽ phân bổ nguồn lực theo hướng "chọn việc mà làm":
- **Khâu Phát hiện (Chốt chặn 1 - Bắt buộc dùng ML):** Dồn toàn bộ nỗ lực Học máy (ML) để train duy nhất **Model A1** (XGBoost với Retailrocket). Việc này giúp tập trung thời gian để chăm chút kỹ phần tinh chỉnh mô hình và biểu đồ đánh giá (Precision/Recall) cho báo cáo.
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
