# 🚀 E-commerce Realtime Data Pipeline

Nền tảng realtime demo cho e-commerce, gồm luồng tạo event → Kafka → Spark → PostgreSQL → Dashboard.

---

## 📖 Giới Thiệu

Project mô phỏng pipeline dữ liệu realtime với 2 UI:

- **Generator UI** để phát event thủ công/auto
- **Dashboard UI** để theo dõi KPI và health

Luồng xử lý chính:

`generator-ui` → `generator-api` (queue) → `producer-poller` (drain batch) → `kafka(events_raw)` → `spark-streaming` → `postgres(events_clean, kpi_1m)` → `dashboard-api` → `frontend`

---

## ✨ Tính năng chính

- Event queue + batch drain endpoint (`/gen/drain`) để tăng throughput
- Spark Structured Streaming (validate, deduplicate, window KPI)
- KPI 1 phút lưu vào `kpi_1m` và upsert an toàn
- Dashboard API cho KPI/time-series/events/metrics/health
- Hỗ trợ chạy bằng **Docker Compose** và **K3s (WSL)**

---

## 🏗️ Thành phần hệ thống

- `services/generator-api` (Node.js, port 7070)
- `services/producer-poller` (Python)
- `services/spark-streaming` (PySpark + Java)
- `services/dashboard-api` (Node.js, port 8080)
- `frontend` (React + Nginx, port 5173)
- `generator-ui` (React + Nginx, port 5174)
- `kafka`, `zookeeper`, `postgres`

---

## 🚀 Cách chạy

### 1) Docker Compose

Xem lệnh đầy đủ ở [docs/COMMANDS.md](COMMANDS.md).

URL mặc định:

- Dashboard UI: `http://localhost:5173`
- Generator UI: `http://localhost:5174`
- Dashboard API: `http://localhost:8080/health`
- Generator API: `http://localhost:7070/health`

### 2) K3s (WSL)

Xem hướng dẫn chi tiết ở [k8s/README.md](../k8s/README.md).

Với WSL2 + NodePort, truy cập qua `WSL_IP`:

- Generator API: `http://<WSL_IP>:30070/health`
- Dashboard API: `http://<WSL_IP>:30080/health`
- Dashboard UI: `http://<WSL_IP>:30173`
- Generator UI: `http://<WSL_IP>:30174`

---

## 📁 Cấu trúc thư mục

```text
services/
  generator-api/
  producer-poller/
  spark-streaming/
  dashboard-api/
frontend/
generator-ui/
infra/
  docker-compose.yml
  postgres/init.sql
k8s/
  k3s-stack.yaml
  README.md
docs/
  INTRODUCTION.md
  COMMANDS.md
  ARCHITECTURE.md
```

---

## 📚 Tài liệu liên quan

- [docs/COMMANDS.md](COMMANDS.md)
- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [k8s/README.md](../k8s/README.md)

- Apache Kafka & Spark communities
- React & Vite teams
- Docker & Confluent
