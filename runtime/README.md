# Runtime — đọc trước khi khởi chạy

Thư mục này giữ launcher, cấu hình local và bằng chứng vận hành. Không phải bộ cài tổng quát. Quay lại [mục lục tài liệu](../docs/README.md).

## Chọn đúng thao tác

| Muốn làm gì | Đọc / dùng | Không được hiểu nhầm |
|---|---|---|
| Mở lại demo đã cấu hình trên máy này | [START_PRIVATE_DEMO](START_PRIVATE_DEMO.md), `../start-private-demo.cmd` | Resume container có sẵn, không tạo/migrate/seed môi trường mới |
| Cấu hình Source Connector | [worker README](../workers/source-connector/README.md), [env mẫu](source-connector.env.example) | HTTPS pull; sửa file không tự đổi env container |
| Bật Qwen/tool | [API AI README](../apps/dashboard-api/src/lib/ai/README.md), [env mẫu](qwen.env.example), [analytics](../analytics/README.md) | Flag không tự cài DB view/catalog; không chứng minh provider khỏe |
| Đồng bộ catalog sản phẩm | [worker README](../workers/catalog-sync/README.md), [env mẫu](catalog-sync.env.example) | Credential Medusa Admin riêng; one-shot khác worker định kỳ |
| Đọc lần kích hoạt order analytics cũ | [Bằng chứng 27/09](ORDER_ANALYTICS_ACTIVATION_2026-09-27.md) | Snapshot lịch sử, không chạy lại lệnh như clean bootstrap |
| Tìm cấu hình Tailscale/Gateway trước đây | [Private ingress lịch sử](../infra/PRIVATE_INGRESS.md) | Không thuộc transport baseline hiện hành; không bật thay Source Connector |
| Dựng/chạy lại sandbox Docker handoff trên máy mới | [Các bước bên dưới](#chạy-sandbox-docker-handoff-trên-máy-mới), [CODEX_HANDOFF](../CODEX_HANDOFF.md) | Project/DB/Kafka/cursor riêng; không dùng launcher private cũ |
| Chuyển sang máy khác | [DEC-125](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/PIPELINE_PARALLEL_DEMO_AND_MIGRATION_RULES_V1.md) | Chọn chế độ, kiểm tra isolation/backup/checkpoint; không copy Kafka volume |

## Chạy sandbox Docker handoff trên máy mới

Chạy các lệnh PowerShell **tại root repository** (thư mục chứa `infra/` và `runtime/`).
Đây là môi trường độc lập; [CODEX_HANDOFF](../CODEX_HANDOFF.md) §4–7 là checklist
quyền truy cập, lineage, coverage và nghiệm thu đầy đủ. Chọn **một** chế độ trước
khi chạy: `OFFLINE_DEMO` hoặc fresh `PARALLEL_LIVE`. Không dùng
`start-private-demo.cmd`: launcher đó chỉ resume một deployment private khác.

1. Kiểm tra Docker Desktop đang dùng Linux containers `linux/amd64`, cổng UI dự kiến
   còn trống, project mới không trùng project cũ và không trỏ vào DB/Kafka/volume
   của demo khác. Đăng nhập `docker login ghcr.io -u YOUR_GITHUB_USERNAME` bằng
   tài khoản có quyền `read:packages`; nhập token tại prompt, không ghi vào Git.
2. Nếu chưa có, copy các file `handoff*.env.example` thành `handoff*.env` tương ứng
   trong `runtime/`, **không ghi đè** file đã điền. `handoff.env` cần project/cổng,
   ba image digest trong CODEX_HANDOFF và secret mới. Mỗi file `.env` được tạo phải được
   `git check-ignore` nhận diện; không in `compose config` đầy đủ hoặc `docker inspect`
   ra chat vì có thể lộ credential.
3. Nếu chạy live, hoàn tất thêm `handoff-live.env`, `handoff-catalog.env` và
   `handoff-ai.env`. Feed URL là HTTPS `/v1/events`, token là quyền đọc Feed,
   `HANDOFF_FEED_ID` khớp `event_feed_id` nguồn và `HANDOFF_INITIAL_AFTER_SEQ`
   là ranh giới đã xác minh; **không tự đoán `0` hoặc dùng cursor của máy cũ**.
   Chỉ đặt `HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE` sau khi đã kiểm tra isolation,
   retention/coverage và tải Source. Qwen chỉ bật khi key, chi phí và phạm vi dữ
   liệu gửi ra provider đã được chấp thuận. Catalog dùng Medusa Admin secret key
   riêng, không dùng Feed/browser key.

### Dựng mới offline

Không thêm live/catalog overlays, không inject fixture vào môi trường dự định chuyển
sang live. Bộ này kiểm tra bootstrap/UI/API/workers nhưng **không** chứng minh kết nối
Medusa hoặc Qwen. Cấu hình `handoff.env` trước, rồi chạy:

```powershell
$handoffArgs = @(
  '--env-file', 'runtime/handoff.env',
  '-f', 'infra/compose.handoff.yml',
  '-f', 'infra/compose.handoff-pipeline.yml',
  '-f', 'infra/compose.handoff-analytics.yml'
)
docker compose @handoffArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Handoff config invalid' }
docker compose @handoffArgs pull
if ($LASTEXITCODE -ne 0) { throw 'Handoff image pull failed' }
docker compose @handoffArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'Handoff startup failed' }
docker compose @handoffArgs ps -a
```

### Fresh PARALLEL_LIVE với Medusa, catalog và Qwen

Chỉ áp dụng cho sandbox **mới, chưa restore database/cursor cũ** và đã qua preflight
ở trên. Không gắn overlay live vào snapshot/DB cũ để né quy trình `RESTORE_REPLAY`.
Nếu đã có một project live handoff trên máy này, dùng mục **Dừng và resume** bên dưới,
không seed hay khởi tạo lại cursor.

```powershell
$handoffArgs = @(
  '--env-file', 'runtime/handoff.env',
  '--env-file', 'runtime/handoff-live.env',
  '--env-file', 'runtime/handoff-catalog.env',
  '--env-file', 'runtime/handoff-ai.env',
  '-f', 'infra/compose.handoff.yml',
  '-f', 'infra/compose.handoff-pipeline.yml',
  '-f', 'infra/compose.handoff-analytics.yml',
  '-f', 'infra/compose.handoff-live.yml',
  '-f', 'infra/compose.handoff-catalog.yml'
)
docker compose @handoffArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Handoff live config invalid' }
docker compose @handoffArgs pull
if ($LASTEXITCODE -ne 0) { throw 'Handoff image pull failed' }
docker compose @handoffArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'Handoff startup failed; preserve state for diagnosis' }
docker compose @handoffArgs ps -a
```

Mở `http://localhost:5181` nếu `HANDOFF_UI_PORT=5181`; cổng UI chỉ bind vào
`127.0.0.1`. Đăng nhập bằng Admin bootstrap trong `handoff.env`, rồi tạo một tài
khoản **Analyst** qua quản lý người dùng để dùng analytics/chat; Admin không có
quyền đó. `bootstrap`, `kafka-topics`, `profile-publisher` và
`analytical-releases` thoát mã `0` sau khi hoàn thành là bình thường.

Sau khi `ps -a` ổn, kiểm tra Source Connector `/readyz` **riêng** với `/healthz`,
đối chiếu event ID có giới hạn từ Feed → receipt → canonical/outcome → Journey/
Funnel/KPI, và kiểm tra catalog snapshot. Tổng count hoặc container `healthy`
không đủ để chứng minh completeness; `order.placed` là giá trị đơn đã đặt, không
phải doanh thu đã thanh toán. Qwen `enabled`/key hiện diện cũng chưa chứng minh
chat route dùng provider: phép thử gửi evidence live ra Qwen cần được phép riêng.
Ghi PASS/FAIL/UNVERIFIED và giới hạn vào hồ sơ environment theo CODEX_HANDOFF §7.

### Dừng và resume — giữ nguyên dữ liệu

Mỗi terminal PowerShell mới cần khai báo lại **đúng `$handoffArgs` của chế độ đã
chạy** ở trên. Kiểm tra project trong `handoff.env` không bị đổi rồi dùng:

```powershell
docker compose @handoffArgs stop
docker compose @handoffArgs ps -a
# Lần sau, cùng project/volumes/env-file/Compose file set:
docker compose @handoffArgs up -d
docker compose @handoffArgs ps -a
```

`stop` giữ PostgreSQL/Kafka volumes và cursor. Không dùng `down -v`, `prune`, copy
Kafka volume hay chỉnh `HANDOFF_INITIAL_AFTER_SEQ` để reset một cursor đã lưu.
Nếu thay env, dùng `up -d` để Compose recreate service cần thiết; `restart` đơn
thuần không nạp cấu hình mới. Nếu bootstrap báo checksum mismatch, dừng để review
migration, không xóa DB. Image đã pin digest không tự đổi khi sửa source host.

## File nào được chia sẻ?

Bộ khung image-based bàn giao phát triển mới: [Handoff Docker](../infra/HANDOFF.md).
Trạng thái phát hành và hướng dẫn máy nhận: [CODEX_HANDOFF](../CODEX_HANDOFF.md).
Ba image đã publish ngày 04/10/2026; kết nối live/AI trên máy nhận vẫn cần preflight
và acceptance riêng. Không kèm database cũ hoặc secrets trong image.

- `*.env.example`: mẫu cấu hình trong Git, không chứa credential thật.
- `*.env`, logs và `backups/`: local/ignored, có thể chứa dữ liệu nhạy cảm. Không zip cả thư mục để gửi hoặc commit.
- `dashboard-private.env`: cấu hình local của Dashboard API hiện có; không có nghĩa mọi máy đều đã được cấp tài khoản, DB và key tương ứng.
- `private-ui.log`, `private-ui-error.log`: chẩn đoán UI local, không chứng minh worker/Source khỏe.
- Browser-only chat history không nằm trong backup PostgreSQL; không chuyển browser profile/token sang máy bạn.

## Trước khi đổi cấu hình

1. Xác định đúng service, cách nạp config (process env, env-file, mount hay DB).
2. Không in toàn bộ env hoặc Docker inspect chứa secret vào log/chat.
3. Restart không luôn nạp env mới; kiểm tra deployment của từng service trước khi recreate.
4. Giữ nguyên tên `private` để tương thích script/mount. Đây không phải khẳng định hệ thống còn cần VPN.
5. Không reset cursor, xóa volume hoặc replay lịch sử để xử lý lỗi UI/đăng nhập.

Đợt dọn tài liệu 03/10/2026 chỉ bổ sung điều hướng; không di chuyển hoặc sửa file cấu hình thực tế.
