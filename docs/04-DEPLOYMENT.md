# ⚙️ Kubernetes (K3s) Deployment Guide

Complete guide for deploying the realtime pipeline on **Windows + Ubuntu WSL + K3s**.

---

## Prerequisites

### System Requirements

- **OS:** Windows 10/11 + WSL2 + Ubuntu 22.04 LTS
- **Resources:**
  - 4+ vCPU
  - 8+ GB RAM (16GB recommended)
  - 20+ GB free disk space
- **Tools:** Docker Desktop, PowerShell 7+

### K3s Setup

Verify K3s is running in WSL:

```bash
# WSL Ubuntu
sudo systemctl status k3s
sudo k3s kubectl get nodes
```

Expected output: Node in `Ready` state.

If K3s not installed, install it:

```bash
curl -sfL https://get.k3s.io | sh -
sudo systemctl enable k3s
sudo systemctl start k3s
```

---

## Step 1: Build Docker Images

### Option A: Automated (Recommended)

From Windows PowerShell:

```powershell
cd D:\Detai\Business-Data-Streaming---Processing-Pipeline
.\deploy-k3s.ps1
```

This script automatically:
- Builds all Docker images
- Deploys K3s manifest
- Displays access URLs

### Option B: Manual Build

```bash
cd D:\Detai\Business-Data-Streaming---Processing-Pipeline\infra
docker-compose build api-generator producer spark-streaming dashboard-api frontend generator-ui
```

---

## Step 2: Deploy to K3s

### Quick Deploy (Automated)

```powershell
.\deploy-k3s.ps1
```

### Manual Deploy

#### In WSL Ubuntu:

```bash
cd /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline

# Apply manifest
sudo k3s kubectl apply -f k8s/k3s-stack.yaml

# Wait for pods to initialize
sleep 30

# Check status
sudo k3s kubectl get pods -n realtime
sudo k3s kubectl get svc -n realtime
```

#### Monitor Rollout:

```bash
# Watch individual deployments
sudo k3s kubectl -n realtime rollout status deploy/postgres
sudo k3s kubectl -n realtime rollout status deploy/kafka
sudo k3s kubectl -n realtime rollout status deploy/api-generator
sudo k3s kubectl -n realtime rollout status deploy/spark-streaming
sudo k3s kubectl -n realtime rollout status deploy/dashboard-api
sudo k3s kubectl -n realtime rollout status deploy/frontend
sudo k3s kubectl -n realtime rollout status deploy/generator-ui

# Or watch all pods live
sudo k3s kubectl -n realtime get pods -w
```

---

## Step 3: Access Services

### Get WSL IP

```bash
wsl.exe hostname -I
```

### Access URLs (via NodePort)

Replace `<WSL_IP>` with actual IP from above:

| Service | URL | Port |
|---------|-----|------|
| Dashboard UI | http://<WSL_IP>:30173 | NodePort 30173 |
| Generator UI | http://<WSL_IP>:30174 | NodePort 30174 |
| Generator API | http://<WSL_IP>:30070/health | NodePort 30070 |
| Dashboard API | http://<WSL_IP>:30080/health | NodePort 30080 |

### Alternative: Port Forwarding

If NodePort doesn't work, use port forwarding:

```bash
# Terminal 1
sudo k3s kubectl -n realtime port-forward svc/frontend 5173:5173

# Terminal 2
sudo k3s kubectl -n realtime port-forward svc/generator-ui 5174:5174

# Terminal 3
sudo k3s kubectl -n realtime port-forward svc/dashboard-api 8080:8080

# Terminal 4
sudo k3s kubectl -n realtime port-forward svc/api-generator 7070:7070
```

Then access via `http://localhost:5173`, etc.

---

## Step 4: Monitor & Manage

### Helper Script

Use `k8s-helper.sh` for common operations:

```bash
chmod +x k8s-helper.sh

# View available commands
./k8s-helper.sh help

# Examples:
./k8s-helper.sh status      # Show pods/services
./k8s-helper.sh watch       # Live pod monitoring
./k8s-helper.sh logs <pod>  # View pod logs
./k8s-helper.sh health      # Test API endpoints
./k8s-helper.sh ip          # Show access URLs
```

### Manual Commands

```bash
# Pod status
sudo k3s kubectl get pods -n realtime
sudo k3s kubectl get pods -n realtime -o wide

# Service status
sudo k3s kubectl get svc -n realtime

# Pod logs
sudo k3s kubectl logs -n realtime <pod-name>
sudo k3s kubectl logs -n realtime <pod-name> -f  # follow

# Pod events
sudo k3s kubectl describe pod -n realtime <pod-name>

# Resource usage
sudo k3s kubectl top pods -n realtime
sudo k3s kubectl top nodes

# Restart deployment
sudo k3s kubectl -n realtime rollout restart deploy/<deployment>

# Scale deployment
sudo k3s kubectl -n realtime scale deploy/<deployment> --replicas=2
```

