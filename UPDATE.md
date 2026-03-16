# UPDATE.md

Tài liệu này tổng hợp các thay đổi mới đã được áp dụng vào project trong quá trình làm việc gần đây.

---

## 1. Tối ưu throughput pipeline realtime

### Mục tiêu
- Giảm cảm giác chậm khi dùng `Auto Emit`
- Tăng throughput từ Generator → Kafka → Spark → PostgreSQL
- Làm chỉ số `Processing Rate` phản ánh mượt hơn

### Thay đổi chính

#### `services/generator-api/server.js`
- Thêm endpoint mới `GET /gen/drain?limit=N`
- Endpoint này cho phép `producer-poller` lấy nhiều events trong một request thay vì từng event một
- Giảm overhead HTTP giữa `generator-api` và `producer-poller`
- Bỏ log drain quá thường xuyên để tránh log spam

#### `services/producer-poller/producer.py`
- Đổi từ cơ chế poll 1 event/lần sang poll batch events
- Dùng biến mới:
  - `API_DRAIN_URL`
  - `POLL_BATCH_LIMIT`
  - `POLL_INTERVAL_MS`
- Tăng hiệu năng mặc định:
  - `POLL_INTERVAL_MS = 20`
  - `POLL_BATCH_LIMIT = 100`
- Giảm tần suất log info để bớt ảnh hưởng hiệu năng

#### `infra/docker-compose.yml`
- Update cấu hình service `producer`:
  - `API_DRAIN_URL: http://api-generator:7070/gen/drain`
  - `POLL_BATCH_LIMIT: 100`
  - `POLL_INTERVAL_MS: 20`

#### `services/spark-streaming/spark_stream.py`
- Giảm Spark trigger interval:
  - từ `5 seconds` → `2 seconds`
- Mục tiêu là giảm độ trễ hiển thị dữ liệu lên dashboard

#### `services/dashboard-api/server.js`
- Cải tiến metric `processedEventsPerSec`
- Tính rate theo cửa sổ 10 giây thay vì 60 giây
- Thêm làm mượt bằng EMA để UI đỡ nhảy số mạnh

### Kết quả test thực tế
- Emit batch `200` events
- Sau khoảng `10s`, DB ghi nhận tăng đủ `+200`
- `Processing Rate` đo được khoảng `8.8 events/s` trong test gần nhất

---

## 2. Bổ sung hỗ trợ Kubernetes (K3s)

### Mục tiêu
- Thêm lựa chọn triển khai bằng Kubernetes bên cạnh Docker Compose
- Giữ kiến trúc gần với stack hiện tại để dễ migrate

### File mới

#### `k8s/k3s-stack.yaml`
- Tạo full manifest K3s cho stack `realtime`
- Bao gồm:
  - `Namespace`
  - `Secret`
  - `ConfigMap`
  - `PersistentVolumeClaim`
  - `Service`
  - `Deployment`
- Các thành phần được deploy:
  - `zookeeper`
  - `kafka`
  - `postgres`
  - `api-generator`
  - `producer`
  - `spark-streaming`
  - `dashboard-api`
  - `frontend`
  - `generator-ui`

#### `k8s/README.md`
- Hướng dẫn chạy K3s
- Cách build images local
- Cách import images vào K3s / k3d
- Cách deploy / xem logs / xóa stack

### File cập nhật

#### `docs/COMMANDS.md`
- Thêm section mới: `Chạy bằng Kubernetes (K3s)`
- Bổ sung lệnh:
  - build app images
  - `kubectl apply -f k8s/k3s-stack.yaml`
  - `kubectl -n realtime get pods`
  - `kubectl delete -f k8s/k3s-stack.yaml`

---

## 3. Trạng thái hệ thống đã xác nhận

### Docker Compose
- Tất cả service chính đã được bring up và test
- Kafka từng gặp lỗi `InconsistentClusterIdException`
- Đã xử lý bằng cách xóa volume `infra_kafka-data` và restart stack

### Realtime pipeline
Đã test thành công luồng:
- `Generator UI / API` → `producer-poller`
- `producer-poller` → Kafka
- Kafka → Spark Streaming
- Spark → PostgreSQL (`events_clean`, `kpi_1m`)
- PostgreSQL → `dashboard-api`
- `dashboard-api` → Dashboard / Generator UI

### UI/API kiểm tra thành công
- Dashboard: `http://localhost:5173`
- Generator UI: `http://localhost:5174`
- Dashboard API: `http://localhost:8080`
- Generator API: `http://localhost:7070`

---

## 4. Danh sách file đã thay đổi / thêm mới

### Updated
- `infra/docker-compose.yml`
- `services/generator-api/server.js`
- `services/producer-poller/producer.py`
- `services/spark-streaming/spark_stream.py`
- `services/dashboard-api/server.js`
- `docs/COMMANDS.md`

### Added
- `k8s/k3s-stack.yaml`
- `k8s/README.md`
- `UPDATE.md`

---

## 5. Ghi chú vận hành

### Nếu sửa code/config thì cần restart phù hợp
- Sửa `docker-compose.yml` cho `producer`:
  - `docker-compose up -d --force-recreate producer`
- Sửa code service Node/Python:
  - `docker-compose up -d --build <service>`
- Với thay đổi gần đây, các service đã được rebuild/recreate trong lúc làm việc

### Nếu Kafka lỗi cluster id
Chạy:

```powershell
cd infra
docker-compose down
docker volume rm infra_kafka-data
docker-compose up -d
```

---

## 6. Hướng phát triển tiếp theo

Nếu muốn tối ưu thêm, các bước tiếp theo hợp lý là:
- Refactor Spark để đọc config từ environment thay vì hardcode
- Bổ sung Helm chart cho K3s/Kubernetes
- Thêm smoke tests cho API và pipeline
- Tách metric thật cho Kafka lag thay vì heuristic hiện tại

---

## 7. Tóm tắt ngắn

Project đã được update theo 2 hướng lớn:
1. **Tăng tốc và làm mượt pipeline realtime**
2. **Bổ sung phương án deploy bằng K3s**

Hiện tại project chạy được với Docker Compose và đã có nền tảng để deploy bằng Kubernetes.
