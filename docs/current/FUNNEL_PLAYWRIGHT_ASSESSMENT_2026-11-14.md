# Đánh giá Funnelmetry bằng Playwright — 14/11/2026

> Muốn đọc theo hướng **vấn đề → nguyên nhân → giải pháp → kết quả**, xem [bản giải thích dễ đọc](BAO_CAO_NGUYEN_NHAN_GIAI_PHAP_KET_QUA_2026-11-14.md).

## Kết luận

Đã sửa 4 vấn đề giao diện phễu trong mã local và kiểm thử bằng Chromium thực qua Playwright. Sau sửa: **11/11 ca browser PASS, 19/19 unit test PASS, TypeScript và production build PASS**. Chưa deploy các sửa đổi lên VPS.

Phiên Analyst trên `https://analyst.entidi.io.vn` đăng nhập thành công, khảo sát 14 URL, ghi nhận 72 phản hồi API GET, không có HTTP >=400 hoặc browser exception trong các phản hồi đã thu thập. Đây là smoke điều hướng/hiển thị; không phải 14 chức năng đã được nghiệm thu: 8 URL chuyển hướng.

**Chưa đủ bằng chứng xác nhận toàn hệ thống/pipeline sẵn sàng production.** Live Data Health báo reconciliation gate `UNAVAILABLE`; hai funnel instances là `Provisional`. Không được suy 100% observed conversion thành conversion cuối cùng hoặc chất lượng hoàn chỉnh.

## Phạm vi và phương pháp

- Căn cứ: Master §23.10 (profile/version, window, quality), §23.15 (error/trust states), §23.17 (UI acceptance); quy tắc Cookbook về funnel, grain và evidence.
- Local: Node 22.16.0, Vite, Chrome, Playwright core có sẵn tại `D:/KLTN/ui-preview/qa/package/index.mjs`. Vite loopback trên cổng ngẫu nhiên; không nạp `.env`; API fixture synthetic; không gọi model hoặc ghi database.
- Browser local dùng route React thật `/funnels`, viewport desktop 1440×1000 và mobile 390×844. Fixture có 100/50/10 lượt reached, profile dài/ngắn, policy có/không cấu hình, cohort rỗng và lỗi 503.
- Live: đăng nhập Analyst bằng cấu hình kiểm thử hiện có; chỉ điều hướng và đọc dữ liệu, không bấm mutation/export/model. Thời điểm bắt đầu public smoke khoảng 15:32 ngày 14/11/2026, giờ Asia/Bangkok. JSON máy ghi thời gian UTC khi có trường timestamp.
- Admin: chưa thực hiện. Automatic approval review từ chối script đọc credential Admin trên server để truy cập màn hình vận hành vì quyền này chưa được xác nhận riêng. Không thử cách khác để vượt chặn.

## Phát hiện và thay đổi

| ID | Ưu tiên | Trước sửa / bằng chứng | Thay đổi local | Kết quả |
|---|---|---|---|---|
| F01 | P1 | Độ rộng step là `100-i*8`, không phụ thuộc reached; với fixture 100/50/10 hình dạng vẫn 100/92/84 | Giữ vùng bấm/nhãn đủ rộng; thêm thanh riêng theo `observed_reach_rate` API, giới hạn phần vẽ 0–100%, không sửa số gốc | PASS tỷ lệ 100/50/10 và thanh có chiều cao/màu thực |
| F02 | P1 | Footer luôn nói horizon/grace chưa cấu hình kể cả API trả 86400/3600 | Hiện từng giá trị giây API; null hiển thị chưa cấu hình; vẫn ghi OBSERVED không suy final drop-off | PASS có cấu hình và null |
| F03 | P1 | Profile/version không xuất hiện trong nội dung nhìn thấy ở `/funnels` dù có trong component | Hiện provenance riêng bên ngoài card header: profile/version, source, cohort basis/window UTC, cuối khoảng loại trừ | PASS profile/version nhìn thấy |
| F04 | P2 | API lỗi chỉ có thông báo; không có nút retry | Thêm nút thử tải lại danh sách và projection, khóa nút trong lúc fetch | PASS lỗi 503 và phục hồi danh sách không reload |

Bổ sung cảnh báo DEGRADED khi count >0 và hiển thị count Reconciling trong quality context. Đây là biểu diễn trạng thái API, không nâng quality gate. Nhánh retry projection đã type-check/build nhưng chưa có ca browser riêng cho lỗi projection.

Các file sản phẩm sửa: `apps/dashboard-web/src/ui-template/FunnelView.tsx`, `apps/dashboard-web/src/ui-template/integration.css`, `apps/dashboard-web/src/features/funnels/FunnelsPage.tsx`. Thêm bộ kiểm thử `apps/dashboard-web/test/funnel-browser.mjs`.

Không có migration, đổi event/metric contract hay thay dữ liệu lịch sử. API hiện có giữ nguyên. Không thay các chỉnh sửa đã tồn tại trong `DATA.md`, `SYSTEM.md`, `tools/cdc-operations/README.md`.

## Kết quả browser local

| Ca kiểm thử | Sau sửa |
|---|---|
| Profile/version và OBSERVED nhìn thấy | PASS |
| Thanh reached theo 100/50/10, có màu và chiều cao thực | PASS |
| Horizon/grace có cấu hình hiển thị đúng | PASS |
| Chọn bước rồi đổi profile ngắn reset lựa chọn | PASS |
| Mobile không tràn ngang document | PASS |
| Danh sách profile rỗng có empty state | PASS |
| API lỗi không giả thành số 0 | PASS |
| Retry danh sách phục hồi không tải lại trang | PASS |
| Policy null ghi chưa cấu hình | PASS |
| Cohort 0 không hiện NaN/Infinity | PASS |
| Không browser exception hoặc API fixture ngoài dự kiến | PASS |

