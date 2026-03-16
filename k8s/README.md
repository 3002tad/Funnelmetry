# K3s local Ubuntu guide (WSL friendly)

Hướng dẫn này dành cho môi trường bạn đang dùng: **Windows + Ubuntu WSL + K3s 1 node**.

## Mô hình chạy

- Docker dùng để **build image** (không bắt buộc `docker-compose up`)
- K3s/containerd dùng để **run pod**
- Manifest nằm ở `k8s/k3s-stack.yaml`

## 0) Chuẩn bị

### Yêu cầu tối thiểu

- 4 vCPU
- 8 GB RAM
- 20+ GB disk

### Kiểm tra K3s

Chạy trong Ubuntu WSL:

```bash
sudo systemctl status k3s
sudo k3s kubectl get nodes
```

Kỳ vọng: node ở trạng thái `Ready`.

---

## 1) Build image ứng dụng

### Cách khuyến nghị (PowerShell)

Từ repo root:

```powershell
cd D:\Detai\Business-Data-Streaming---Processing-Pipeline\infra
docker-compose build api-generator producer spark-streaming dashboard-api frontend generator-ui
```

> Không cần chạy `docker-compose up` để deploy K3s.

---

## 2) Export image từ Docker

> K3s **không tự kéo image từ internet**. Cần export **tất cả** image (kể cả kafka, zookeeper, postgres) từ Docker Desktop rồi import vào K3s.

Chạy trong PowerShell:

```powershell
mkdir D:\Detai\k3s-images -Force

# --- App images (build từ docker-compose build) ---
docker save -o D:\Detai\k3s-images\infra-api-generator.tar    infra-api-generator:latest
docker save -o D:\Detai\k3s-images\infra-producer.tar         infra-producer:latest
docker save -o D:\Detai\k3s-images\infra-spark-streaming.tar  infra-spark-streaming:latest
docker save -o D:\Detai\k3s-images\infra-dashboard-api.tar    infra-dashboard-api:latest
docker save -o D:\Detai\k3s-images\infra-frontend.tar         infra-frontend:latest
docker save -o D:\Detai\k3s-images\infra-generator-ui.tar     infra-generator-ui:latest

# --- Infrastructure images (docker-compose pull hoặc đã có sẵn) ---
docker save -o D:\Detai\k3s-images\cp-kafka.tar       confluentinc/cp-kafka:7.5.0
docker save -o D:\Detai\k3s-images\cp-zookeeper.tar   confluentinc/cp-zookeeper:7.5.0
docker save -o D:\Detai\k3s-images\postgres.tar        postgres:15-alpine
```

Nếu chưa có image infra, pull trước:

```powershell
docker pull confluentinc/cp-kafka:7.5.0
docker pull confluentinc/cp-zookeeper:7.5.0
docker pull postgres:15-alpine
```

---

## 3) Import image vào K3s containerd

Chạy trong Ubuntu WSL:

```bash
# App images
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-api-generator.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-producer.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-spark-streaming.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-dashboard-api.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-frontend.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/infra-generator-ui.tar

# Infrastructure images
sudo k3s ctr images import /mnt/d/Detai/k3s-images/cp-kafka.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/cp-zookeeper.tar
sudo k3s ctr images import /mnt/d/Detai/k3s-images/postgres.tar
```

Kiểm tra đủ chưa:

```bash
sudo k3s ctr images ls | grep -E "kafka|zookeeper|postgres|infra-"
```

> Không dùng `sudo k3s ctr images import <(docker save ...)` trên WSL vì dễ lỗi `/dev/fd/...`.

---

## 4) Deploy manifest

Chạy trong Ubuntu WSL:

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
sudo k3s kubectl -n realtime get pods
sudo k3s kubectl -n realtime get svc
```

Theo dõi rollout:

```bash
sudo k3s kubectl -n realtime rollout status deploy/postgres
sudo k3s kubectl -n realtime rollout status deploy/kafka
sudo k3s kubectl -n realtime rollout status deploy/api-generator
sudo k3s kubectl -n realtime rollout status deploy/producer
sudo k3s kubectl -n realtime rollout status deploy/spark-streaming
sudo k3s kubectl -n realtime rollout status deploy/dashboard-api
```

---

## 5) Truy cập service

Port NodePort (không cần mở nhiều cửa sổ `port-forward`):

- Generator API: http://<WSL_IP>:30070 (test: `/health`)
- Dashboard API (backend): http://<WSL_IP>:30080 (test: `/health`, `/api/kpi`)
- Frontend Dashboard (UI): http://<WSL_IP>:30173
- Generator UI: http://<WSL_IP>:30174

> Lưu ý: mở `http://<WSL_IP>:30080/` sẽ thấy `Cannot GET /` là bình thường,
> vì đây là API service, không phải web UI.

> Trên Windows + WSL2, `localhost:<nodePort>` có thể bị `ERR_CONNECTION_REFUSED`.
> Ưu tiên dùng `WSL_IP`.

Lấy IP WSL:

```bash
hostname -I
```

`port-forward` vẫn dùng được như phương án fallback:

```bash
sudo k3s kubectl -n realtime port-forward svc/api-generator 7070:7070
sudo k3s kubectl -n realtime port-forward svc/dashboard-api 8080:8080
sudo k3s kubectl -n realtime port-forward svc/frontend 5173:5173
sudo k3s kubectl -n realtime port-forward svc/generator-ui 5174:5174
```

---

## 6) Lệnh vận hành nhanh

```bash
# logs
sudo k3s kubectl -n realtime logs -f deploy/producer
sudo k3s kubectl -n realtime logs -f deploy/spark-streaming

# watch pods
sudo k3s kubectl -n realtime get pods -w

# restart one deployment
sudo k3s kubectl -n realtime rollout restart deploy/producer

# remove all resources
sudo k3s kubectl delete -f k8s/k3s-stack.yaml
```

---

## 7) Troubleshooting thường gặp

### A. `the path "k8s/k3s-stack.yaml" does not exist`

Bạn đang đứng sai thư mục. Chạy:

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
```

### B. `Error from server (NotFound): the server could not find the requested resource`

Tránh dùng `sudo kubectl ...` với context không đúng. Dùng:

```bash
sudo k3s kubectl get nodes
```

### C. Producer báo `NoBrokersAvailable` / `ECONNREFUSED`

Đây là hậu quả của Kafka chưa lên. Kiểm tra:

```bash
sudo k3s kubectl -n realtime get pods
sudo k3s kubectl -n realtime logs deploy/kafka --previous
```

Nếu Kafka dính dữ liệu cũ (`InconsistentClusterIdException`), reset nhanh:

```bash
sudo k3s kubectl -n realtime delete deploy kafka zookeeper
sudo k3s kubectl -n realtime delete pvc kafka-data zookeeper-data
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
```

Nếu Kafka crash ngay sau dòng `port is deprecated...`, thường là do xung đột biến môi trường `KAFKA_*` do Kubernetes tự inject. Manifest đã tắt `service links` cho pod Kafka. Áp dụng lại:

```bash
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
sudo k3s kubectl -n realtime rollout restart deploy/kafka
sudo k3s kubectl -n realtime rollout status deploy/kafka
```

### D. `producer` hiện `Completed`

`producer` tự thoát khi không kết nối được Kafka. Sau khi Kafka `Running`, pod producer sẽ chạy lại bình thường.

---

## 8) Ghi chú

- Manifest này phù hợp demo/local single-node.
- Thành phần stateful (Kafka/Postgres) chưa tối ưu production.
- Với production, nên tách thành `StatefulSet`, storage class phù hợp, và hardening mạng/bảo mật.
