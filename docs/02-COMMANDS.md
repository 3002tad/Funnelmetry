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

---

## 5. Chạy bằng Kubernetes (K3s)

### 5.1 Build Images

```powershell
cd infra
docker-compose build api-generator producer spark-streaming dashboard-api frontend generator-ui
```

### 5.2 Load Images into K3s

K3s uses containerd, not Docker. Must explicitly load images:

```bash
# From WSL bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/infra

docker save infra-api-generator:latest | sudo k3s ctr images import -
docker save infra-producer:latest | sudo k3s ctr images import -
docker save infra-spark-streaming:latest | sudo k3s ctr images import -
docker save infra-dashboard-api:latest | sudo k3s ctr images import -
docker save infra-frontend:latest | sudo k3s ctr images import -
docker save infra-generator-ui:latest | sudo k3s ctr images import -

# Verify
sudo k3s ctr images list
```

### 5.3 Deploy K3s Stack

Wait for K3s to be ready (60 seconds after startup):

```bash
# Check K3s is Ready
sudo k3s kubectl get nodes

# Deploy
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
sudo k3s kubectl create namespace realtime 2>/dev/null || true
sudo k3s kubectl apply -f k8s/k3s-stack.yaml

# Monitor
sudo k3s kubectl get pods -n realtime -w
```

### 5.4 Check Deployment Status

```bash
# All pods
sudo k3s kubectl get pods -n realtime

# All services
sudo k3s kubectl get svc -n realtime

# Specific pod logs
sudo k3s kubectl logs -n realtime deploy/<service>
```

### 5.5 Restart Deployments

```bash
# Restart all
sudo k3s kubectl -n realtime rollout restart deployment

# Restart specific
sudo k3s kubectl -n realtime rollout restart deploy/api-generator
```

### 5.6 Access Services (NodePort)

From Windows PowerShell:

```powershell
# Get WSL IP
$WSL_IP = wsl.exe -e bash -c "hostname -I | awk '{print `$1}'"
Write-Host "WSL IP: $WSL_IP"

# Access services
# http://$WSL_IP:30070   (generator-api)
# http://$WSL_IP:30080   (dashboard-api)
# http://$WSL_IP:30173   (dashboard UI)
# http://$WSL_IP:30174   (generator UI)
```

Or from WSL:

```bash
# Get WSL IP
hostname -I

# Access from Windows browser
# http://<WSL_IP>:30070
```

### 5.7 Delete K3s Resources

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline
sudo k3s kubectl delete -f k8s/k3s-stack.yaml
```

### 5.8 Cleanup & Reset

```bash
# Delete namespace (removes all pods/services/pvcs)
sudo k3s kubectl delete namespace realtime

# Full K3s reset (WARNING: removes all K3s data)
sudo systemctl stop k3s
sudo rm -rf /var/lib/rancher/k3s /etc/rancher/k3s
sudo systemctl start k3s
sleep 90
```

**See [06-TROUBLESHOOTING.md](06-TROUBLESHOOTING.md) for common K3s issues.**
