# Triển khai Pipeline hiện hành

Đường triển khai Pipeline là Docker Swarm với image được pin và env/secret riêng cho môi trường. Trên VPS reference, main stack và CDC stack là hai ownership/runtime riêng; giữ nguyên slot, topic/group, coverage epoch và mapper volume khi cập nhật CDC. Không tạo thêm Connect hoặc writer dùng chung slot/group.

## Cấu hình chính

- Main stack: [`runtime/swarm.mjs`](../../runtime/swarm.mjs), manifest trong [`infra/`](../../infra/), mẫu [`runtime/deploy.env.example`](../../runtime/deploy.env.example). `runtime/deploy.env` là file cục bộ ignored; giá trị mẫu không xác nhận cấu hình live.
- CDC stack: [`runtime/cdc-live.mjs`](../../runtime/cdc-live.mjs), [`infra/swarm-cdc-live.yml`](../../infra/swarm-cdc-live.yml), `runtime/cdc-live.env` cục bộ ignored. Xem [CDC operations](../../tools/cdc-operations/README.md) trước khi đổi nguồn/slot hoặc phục hồi.
- Installer Medusa: [`tools/medusa-ci-installer/CDC_DEVELOPMENT.md`](../../tools/medusa-ci-installer/CDC_DEVELOPMENT.md) mô tả CI sinh phần tích hợp; installer không tự cấp PostgreSQL role/publication/slot hay vận hành Connect.

Launcher main hỗ trợ `check`, `check-internal`, `check-app`, `check-host`, các lệnh tạo secret và `deploy`/`deploy-internal`/`deploy-app`. Chạy kiểm tra cấu hình trước thao tác mutation; one-shot bootstrap/topic/profile jobs cần đọc task state và log, không diễn giải `0/1` sau Complete như service bị lỗi. CDC launcher có preflight riêng và bảo vệ không chạy song song old target. Xem trực tiếp `--help`/source của launcher trước khi áp dụng lệnh trên môi trường cụ thể.

Khi triển khai trên một checkout khác nơi lưu env live, truyền **đường dẫn env tường minh** cho cả hai lệnh, ví dụ `node runtime/swarm.mjs check-app /absolute/path/to/live-deploy.env` rồi `node runtime/swarm.mjs deploy-app /absolute/path/to/live-deploy.env`. Trên VPS reference, env live của main stack hiện nằm tại `/srv/KLTN/Funnelmetry-cdc-profile/runtime/deploy.env`; file `/srv/KLTN/Funnelmetry/runtime/deploy.env` chỉ được dùng sau khi đã đối chiếu với env live. Launcher so sánh image của API/Web và các worker quan trọng, cùng flag CDC của API, với service đang chạy. Nếu có thay đổi, `check-app` in diff và SHA-256 của đúng diff đó; `deploy-app` từ chối cho đến khi operator xem xét và đặt `SWARM_DEPLOY_CHANGE_ACK=<digest>` trong env được chọn. Digest cũ không hợp lệ khi live state hoặc target đổi. Không dùng ACK để che một env cũ chưa đồng bộ.

Cloudflare Tunnel cho `analyst` dùng HTTP origin tại cổng cấu hình (mặc định `31080`); HTTPS public kết thúc ở Cloudflare. Origin phải bị chặn từ Internet trực tiếp và được kiểm chứng từ bên ngoài trước khi bật tunnel mode. Cấu hình `local`/`acme` là phương án edge khác, không dùng đồng thời. Chi tiết firewall ở [`infra/firewall`](../../infra/firewall/).

Swarm single-node không bảo đảm HA cho PostgreSQL/Kafka. Backup/restore, image provenance, secret và source cursor là trách nhiệm riêng của deployment; không dùng volume/cursor của môi trường demo khác để dựng live.
