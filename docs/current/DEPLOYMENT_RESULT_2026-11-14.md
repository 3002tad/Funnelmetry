# Kết quả commit, build và triển khai VPS — 14/11/2026

## Kết quả thực tế

Đã push thay đổi lên `origin/main`, build trên VPS và cập nhật riêng Dashboard API,
Dashboard Web, funnel processor. Cả ba service có update state `completed`,
1 container chạy và health `healthy` sau triển khai.

**Chưa nghiệm thu đầy đủ:** kiểm thử trình duyệt sau đăng nhập chưa thực hiện;
image chưa publish GHCR và file env của launcher chưa đồng bộ với image đang chạy.

## Commit

- `e97ce46`: API/UI phễu lịch sử, biểu đồ, retry, hủy request và kiểm thử.
- `210fac8`: tối ưu evaluator và bộ đối chiếu/benchmark.
- `803aec4`: tài liệu, công cụ chẩn đoán, JSON kết quả đã chọn.
- `7592354497f6157619ac9feef9a387c1cd36c074`: hợp nhất remote main mới, không conflict;
  đây là commit dùng build. Remote trước đó có các commit DB-GPT nên lần push đầu
  bị từ chối non-fast-forward; đã fetch/merge/push, không force push.

Các sửa đổi sẵn có trong `docs/current/DATA.md`, `docs/current/SYSTEM.md` và
`tools/cdc-operations/README.md` được giữ ngoài commit. Ảnh, raw live audit và log
vẫn local; Git giữ code test, kết quả JSON được chọn, SQL/query map không chứa credential.

## Phương thức rollout

Preflight `check-app` phát hiện env live trỏ tới image cũ của API/Web/ledger writer.
Không chạy deploy cả stack vì có thể làm lùi service ngoài phạm vi. Đã cập nhật
riêng ba service bằng immutable local image digest, kiểm tra service Spec trước/sau:
**chỉ Image thay đổi**, env/secret/command/mount/network/policy giữ nguyên.

- API: build kế thừa image API đang chạy, chỉ thay `v2-analytics-repository.js`.
- Worker: build kế thừa image worker đang chạy, chỉ thay `evaluator.js`.
- Web: build từ Dockerfile của commit, giữ `VITE_DB_GPT_URL=https://ai.entidi.io.vn`
  xác định từ bundle cũ; API cùng origin.

Đây là bản vá kế thừa runtime hiện hành cho API/worker, không phải rebuild toàn bộ
runtime của hai image đó từ source commit. Không đổi PostgreSQL, Kafka, CDC,
profile activation, schema, snapshot hoặc dữ liệu nghiệp vụ.

| Service | Image digest sau rollout |
|---|---|
| dashboard-api | `funnelmetry-dashboard-api@sha256:477e73bbb1423cf05dc0844fbf21a93c9ff0109dabc5632e5aeebad51959754d` |
| dashboard-web | `funnelmetry-dashboard-web@sha256:5b26280aa7e0ea9882de20dd99430c775c1839937076bd2cb9a1f98e843bc16e` |
| funnel-processor | `funnelmetry-funnel-processor@sha256:44150dbfa56563e68352777b0348624077443839c90e427ebdb7ce5c9338edfc` |

File API và evaluator trong container đang chạy đã được so SHA-256 với file trong
checkout commit build và khớp. Đây là bằng chứng đúng mã vá, không thay kiểm thử
nghiệp vụ toàn tuyến.

## Kiểm thử đã chạy

| Kiểm tra | Kết quả |
|---|---|
| API tests trong image mới, container tạm không mạng | 14/14 đạt |
| Evaluator, late conversion, Medusa reference tests trong image worker mới, không mạng | 13/13 đạt |
| Web build trên VPS | Thành công |
| Swarm convergence và health ba service | completed, 1/1, healthy |
| Playwright HTTPS `/login` | 200, form hiển thị |
| Playwright `/funnels` chưa đăng nhập | Chuyển về login |
| API overview không token | 401 |
| Browser exception trong public smoke | Không ghi nhận |

Kiểm thử sau đăng nhập không chạy: automatic approval review chặn script đọc file
credential tên Admin để đăng nhập Analyst. Cần tài khoản Analyst được cấp rõ ràng
hoặc xác nhận riêng việc dùng credential hiện có. Không thử phương án khác để vượt chặn.

## Giới hạn triển khai phải giữ rõ

Launcher yêu cầu image GHCR. Automatic approval review chặn việc push image vào
GHCR vì xuất mã ứng dụng tới registry bên ngoài chưa được xác nhận riêng.
Đã khôi phục `deploy.env` gốc sau khi phát hiện local image không đáp ứng validator.
Các service vẫn chạy image mới; env gốc vẫn có drift đã tồn tại trước rollout.

**Không chạy full-stack deploy từ env đó để cập nhật tiếp:** cần đồng bộ chính xác
image live, publish GHCR khi được phép, xem lại diff và ACK đúng digest. Không dùng
ACK để bỏ qua image ledger writer cũ. Local images chỉ có trên node hiện tại;
chưa phù hợp reschedule sang máy khác hoặc khôi phục máy mới từ registry.

Vì vậy trạng thái là **đã cập nhật runtime single-node, còn thiếu đồng bộ registry/
launcher và authenticated acceptance**, không phải hoàn tất production acceptance.

## Rollback và bằng chứng giữ trên VPS

Thư mục `/srv/KLTN/funnel-release-20261114-7592354/` chứa:

- `rollback-images.json`: ba image trước deploy.
- `target-images.json`, `deployment-completed.json`, `verification.json`.
- Dockerfile bản vá, build/update logs.
- Backup env quyền 0600, không đưa vào Git hoặc xuất ra chat.

Rollback bằng cách cập nhật đúng từng service về image trong `rollback-images.json`
với `docker service update --no-resolve-image --image <old-image> <service>`, rồi kiểm tra
convergence/health. Không cần rollback database vì không có migration/ghi dữ liệu.
Chưa thực hiện rollback vì health hiện đạt.

Ảnh và public Playwright result giữ local trong `D:/KLTN/deploy-funnel-20261114/live/`.
Không commit credential, env, raw service Spec hoặc ảnh chụp chứa thông tin tài khoản.

## Việc còn lại

1. Xác nhận quyền publish image vào GHCR của dự án, rồi đồng bộ digest với launcher.
2. Cấp phép rõ credential Analyst để kiểm tra nhãn lịch sử, Data Health, đổi ngày,
   timeline và các màn đọc dữ liệu trên website đã deploy.
3. Đối soát vẫn cần snapshot/projection đúng contract; rollout này không tự tạo bằng chứng.
