# ⚡ Quick Start Guide

> **Mục tiêu**: Chạy toàn bộ hệ thống trong 5 phút

---

## 📋 Yêu Cầu

- **Docker Desktop** 20.10+
- **Docker Compose** 2.0+

---

## 🚀 Setup 3 Bước

### 1️⃣ Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2️⃣ Start Tất Cả Services

**Cách 1 - Simple:**
```bash
docker-start.bat
```

**Cách 2 - Manual:**
```bash
cd infra
docker-compose up -d --build
```

### 3️⃣ Chờ & Truy Cập

Chờ **30-60 giây** để các services khởi động, sau đó:

- 🎨 **Generator UI**: http://localhost:5174
- 📊 **Dashboard**: http://localhost:5173
- 🔧 **API Health**: http://localhost:7070/health

---

## ✅ Verify Hệ Thống

### Check Services
```bash
cd infra
docker-compose ps
```

**Tất cả containers phải có status "Up" và "healthy":**
```
NAME                    STATE     HEALTH
api-generator           running   healthy
frontend-dashboard      running   healthy
generator-ui            running   healthy
kafka                   running   healthy
postgres                running   healthy
producer-poller         running   -
spark-streaming         running   -
zookeeper               running   -
```

### Test Event Flow

1. **Generate Event**: Mở http://localhost:5174 → Click "Quick Emit"
2. **Check Kafka**:
   ```bash
   docker exec -it kafka kafka-console-consumer \
     --bootstrap-server localhost:9092 \
     --topic events_raw \
     --from-beginning \
     --max-messages 5
   ```
3. **Check PostgreSQL**:
   ```bash
   docker exec -it postgres psql -U app -d realtime -c \
     "SELECT event_type, COUNT(*) FROM events_clean GROUP BY event_type;"
   ```
4. **View Dashboard**: Mở http://localhost:5173 → Xem KPI realtime

---

## 🎬 Demo Flow

```bash
# 1. Start system
docker-start.bat

# 2. Wait 60 seconds
Start-Sleep -Seconds 60

# 3. Generate 100 events
curl -X POST http://localhost:7070/gen/emit -H "Content-Type: application/json" -d '{"count": 100}'

# 4. View dashboard
start http://localhost:5173
```

---

## 🛑 Stop Services

```bash
docker-stop.bat
```

Hoặc:

```bash
cd infra
docker-compose down
```

**Xóa tất cả data (reset):**
```bash
cd infra
docker-compose down -v  # Delete volumes
```

---

## 🐛 Troubleshooting

### Port Already in Use

**Error**: `Bind for 0.0.0.0:7070 failed: port is already allocated`

**Fix**:
```bash
netstat -ano | findstr :7070
taskkill /PID <PID> /F
docker-compose up -d
```

### Kafka Not Ready

**Error**: `NoBrokersAvailable`

**Fix**:
```bash
cd infra
docker-compose restart kafka
docker-compose logs -f kafka  # Wait for "started"
```

### Container Unhealthy

**Check logs:**
```bash
cd infra
docker-compose logs -f producer       # Producer logs
docker-compose logs -f spark-streaming # Spark logs
docker-compose logs -f api-generator   # API logs
```

### No Data in Dashboard

**Checklist:**
1. ✅ Producer running: `docker-compose logs producer | findstr "Produced"`
2. ✅ Spark processing: `docker-compose logs spark-streaming | findstr "batch"`
3. ✅ Database populated: `docker exec -it postgres psql -U app -d realtime -c "SELECT COUNT(*) FROM events_clean;"`

---

## 📊 Services & Ports

| Service | Port | URL |
|---------|------|-----|
| Generator UI | 5174 | http://localhost:5174 |
| Dashboard | 5173 | http://localhost:5173 |
| Generator API | 7070 | http://localhost:7070 |
| Kafka | 9092 | localhost:9092 |
| PostgreSQL | 5432 | localhost:5432 |
| Zookeeper | 2181 | localhost:2181 |

---

## 🔧 Advanced

### View Logs
```bash
cd infra
docker-compose logs -f              # All services
docker-compose logs -f producer     # Specific service
```

### Restart Service
```bash
cd infra
docker-compose restart producer
```

### Rebuild Service
```bash
cd infra
docker-compose up -d --build producer
```

### Access Container
```bash
docker exec -it producer-poller sh
docker exec -it postgres psql -U app -d realtime
```

---

## 📚 Next Steps

- **Chi tiết Docker**: [DOCKER_SETUP.md](DOCKER_SETUP.md)
- **Kiến trúc hệ thống**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Về project**: [../README.md](../README.md)

---

**🎉 Chúc mừng! Hệ thống đang chạy realtime!**
