# Commands

> Tất cả lệnh chạy từ thư mục `infra/`
>
> ```powershell
> cd infra
> ```

---

## 1. Build images

Build toàn bộ 6 images từ source:

```powershell
docker-compose build
```

Build lại 1 service cụ thể:

```powershell
docker-compose build <service>
# Ví dụ:
docker-compose build dashboard-api
docker-compose build generator-ui
```

---

## 2. Chạy hệ thống

Start toàn bộ (dùng images đã build, không rebuild):

```powershell
docker-compose up -d
```

Kiểm tra trạng thái containers:

```powershell
docker-compose ps
```

Xem logs realtime:

```powershell
docker-compose logs -f
docker-compose logs -f <service>   # log 1 service cụ thể
```

Truy cập:

| Service             | URL                   |
| ------------------- | --------------------- |
| Analytics Dashboard | http://localhost:5173 |
| Generator UI        | http://localhost:5174 |
| Dashboard API       | http://localhost:8080 |
| Generator API       | http://localhost:7070 |

---

## 3. Tắt hệ thống

Dừng và xóa containers, giữ nguyên data (volumes):

```powershell
docker-compose down
```

---

## 4. Tùy chọn — Xóa cache & volumes

### Xóa data (volumes)

```powershell
# Xóa containers + toàn bộ data (PostgreSQL, Kafka, Spark checkpoints)
docker-compose down -v
```

### Xóa images của project

```powershell
docker images --filter "reference=infra-*" -q | ForEach-Object { docker rmi $_ -f }
```

### Xóa build cache

```powershell
docker builder prune -f     # chỉ xóa cache không dùng
docker builder prune -af    # xóa toàn bộ build cache
```

### Full clean — xóa tất cả

```powershell
docker-compose down -v --remove-orphans
docker images --filter "reference=infra-*" -q | ForEach-Object { docker rmi $_ -f }
docker builder prune -af
```

### Kiểm tra sau khi xóa

```powershell
docker images --filter "reference=infra-*"   # phải trống
docker volume ls                              # postgres-data, kafka-data, spark-checkpoints đã biến mất
docker builder du                             # build cache = 0B
```
