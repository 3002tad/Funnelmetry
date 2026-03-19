# UPDATE.md

Tài liệu này ghi lại chi tiết các thay đổi đã áp dụng gần đây, lý do thay đổi, tác động và cách vận hành tương ứng.

---

## 1) Tối ưu throughput pipeline realtime

### Mục tiêu
- Giảm độ trễ từ lúc emit đến lúc thấy dữ liệu trên dashboard.
- Tăng throughput ổn định cho luồng Generator → Kafka → Spark → PostgreSQL.
- Làm mượt chỉ số `processedEventsPerSec` ở UI.

### Thay đổi chính theo component

#### services/generator-api/server.js
- Thêm endpoint `GET /gen/drain?limit=N` để trả về batch event từ `eventQueue`.
- Cơ chế queue rõ ràng:
  - Queue rỗng → trả `204 No Content`.
  - Queue có data → trả JSON `{ count, queueSize, events }`.
- Giảm overhead HTTP do poll từng event.

#### services/producer-poller/producer.py
- Chuyển poll từ single-event sang batch-drain.
- Biến môi trường chính:
  - `API_DRAIN_URL`
  - `POLL_BATCH_LIMIT` (mặc định 100)
  - `POLL_INTERVAL_MS` (mặc định 20ms)
- Logging giảm tần suất để giảm noise và overhead.

#### infra/docker-compose.yml
- Đồng bộ env cho service `producer`:
  - `API_DRAIN_URL: http://api-generator:7070/gen/drain`
  - `POLL_BATCH_LIMIT: 100`
  - `POLL_INTERVAL_MS: 20`

#### services/spark-streaming/spark_stream.py
- Trigger interval giảm `5s` → `2s`.
- Thêm cấu hình đọc từ environment (`KAFKA_*`, `POSTGRES_*`, `CHECKPOINT_DIR`).
- Thêm bước startup guard `ensure_kafka_topic(...)`:
  - Chờ Kafka sẵn sàng.
  - Tự tạo topic nếu chưa có.
  - Tránh crash sớm với lỗi `UnknownTopicOrPartitionException`.

#### services/dashboard-api/server.js
- Cải tiến `processedEventsPerSec`:
  - Base rate tính trên cửa sổ 10 giây.
  - Làm mượt bằng EMA để đồ thị ít giật hơn.

### Kết quả vận hành
- Luồng batch emit xử lý mượt hơn rõ rệt.
- Độ trễ hiển thị dashboard giảm so với cấu hình cũ.
- Spark tránh được crash startup do topic chưa sẵn sàng.

---

## 2) Mở rộng triển khai K3s (WSL)

### Mục tiêu
- Có phương án deploy Kubernetes local song song Docker Compose.
- Hỗ trợ môi trường Windows + Ubuntu WSL + K3s 1 node.

### Manifest chính

#### k8s/k3s-stack.yaml
- Tạo đầy đủ tài nguyên cho namespace `realtime`:
  - `Namespace`, `Secret`, `ConfigMap`, `PVC`, `Service`, `Deployment`.
- Service public chuyển sang `NodePort`:
  - `api-generator`: `30070`
  - `dashboard-api`: `30080`
  - `frontend`: `30173`
  - `generator-ui`: `30174`
- Kafka hardening:
  - `enableServiceLinks: false` để tránh xung đột env `KAFKA_*` do service links.
- Persistence:
  - PVC cho `postgres`, `kafka`, `zookeeper`, `spark-checkpoints`.
- Frontend nginx:
  - Inject qua `ConfigMap` để proxy `/api` → `dashboard-api`.

#### k8s/README.md
- Viết lại theo workflow WSL thực tế:
  - Build image trên Windows (Docker Desktop).
  - Export/import image vào K3s containerd.
  - Dùng `sudo k3s kubectl ...` (không dùng context mặc định).
  - Truy cập bằng `WSL_IP:NodePort`.

#### docs/COMMANDS.md
- Bổ sung lệnh K3s theo ngữ cảnh WSL chuẩn:
  - `wsl.exe -e sh -lc "... sudo k3s kubectl ..."`.

