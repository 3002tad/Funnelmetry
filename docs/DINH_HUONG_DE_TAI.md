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

---

## Nhật ký trao đổi bổ sung — 2026-07-08

### A. Vị trí cụm "thời gian thực" trong tên đề tài

Cụm "thời gian thực" đặt sát "thương mại điện tử" (như bản trước đó) dễ bị đọc nhầm thành "thương mại điện tử thời gian thực". Đã chốt 2 phương án thay thế (ghi ở mục 1):
- **Phương án 1:** gắn ngay sau "theo dõi hành vi" — khớp đúng bộ phận thực sự real-time (SDK/Tracking API/Kafka).
- **Phương án 2:** gắn ngay sau "hệ thống" — mô tả cả hệ thống ở tầng hạ tầng/pipeline.

Lưu ý: không đặt "thời gian thực" gần cụm "đánh giá hiệu quả" vì Evaluation Engine (mục 10) là before-after theo chu kỳ, không phải real-time — đặt sai chỗ sẽ tạo mâu thuẫn khi đối chiếu thiết kế thật.

### B. Chiến lược hạ tầng triển khai demo

**Cloud-native vs VPS:** đây không phải 2 lựa chọn loại trừ nhau — hệ thống hiện tại (k3s + microservices + Kafka) đã là kiến trúc cloud-native, câu hỏi thực chất là **host ở đâu**. Quyết định: giữ nguyên kiến trúc k3s hiện có, host trên **1 VPS thuê** (không đầu tư managed cloud như AWS EKS/GCP GKE — tốn chi phí, effort học thêm không cần thiết, cạnh tranh thời gian với mục tiêu AI).

**VPS trong nước vs AWS/Alibaba:** tách 2 nhu cầu khác nhau:
- **Huấn luyện model (mục 5):** dùng Google Colab/Kaggle (miễn phí GPU) cho phần lớn thử nghiệm; chỉ thuê GPU AWS/Alibaba theo giờ (bật train, tắt ngay) nếu cần compute mạnh hơn giới hạn miễn phí — đây là kịch bản AWS/Alibaba phát huy đúng thế mạnh (pay-per-use ngắn hạn).
- **Host demo liên tục (dashboard, chatbot):** ưu tiên **VPS trong nước** — thủ tục thanh toán đơn giản (VND), không rủi ro billing bất ngờ như AWS/Alibaba (pay-per-hour, cần thẻ quốc tế, GPU quota phải xin duyệt), độ trễ thấp khi hội đồng truy cập trực tiếp, nhất quán với định vị "thị trường TMĐT Việt Nam" (mục 7).

**Quyết định thực tế:** nhóm chỉ đăng ký thuê VPS **1 tháng, đúng thời điểm phản biện**. Quá trình phát triển + train (nếu có) + kiểm thử diễn ra ở local + Colab, không dùng VPS GPU cho giai đoạn này.

**Cấu hình VPS đã chọn:** gói **V100-4GB** — 8 Core E5 v4, 24GB RAM, 160GB NVMe SSD, 4GB GPU NVIDIA V100, giá 1.650.000 VNĐ/tháng.
- GPU 4GB VRAM là ràng buộc chính cho việc chọn LLM cho chatbot; RAM 24GB/CPU 8 core dư dả, đủ để offload thêm phần model không fit VRAM sang CPU/RAM nếu cần, và đủ chạy đồng thời Kafka + Postgres + Qdrant + streaming-processor + tracking-api + dashboard-api (tổng ước tính ~9–13GB trong 24GB).

### C. Lựa chọn model LLM cho chatbot (Model B) — có cần khả năng "thinking" không

Làm rõ trước: khái niệm "thinking" (chain-of-thought) chỉ áp dụng cho **Model B (chatbot Ollama)**, không áp dụng cho Model A (mục 5, model dự đoán/phân loại trên dữ liệu dạng bảng — không phải LLM).

Vì VPS GPU chỉ thuê **đúng 1 tháng, đúng thời điểm phản biện** (cửa sổ rủi ro cao, không có thời gian debug), và vì chatbot không phải trọng tâm học thuật chính (Model A mới là phần "bằng học máy" được chấm điểm) → **ưu tiên độ ổn định & tốc độ phản hồi hơn số lượng tham số hoặc khả năng thinking**.

**Model đề xuất:** **Qwen3-4B** — fit gọn trong 4GB VRAM, có chế độ thinking bật/tắt tường minh (`/think`, `/no_think`).
- Chạy **non-thinking làm mặc định** trong toàn bộ luồng demo (nhanh, ổn định, ít rủi ro khi demo trực tiếp).
- Chỉ **bật thinking mode 1 lần, có chủ đích** khi muốn minh hoạ khả năng suy luận trước hội đồng (VD giải thích lý do 1 khuyến nghị cụ thể), không chạy thinking mode làm hành vi mặc định.
- Phương án dự phòng nếu cần chất lượng cao hơn: **DeepSeek-R1-Distill-Qwen-7B** (Q4_K_M ~4.3–4.7GB, cần offload nhẹ sang CPU nhờ RAM 24GB dư dả) — chấp nhận độ trễ cao hơn.

### D. Làm rõ vai trò 3 thành phần AI/phân tích — Model A, Evaluation Engine, Model B

Mục 10 (feedback loop) **không do Model A hay Model B đảm nhận chính** — đây là thành phần thứ 3, **Evaluation Engine**: thuật toán thống kê tất định (so sánh KPI before-after + t-test), **không phải model học máy được huấn luyện**.

| | Model A (mục 5) | Evaluation Engine (mục 10) | Model B (chatbot) |
|---|---|---|---|
| Bản chất | Model ML đã huấn luyện (classification/regression) | Thống kê tất định (before-after delta, t-test) | LLM có sẵn (Qwen3-4B) |
| Có phải "học máy"? | Có — trọng tâm cụm "bằng học máy" trong tên đề tài | Không — thống kê mô tả/kiểm định giả thuyết | Có (LLM), nhưng chỉ là lớp trình bày |
| Cần GPU/VPS? | Không — inference nhẹ, chạy tốt trên CPU | Không — chỉ là truy vấn SQL + phép tính | Có — lý do duy nhất cần VPS GPU |

Luồng phối hợp:
```
Model A (ML) → sinh insight "điểm nghẽn X" → Admin áp dụng hành động (applied_at)
                                                    ↓
                                Evaluation Engine (thống kê before-after)
                                                    ↓
                                evaluation_result → lưu Qdrant
                                                    ↓
                    Model B (chatbot) → diễn giải cho người dùng bằng ngôn ngữ tự nhiên
```

Không cần ép Evaluation Engine phải "là AI" — chọn đúng công cụ cho đúng bài toán (thống kê cho đánh giá tác động 1 can thiệp đơn lẻ, không có nhóm đối chứng) là luận điểm kỹ thuật vững khi bảo vệ, không phải điểm yếu.
