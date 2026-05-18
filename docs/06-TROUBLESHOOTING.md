# 🔧 Troubleshooting Guide

Complete troubleshooting for Business Data Streaming Pipeline.

---

## WSL + K3s Issues

### 1. systemd Not Running

**Error:**
```
System has not been booted with systemd as init system (PID 1). Can't operate.
```

**Fix:**

Edit `/etc/wsl.conf`:

```bash
sudo nano /etc/wsl.conf
```

Set:

```ini
[boot]
systemd=true
```

Restart:

```powershell
wsl --shutdown
wsl -e bash
```

---

### 2. K3s cgroupv2 Error

**Error:**
```
Failed to start ContainerManager: system validation failed - wrong number of fields (expected 6, got 7)
```

**Cause:** WSL2 cgroupv2 incompatibility

**Fix:**

```bash
sudo mkdir -p /etc/systemd/system/k3s.service.d
sudo tee /etc/systemd/system/k3s.service.d/override.conf > /dev/null <<EOF
[Service]
Environment="K3S_KUBELET_ARGS=--cgroups-per-qos=false --enforce-node-allocatable="
EOF

sudo systemctl daemon-reload
sudo systemctl restart k3s
sleep 60
sudo k3s kubectl get nodes
```

---

### 3. K3s API Server Not Ready

**Error:**
```
error validating "k8s/k3s-stack.yaml": error validating data: failed to download openapi
```

**Fix:**

Wait longer for K3s startup:

```bash
sleep 90  # or more

# Check
sudo k3s kubectl get nodes  # Should show Ready

# Then deploy
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
```

---

### 4. ImagePullBackOff / ErrImagePull

**Error:** Pods stuck with `ImagePullBackOff` status

**Cause:** K3s can't find Docker images

**Fix - Load images:**

```bash
cd infra

# Build images first
docker-compose build

# Load into K3s
docker save infra-api-generator:latest | sudo k3s ctr images import -
docker save infra-producer:latest | sudo k3s ctr images import -
docker save infra-spark-streaming:latest | sudo k3s ctr images import -
docker save infra-dashboard-api:latest | sudo k3s ctr images import -
docker save infra-frontend:latest | sudo k3s ctr images import -
docker save infra-generator-ui:latest | sudo k3s ctr images import -

# Restart pods
sudo k3s kubectl rollout restart deployment -n realtime
sleep 30
sudo k3s kubectl get pods -n realtime
```

---

## Pods & Services Issues

### 1. Kafka CrashLoopBackOff

**Cause:** Stale Kafka data

**Fix:**

```bash
# Delete Kafka + PVC
sudo k3s kubectl delete deployment kafka -n realtime
sudo k3s kubectl delete deployment zookeeper -n realtime
sudo k3s kubectl delete pvc kafka-data zookeeper-data -n realtime
sleep 15

# Redeploy
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
sleep 60
sudo k3s kubectl get pods -n realtime
```

---

### 2. Postgres CrashLoopBackOff

**Cause:** Init script failure or PVC issues

**Fix:**

```bash
# Delete Postgres pod + PVC
sudo k3s kubectl delete deployment postgres -n realtime
sudo k3s kubectl delete pvc postgres-data -n realtime
sleep 15

# Redeploy
sudo k3s kubectl apply -f k8s/k3s-stack.yaml
sleep 60

# Check logs
sudo k3s kubectl logs -n realtime postgres-<pod-id>
```

---

### 3. Producer Pod Keeps Restarting

**This is normal!** Producer waits for Kafka to be ready.

**Monitor:**

```bash
# Check Kafka status
sudo k3s kubectl -n realtime rollout status deploy/kafka

# Check producer logs
sudo k3s kubectl logs -n realtime deploy/producer --previous
```

Once Kafka is Running, producer will stabilize.

---

### 4. Frontend "Cannot Connect to API"

**Error:** Dashboard UI shows API connection errors

**Fix:**

```bash
# Test API health
curl http://<WSL_IP>:30080/health

# Check frontend logs
sudo k3s kubectl logs -n realtime deploy/frontend

# Restart frontend
sudo k3s kubectl -n realtime rollout restart deploy/frontend
```

---

## Docker Compose Issues

### 1. Container Exit Code 1

**Fix:**

```powershell
# Full clean
docker-compose down -v --remove-orphans

# Full rebuild
docker-compose build --no-cache

# Run
docker-compose up -d
```

---

### 2. Port Already in Use

**Error:** `Address already in use`

**Fix:**

```powershell
# Find what's using port
netstat -ano | findstr :5173

# Kill process
taskkill /PID <PID> /F

# Or change port in docker-compose.yml
```

---

## Browser Issues

### 1. Generator UI Auto Emit Stops When Tab Inactive

**This is normal browser behavior.** Browsers throttle inactive tabs.

**Solution:**

- Open both dashboards in separate windows (Win+Left/Right arrow)
- Or keep both tabs visible

**Code fix:** Already added in `AutoEmit.tsx` - logs tab visibility changes.

---

### 2. Cannot Access http://localhost:5173

**Cause:** Port forwarding not working or UI not running

**Fix:**

```bash
# Check running containers
docker-compose ps

# Check logs
docker-compose logs generator-ui

# Restart
docker-compose restart generator-ui
```

---

## Complete Reset

### Reset Everything (Nuclear Option)

```powershell
# 1. Stop all containers
docker-compose down -v --remove-orphans

# 2. Stop K3s
wsl -e bash
sudo systemctl stop k3s

# 3. Delete K3s data
sudo rm -rf /var/lib/rancher/k3s /etc/rancher/k3s ~/.kube

# 4. Delete Docker data
docker system prune -af

# 5. Restart K3s
sudo systemctl start k3s
sleep 90

# 6. Rebuild and redeploy
cd infra
docker-compose build
docker-compose up -d
```

---

## Verification Checklist

After deployment:

- [ ] K3s nodes: `sudo k3s kubectl get nodes` → `Ready`
- [ ] All pods: `sudo k3s kubectl get pods -n realtime` → All `Running`
- [ ] Services: `sudo k3s kubectl get svc -n realtime` → Services listed
- [ ] Dashboard: Open `http://<WSL_IP>:30173` → Accessible
- [ ] Generator UI: Open `http://<WSL_IP>:30174` → Accessible
- [ ] APIs: Curl `http://<WSL_IP>:30080/health` → Success

---

## Contact & Support

For issues:
1. Check logs: `docker-compose logs -f <service>`
2. Check pod logs: `sudo k3s kubectl logs -n realtime <pod>`
3. Describe pod: `sudo k3s kubectl describe pod -n realtime <pod>`
4. Check events: `sudo k3s kubectl get events -n realtime`

---

**Last updated:** 2026-03-23