---

## Troubleshooting

### Issue: Pod stuck in `Pending`

**Cause:** Insufficient resources or image not found.

```bash
# Check events
sudo k3s kubectl describe pod -n realtime <pod-name>

# Check node resources
sudo k3s kubectl describe node

# Check images available
sudo k3s ctr images ls
```

### Issue: Kafka won't start - `InconsistentClusterIdException`

**Cause:** Stale Kafka broker data.

```bash
# Delete Kafka PVC to reset
sudo k3s kubectl -n realtime delete deploy kafka zookeeper
sudo k3s kubectl -n realtime delete pvc kafka-data zookeeper-data

# Re-apply manifest
sudo k3s kubectl apply -f k8s/k3s-stack.yaml

# Wait for startup
sudo k3s kubectl -n realtime rollout status deploy/kafka
```

### Issue: Postgres shows `CrashLoopBackOff`

**Cause:** Init SQL script failed or PVC issues.

```bash
# Check logs
sudo k3s kubectl logs -n realtime deploy/postgres

# Delete and re-create
sudo k3s kubectl -n realtime delete deploy postgres
sudo k3s kubectl -n realtime delete pvc postgres-data

# Re-apply
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
```

### Issue: Producer pod keeps restarting

**Cause:** Kafka not yet ready, or producer can't connect.

This is normal! Once Kafka is healthy, producer will stabilize.

```bash
# Check if Kafka is healthy
sudo k3s kubectl -n realtime rollout status deploy/kafka

# Check producer logs
sudo k3s kubectl logs -n realtime deploy/producer --previous
```

### Issue: Frontend shows "Cannot connect to API"

**Cause:** DNS resolution or nginx proxy issue.

```bash
# Test API directly
curl http://<WSL_IP>:30080/health

# Check frontend logs
sudo k3s kubectl logs -n realtime deploy/frontend

# Restart frontend nginx
sudo k3s kubectl -n realtime rollout restart deploy/frontend
```

### Issue: `Cannot GET /` when accessing dashboard API

**This is expected!** Dashboard API is a backend service, not a web server.

- ✅ Correct: `http://<WSL_IP>:30080/api/kpi`
- ✅ Correct: `http://<WSL_IP>:30080/health`
- ❌ Wrong: `http://<WSL_IP>:30080/` (returns 404)

---

## Production Considerations

This K3s setup is for **development/demo only**. For production:

### Persistence

- Use `StorageClass` with proper backing store (NFS, ceph, cloud volumes)
- Current setup uses `emptyDir` (lost on pod restart)

### High Availability

- Current: Single-node K3s
- Production: Multi-node cluster with HA K3s

### Networking

- Current: NodePort services
- Production: Ingress controller + TLS certificates

### Monitoring

- Add Prometheus + Grafana
- Use `/metrics` endpoints from API services

### Security

- Enable RBAC
- Use network policies
- Implement pod security policies
- Scan images for vulnerabilities

### Kafka/Postgres

Current manifests use simple `Deployment` + `PVC`:
- Production: Use `StatefulSet` for Kafka & Postgres
- Add resource requests/limits
- Implement backup strategy

---

## Cleanup

### Remove All Resources

```bash
# Delete namespace (removes all resources inside)
sudo k3s kubectl delete namespace realtime

# Or delete specific manifest
sudo k3s kubectl delete -f k8s/k3s-stack.yaml
```

### Reset K3s (Extreme Case)

```bash
# Stop K3s service
sudo systemctl stop k3s

# Clean everything
sudo rm -rf /var/lib/rancher/k3s /etc/rancher/k3s ~/.kube

# Start K3s fresh
sudo systemctl start k3s
```

---

## Migration from Docker Compose to K3s

If you have data in Docker Compose that you want to preserve:

1. **Export Postgres data** from Docker Compose container
2. **Create Postgres dump**:
   ```bash
   docker exec <postgres-container> pg_dump -U app realtime > backup.sql
   ```
3. **Import into K3s Postgres**:
   ```bash
   # Copy dump to pod
   sudo k3s kubectl cp backup.sql -n realtime <postgres-pod>:/tmp/
   
   # Restore
   sudo k3s kubectl exec -n realtime <postgres-pod> -- \
     psql -U app realtime < /tmp/backup.sql
   ```

---

## Next Steps

1. Verify all pods are running: `./k8s-helper.sh status`
2. Test API health: `./k8s-helper.sh health`
3. Access Dashboard UI
4. Start emitting events
5. Monitor via `./k8s-helper.sh watch`

---

**Last updated:** 2026-03-22
