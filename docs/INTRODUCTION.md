# 🚀 E-commerce Realtime Data Pipeline

> **Full-stack realtime analytics platform**: Event-driven architecture với Kafka, Spark Streaming, và React Dashboard

[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://www.docker.com/)
[![React](https://img.shields.io/badge/React-18.3-blue)](https://reactjs.org/)
[![Apache Kafka](https://img.shields.io/badge/Kafka-7.5-red)](https://kafka.apache.org/)
[![Apache Spark](https://img.shields.io/badge/Spark-3.5-orange)](https://spark.apache.org/)

---

## 📖 Giới Thiệu

Hệ thống xử lý và phân tích dữ liệu **realtime** cho nền tảng thương mại điện tử. Xử lý hàng triệu events/giây với độ trễ dưới 1 giây, tính toán KPI theo thời gian thực và hiển thị trên dashboard tương tác.

### ✨ Features

- 📊 **Realtime Analytics Dashboard** - Hiển thị GMV, order rate, success rate cập nhật liên tục
- ⚡ **Stream Processing** - Xử lý events với độ trễ < 1s bằng Spark Structured Streaming
- 🎨 **Event Generator UI** - Control panel để tạo events với custom parameters
- 🔄 **Auto-scaling Pipeline** - Tự động scale theo volume dữ liệu
- 📈 **Multi-timeframe KPI** - Analytics theo 1 phút, 15 phút, 1 giờ, 24 giờ
- 🐳 **Full Docker** - Deploy toàn bộ hệ thống với 1 lệnh

### 🎯 Use Cases

- ✅ **UC03**: Parse & Validate Events
- ✅ **UC04**: Clean & Deduplicate
- ✅ **UC05**: Calculate KPIs (windowing aggregation)
- ✅ **UC06**: Persist to PostgreSQL

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────┐    HTTP GET     ┌──────────────────┐
│ Event Generator │ ◄───────────────│ Producer Poller  │
│   (Node.js)     │                 │    (Python)      │
└─────────────────┘                 └────────┬─────────┘
                                             │ Produce
                                             ▼
                                    ┌──────────────────┐
                                    │   Kafka Broker   │
                                    │  (events_raw)    │
                                    └────────┬─────────┘
                                             │ Stream
                                             ▼
                                    ┌──────────────────┐
                                    │ Spark Streaming  │
                                    │ UC03-UC06 Jobs   │
                                    └────────┬─────────┘
                                             │ Write
                                             ▼
                                    ┌──────────────────┐
                                    │   PostgreSQL     │
                                    │ events_clean +   │
                                    │ kpi_1m tables    │
                                    └────────┬─────────┘
                                             │ Query
                                             ▼
                                    ┌──────────────────┐
                                    │ React Dashboard  │
                                    │   (Port 5173)    │
                                    └──────────────────┘
```

**Pipeline Flow:**

1. **Event Generator** → REST API tạo events với distribution 30-25-35-8-2%
2. **Producer Poller** → Poll API mỗi 100ms và push vào Kafka
3. **Kafka Broker** → Message queue (topic: `events_raw`)
4. **Spark Streaming** → Real-time processing (validate, clean, aggregate)
5. **PostgreSQL** → Persist events và KPI tables
6. **React Dashboards** → Visualize realtime analytics

---

## 🛠️ Tech Stack

### Backend

- **Apache Kafka 7.5** - Distributed streaming platform
- **Apache Spark 3.5** - Stream processing với Structured Streaming
- **PostgreSQL 15** - Relational database
- **Python 3.11** - Spark jobs & Producer
- **Node.js 20** - Event Generator REST API

### Frontend

- **React 18.3** - UI framework
- **TypeScript 5.3** - Type safety
- **Vite 5.4** - Build tool & dev server
- **TailwindCSS 3.4** - Utility-first CSS

### DevOps

- **Docker & Docker Compose** - Containerization (8 services)
- **Nginx** - Production web server cho frontends

---

## 🚀 Quick Start

**Yêu cầu:** Docker Desktop 20.10+

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Start tất cả (1 lệnh)
cd infra && docker-compose up -d --build

# Chờ 60s, sau đó truy cập:
# - Generator UI: http://localhost:5174
# - Dashboard:    http://localhost:5173
# - API:          http://localhost:7070
```

**📚 Lệnh đầy đủ:** [docs/COMMANDS.md](COMMANDS.md)

---

## 📁 Cấu Trúc Project

```
ecommerce-realtime-pipeline/
│
├── services/
│   ├── generator-api/          # Node.js REST API (port 7070)
│   ├── producer-poller/        # Python Kafka Producer
│   └── spark-streaming/        # Spark Streaming Jobs
│
├── clients/
│   ├── dashboard/              # Analytics Dashboard (port 5173)
│   └── generator/              # Generator Control UI (port 5174)
│
├── infra/
│   ├── docker-compose.yml      # 🐳 8 services
│   └── postgres/init.sql       # Database schema
│
├── docs/
│   ├── INTRODUCTION.md         # 👈 BẠN ĐANG ĐỌC
│   ├── COMMANDS.md             # Tất cả Docker commands
│   └── ARCHITECTURE.md         # System design
│
└── README.md                   # Lịch sử thay đổi & bug fixes
```

---

## 📊 Services Overview

| Service           | Container          | Port | Tech          | Description            |
| ----------------- | ------------------ | ---- | ------------- | ---------------------- |
| **Zookeeper**     | zookeeper          | 2181 | Confluent     | Kafka coordination     |
| **Kafka**         | kafka              | 9092 | Confluent     | Event streaming broker |
| **PostgreSQL**    | postgres           | 5432 | Alpine        | Database               |
| **Generator API** | api-generator      | 7070 | Node.js       | Event REST API         |
| **Producer**      | producer-poller    | -    | Python        | API → Kafka            |
| **Spark**         | spark-streaming    | -    | Python + Java | Stream processing      |
| **Generator UI**  | generator-ui       | 5174 | React + Nginx | Control dashboard      |
| **Dashboard**     | frontend-dashboard | 5173 | React + Nginx | Analytics UI           |

---

## 🎬 Demo

### Tạo Events

```bash
# Single event
curl http://localhost:7070/gen/event

# Batch 100 events
curl -X POST http://localhost:7070/gen/emit \
  -H "Content-Type: application/json" \
  -d '{"count": 100}'
```

### Xem Kafka Stream

```bash
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic events_raw \
  --from-beginning
```

### Query Database

```bash
docker exec -it postgres psql -U app -d realtime -c \
  "SELECT event_type, COUNT(*) FROM events_clean GROUP BY event_type;"
```

---

## 📚 Documentation

- **[COMMANDS.md](COMMANDS.md)** 🛠️ - Tất cả Docker commands
- **[ARCHITECTURE.md](ARCHITECTURE.md)** 🏗️ - System architecture & design

---

## 🐛 Troubleshooting

**Services không start:**

```bash
cd infra
docker-compose ps        # Check status
docker-compose logs -f   # View logs
```

**Reset toàn bộ:**

```bash
cd infra
docker-compose down -v   # Delete all data
docker-compose up -d --build
```

**👉 Chi tiết:** [COMMANDS.md](COMMANDS.md)

---

## 📝 Development

### Local Development

```bash
# Stop production containers
cd infra && docker-compose stop generator-ui

# Run dev mode with hot reload
cd generator-ui && npm run dev
```

### Add New Service

1. Tạo Dockerfile trong `services/your-service/`
2. Add service vào `infra/docker-compose.yml`
3. Rebuild: `docker-compose up -d --build your-service`

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork repository
2. Create feature branch: `git checkout -b feature/AmazingFeature`
3. Commit changes: `git commit -m 'Add AmazingFeature'`
4. Push to branch: `git push origin feature/AmazingFeature`
5. Open Pull Request

---

## 🙏 Acknowledgments

- Apache Kafka & Spark communities
- React & Vite teams
- Docker & Confluent
