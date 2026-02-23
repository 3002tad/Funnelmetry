# 🐳 Docker Setup - Complete Guide

## 🎯 Giới Thiệu

Toàn bộ hệ thống đã được **dockerized** - bạn chỉ cần **1 lệnh duy nhất** để chạy tất cả:

```powershell
cd infra
docker-compose up -d
```

---

## 📦 Containers

| Service | Container Name | Port | Description |
|---------|---------------|------|-------------|
| **Zookeeper** | zookeeper | 2181 | Kafka coordination |
| **Kafka** | kafka | 9092 | Event streaming |
| **PostgreSQL** | postgres | 5432 | Database |
| **Generator API** | api-generator | 7070 | Event REST API |
| **Producer** | producer-poller | - | Poll API → Kafka |
| **Spark Streaming** | spark-streaming | - | Kafka → Postgres |
| **Generator UI** | generator-ui | 5174 | Control dashboard |
| **Frontend** | frontend-dashboard | 5173 | Analytics dashboard |

**Tổng cộng: 8 containers**

---

## 🚀 Quick Start

### 1️⃣ Start Tất Cả (Recommended)

```powershell
# Di chuyển vào thư mục infra
cd infra

# Build và start tất cả containers
docker-compose up -d --build

# Xem logs
docker-compose logs -f
```

**Chờ 30-60 giây** để các services khởi động đầy đủ.

### 2️⃣ Kiểm Tra Status

```powershell
# Xem tất cả containers đang chạy
docker-compose ps

# Kiểm tra health của từng service
docker-compose ps --format json | ConvertFrom-Json | Select-Object Name, State, Health
```

**Output mong đợi:**
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

### 3️⃣ Truy Cập Services

Mở browser:
- **Generator UI**: http://localhost:5174
- **Dashboard**: http://localhost:5173
- **API**: http://localhost:7070/health

### 4️⃣ Stop Tất Cả

```powershell
cd infra
docker-compose down
```

**Xóa volumes (reset database)**:
```powershell
docker-compose down -v
```

---

## 🔍 Debugging & Logs

### Xem Logs của Service Cụ Thể

```powershell
# Producer logs
docker-compose logs -f producer

# Spark logs
docker-compose logs -f spark-streaming

# API logs
docker-compose logs -f api-generator

# Tất cả logs
docker-compose logs -f
```

### Vào Bên Trong Container

```powershell
# PostgreSQL
docker exec -it postgres psql -U app -d realtime

# Kafka consumer test
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic events_raw \
  --from-beginning \
  --max-messages 10
```

### Restart Service

```powershell
# Restart 1 service
docker-compose restart producer

# Restart tất cả
docker-compose restart
```

---

## 🛠️ Build & Development

### Build Lại Container

```powershell
# Build lại tất cả
docker-compose build --no-cache

# Build lại 1 service
docker-compose build --no-cache api-generator
```

### Development Mode

Nếu muốn develop và auto-reload:

```powershell
# 1. Stop production container
docker-compose stop generator-ui

# 2. Run dev mode locally
cd ../generator-ui
npm run dev
```

---

## 📊 Monitoring

### Resource Usage

```powershell
# CPU & Memory usage
docker stats

# Disk usage
docker system df
```

### Check Kafka Topics

```powershell
docker exec -it kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --list

# Check topic details
docker exec -it kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic events_raw
```

### Query PostgreSQL

```powershell
docker exec -it postgres psql -U app -d realtime -c "
  SELECT 
    event_type, 
    COUNT(*) as count 
  FROM events_clean 
  GROUP BY event_type 
  ORDER BY count DESC;
"
```

---

## ⚠️ Troubleshooting

### ❌ Port Already in Use

**Error**: `Bind for 0.0.0.0:7070 failed: port is already allocated`

**Solution**:
```powershell
# Kiểm tra process đang dùng port
netstat -ano | findstr :7070

# Kill process
taskkill /PID <PID> /F

# Hoặc đổi port trong docker-compose.yml
```

### ❌ Kafka Not Ready

**Error**: `NoBrokersAvailable`

**Solution**:
```powershell
# Check Kafka logs
docker-compose logs kafka | Select-String "started"

# Restart Kafka
docker-compose restart kafka

# Wait 30s
Start-Sleep -Seconds 30
```

### ❌ Out of Memory

**Error**: `Container killed due to memory pressure`

**Solution**:
```powershell
# Increase Docker Desktop memory
# Settings → Resources → Memory: 8GB+

# Or limit container memory in docker-compose.yml
services:
  spark-streaming:
    deploy:
      resources:
        limits:
          memory: 4G
```

### ❌ Build Failed

**Error**: `failed to solve with frontend dockerfile.v0`

**Solution**:
```powershell
# Clear Docker cache
docker builder prune -a

# Rebuild
docker-compose build --no-cache
```

---

## 🔧 Configuration

### Environment Variables

Edit `infra/docker-compose.yml`:

```yaml
services:
  producer:
    environment:
      POLL_INTERVAL_MS: 1000  # Change poll rate
      
  api-generator:
    environment:
      NODE_ENV: development   # Enable debug logs
```

### Custom Ports

```yaml
services:
  frontend:
    ports:
      - "8080:5173"  # Expose 8080 instead of 5173
```

---

## 📋 Service Dependencies

```
zookeeper
   ↓
kafka ─────────────┐
   ↓               ↓
api-generator → producer
   ↓               ↓
postgres ← spark-streaming
   ↓
frontend
```

**Health checks đảm bảo services start đúng thứ tự.**

---

## 🎓 Production Deployment

### Docker Compose Production

```yaml
# docker-compose.prod.yml
services:
  api-generator:
    environment:
      NODE_ENV: production
    restart: always
    
  kafka:
    environment:
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 3
    deploy:
      replicas: 3
```

Run:
```powershell
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### CI/CD với GitHub Actions

```yaml
# .github/workflows/docker.yml
name: Build & Push Docker Images

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build images
        run: docker-compose build
        
      - name: Push to registry
        run: docker-compose push
```

---

## 📚 Related Docs

- [SETUP.md](SETUP.md) - Manual setup (without Docker)
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [docker-compose.yml](../infra/docker-compose.yml) - Docker configuration

---

## ✅ Checklist

Sau khi start, verify:

- [ ] `docker-compose ps` shows 8 containers running
- [ ] http://localhost:5174 Generator UI loads
- [ ] http://localhost:5173 Dashboard loads  
- [ ] http://localhost:7070/health returns 200
- [ ] `docker-compose logs producer` shows events being produced
- [ ] `docker-compose logs spark-streaming` shows batches processing
- [ ] PostgreSQL has data: `docker exec -it postgres psql -U app -d realtime -c "SELECT COUNT(*) FROM events_clean;"`

---

**🎉 Congratulations! Toàn bộ pipeline đang chạy trong Docker!**
