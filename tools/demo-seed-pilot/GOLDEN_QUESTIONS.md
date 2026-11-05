# Bộ câu hỏi vàng cho seed pilot

Dataset: `demo-seed-pilot-v1`, source `demo-reference-pilot`, seed `20261104`; logical SHA-256 `e7466b494748a376c9a29bba2a88543369f1b029ebdfd04d18ec33f1aa1cc6a4`. Thời gian behavior: 2025-11-01 đến trước 2026-11-01 UTC theo `occurred_at`; cart CDC theo `source_produced`; catalog/order là snapshot fixture lúc nạp. Dữ liệu là synthetic; quality nguồn `UNVERIFIED`, riêng order `BLOCKED_BY_QUALITY` với gap `INCOMPLETE`. Kết quả chỉ được đối chiếu cho fixture.

SQL, grain, mốc thời gian, đáp án được tính độc lập từ fixture và giới hạn từng câu nằm trong [golden.mjs](golden.mjs). Runner so sánh từng SQL trên view với kết quả độc lập, qua role demo chỉ đọc.

| ID | Câu hỏi | Đáp án pilot |
| --- | --- | --- |
| G01 | Lượt xem sản phẩm | 120 event |
| G02 | Lượt xem sản phẩm theo tháng UTC | 2025-11: 10; 2025-12: 11; 2026-01: 10; 2026-02: 9; 2026-03 đến 2026-10: 10/tháng |
| G03 | Lượt gửi search | 34 event |
| G04 | Search theo từ khóa normalized | `running shoes`: 7; `travel bag`: 16; `water bottle`: 11 |
| G05 | Product hiện tại | 30 products |
| G06 | Product theo category | Accessories: 7; Beauty: 6; Home: 7; Sports: 7; 3 products không có category |
| G07 | Cart line hiện tại | 32 lines |
| G08 | Cart item added | 32 CDC events |
| G09 | Order reference hiện tại ON | 12 orders; không phải completed, paid, conversion hay doanh thu |
| G10 | Browser event theo UTM label demo | absent: 77; newsletter: 106; organic: 100; social: 100 |
| G11 | Session synthetic có browser event | 120 distinct sessions |
| G12 | Context cart link | 32 events, không đếm là thêm giỏ |
| G13 | Doanh thu đã thu | `INSUFFICIENT_DATA` |
| G14 | Tỷ lệ search dẫn đến thêm giỏ | `INSUFFICIENT_DATA` |

G10 dùng registry demo và join `(source_id, source_event_id)`; không xem label là attribution hay dùng `received_at` làm thời gian lịch sử. `ABSENT`, `INVALID`, `UNMAPPED` được phân biệt. Không cộng product-category rows để suy tổng products khi một product có nhiều category. Các đáp án thiếu dữ liệu là expected response, chưa được kiểm thử qua model.