Baseline trước sửa: 7 PASS / 4 FAIL; sau sửa 11 PASS / 0 FAIL. Ca thanh reached sau đó được tăng cường kiểm tra computed color/height sau khi kiểm tra ảnh phát hiện CSS cần dùng biến `--tpl-*`.

Unit test ban đầu chạy thiếu `--experimental-strip-types` trên Node 22.16 nên 4 file lỗi nạp TypeScript. Chạy với cờ phù hợp: 19/19 PASS; đây là lỗi lệnh kiểm thử, không phải lỗi nghiệp vụ.

## Quan sát live

| URL thử | URL cuối | Kết luận |
|---|---|---|
| `/overview` | `/overview` | Render + API GET quan sát OK |
| `/funnels` | `/funnels` | Render; 2 entrants, 2 observed converted, 2 provisional trong scope mặc định của phiên |
| `/products` | `/products` | Render + API GET quan sát OK |
| `/traffic` | `/traffic` | Render + API GET quan sát OK |
| `/events` | `/events` | Render + API GET quan sát OK |
| `/data-health` | `/data-health` | Render nhưng reconciliation `UNAVAILABLE` |
| `/journeys` | `/funnels` | Redirect; chưa test tương tác tab Timeline live |
| `/workspace`, `/metrics`, `/assets`, `/analysis-runs`, `/evidence`, `/findings`, `/reports` | `/overview` | Redirect; không coi module đích cũ là đã hoạt động |

Data Health hiển thị 276 accepted, 277 canonical persisted, 275 normalized, 1 unsupported, 0 quarantined, snapshot/comparison 0/0. Các count có thể khác grain/phạm vi/lifecycle; chưa đối soát DB nên **không kết luận mất hoặc trùng sự kiện** từ chênh lệch này.

Các số live là snapshot quan sát, không phải benchmark throughput/latency hoặc tính toán lại dữ liệu. Network collector chỉ thu API GET trong từng lần điều hướng; không chứng minh không có lỗi ngoài thời gian/luồng kiểm thử.

## Việc tiếp theo theo ưu tiên

1. **P1 — Đối soát và freshness:** điều tra gate UNAVAILABLE, snapshot/comparison rỗng và trạng thái provisional bằng API/DB/runbook được cấp quyền; chưa được tự nâng quality hay replay/reset pipeline.
2. **P1 — Nghiệm thu bản sửa live:** deploy theo quy trình riêng rồi chạy lại Playwright trên profile thật; hiện VPS vẫn chạy UI cũ.
3. **P2 — Browser coverage:** bổ sung projection-error retry, thay đổi date range, timeline/drill-down, 401/403, role switching và accessibility/keyboard; chưa đánh dấu các mục này PASS.
4. **P2 — Realtime:** xác minh notification SSE và stale/reconnect behavior theo Master §23.18; lần kiểm thử này chưa đo, không khẳng định realtime đạt yêu cầu.
5. **P2 — Vận hành Admin:** cần xác nhận quyền riêng để kiểm thử màn hình pipeline/connector/recovery. Không có bằng chứng mới về Kafka lag, worker liveness, CDC freshness hoặc recovery.
6. **P3 — Hiệu năng:** đã giữ lazy route và không thêm runtime dependency; chưa có benchmark trước/sau để tuyên bố giảm latency, CPU hoặc bundle. Cải thiện đợt này là độ đúng biểu đồ và phục hồi lỗi không cần reload toàn trang.

## Bằng chứng và chạy lại

- [Kết quả trước sửa](../../apps/dashboard-web/test/artifacts/funnel-before/results.json)
- [Kết quả sau sửa](../../apps/dashboard-web/test/artifacts/funnel/results.json)
- [Ảnh desktop sau sửa](../../apps/dashboard-web/test/artifacts/funnel/desktop.png) · [Ảnh mobile](../../apps/dashboard-web/test/artifacts/funnel/mobile.png)
- [Live Analyst audit — text, URL cuối, API status](../../apps/dashboard-web/test/artifacts/funnel/live/audit.json)
- [Public login smoke](../../apps/dashboard-web/test/artifacts/funnel/live-smoke.json)
- [Unit test log](../../apps/dashboard-web/test/artifacts/funnel/unit-tests.txt) · [Build log](../../apps/dashboard-web/test/artifacts/funnel/build.txt)

Chạy từ `D:/KLTN/Funnelmetry/apps/dashboard-web` trong PowerShell:

```powershell
$env:PLAYWRIGHT_MODULE='D:/KLTN/ui-preview/qa/package/index.mjs'
D:/KLTN/node.exe test/funnel-browser.mjs
D:/KLTN/node.exe --experimental-strip-types --test test/*.test.mjs
D:/KLTN/node.exe node_modules/typescript/bin/tsc -b
D:/KLTN/node.exe node_modules/vite/bin/vite.js build
```

Máy khác: cài `playwright-core` hoặc đặt `PLAYWRIGHT_MODULE` tới module có sẵn; đặt `CHROME_PATH` nếu Chrome khác đường dẫn mặc định. Bộ test đóng browser/server khi hoàn tất. Các ảnh/JSON chứa fixture hoặc dữ liệu đánh giá live; không lưu token/mật khẩu.

> Lưu trữ bằng chứng: ảnh PNG, log TXT và raw live audit được giữ local, không đưa lên Git; các liên kết tới chúng chỉ mở được trong workspace đã kiểm thử. Git giữ mã kiểm thử và các kết quả JSON được chọn. Trạng thái chưa commit/deploy trong nội dung là mốc lịch sử của báo cáo; xem báo cáo triển khai mới nhất khi có.