---

## 3) Sửa lỗi production-like trong quá trình chạy thật

### Lỗi Kafka CrashLoopBackOff
- Nguyên nhân: env service links inject biến `KAFKA_*` không mong muốn.
- Cách xử lý: tắt `enableServiceLinks` cho pod Kafka.

### Lỗi Spark CrashLoopBackOff
- Nguyên nhân: Spark subscribe topic trước khi Kafka topic sẵn sàng.
- Cách xử lý: thêm `ensure_kafka_topic(...)` trong Spark startup.

### Lỗi Generator UI báo API Offline trên K3s
- Nguyên nhân: UI gọi cứng `http://localhost:7070` và `http://localhost:8080`.
- Cách xử lý:
  - Đổi client sang đường dẫn tương đối trong `generatorApi.ts`.
  - Thêm nginx proxy nội bộ trong `generator-ui/nginx.conf`:
    - `/api-generator/*` → `api-generator:7070`
    - `/dashboard-api/*` → `dashboard-api:8080`

### Lỗi truy cập NodePort bằng localhost
- Trên WSL2, `localhost:<NodePort>` có thể `ERR_CONNECTION_REFUSED`.
- Cách dùng đúng: `http://<WSL_IP>:<NODE_PORT>`.

---

## 4) Trạng thái hệ thống hiện tại

### Chạy bằng Docker Compose
- Các service chính hoạt động theo luồng realtime chuẩn.

### Chạy bằng K3s (WSL)
- Pod chính chạy ổn định sau các fix:
  - `kafka`, `zookeeper`, `postgres`
  - `api-generator`, `producer`, `spark-streaming`
  - `dashboard-api`, `frontend`, `generator-ui`

### Endpoint kiểm tra nhanh
- Generator API health: `/health`
- Dashboard API health: `/health`
- Dashboard UI: trang React qua NodePort
- Generator UI: trang React qua NodePort + proxy nội bộ API

---

## 5) Danh sách file cập nhật quan trọng

### Cập nhật code/runtime
- `infra/docker-compose.yml`
- `services/generator-api/server.js`
- `services/producer-poller/producer.py`
- `services/spark-streaming/spark_stream.py`
- `services/dashboard-api/server.js`
- `generator-ui/src/services/generatorApi.ts`
- `generator-ui/nginx.conf`

### Cập nhật Kubernetes/docs
- `k8s/k3s-stack.yaml`
- `k8s/README.md`
- `docs/COMMANDS.md`
- `docs/INTRODUCTION.md`
- `docs/ARCHITECTURE.md`
- `docs/UPDATE.md`

---

## 6) Ghi chú vận hành

### Khi thay đổi code service
- Docker Compose: rebuild service tương ứng (`docker-compose build <service>` + `up -d`).
- K3s local:
  1. Build lại image ở Windows.
  2. `docker save` ra tar.
  3. `sudo k3s ctr images import ...` trong WSL.
  4. `sudo k3s kubectl rollout restart deploy/<name>`.

### Khi thay đổi manifest K3s
- Apply lại: `sudo k3s kubectl apply -f k8s/k3s-stack.yaml`.
- Theo dõi rollout: `sudo k3s kubectl -n realtime rollout status deploy/<name>`.

---

## 7) Hướng cải tiến tiếp theo (đề xuất)

- Thêm `resources requests/limits` cho tất cả deployment.
- Bổ sung `livenessProbe` cho các pod chưa có.
- Tách `StatefulSet` cho thành phần stateful (Kafka/Postgres/Zookeeper) nếu nâng cấp môi trường.
- Thêm observability chuẩn (Prometheus/Grafana + centralized logs).

---

## 8) Tóm tắt

Project đã được nâng cấp theo hướng:
1. **Throughput cao hơn, latency thấp hơn, metrics mượt hơn**.
2. **K3s local trên WSL vận hành ổn định với playbook rõ ràng**.
3. **Docs đã được đồng bộ theo implementation hiện tại**.
