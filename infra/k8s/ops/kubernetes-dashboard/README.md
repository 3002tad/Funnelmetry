# Headlamp (Kubernetes UI)

[Headlamp](https://headlamp.dev/) là Kubernetes web UI thuộc SIG UI, thay thế thực tế cho Kubernetes Dashboard đã deprecated. Khác với **Admin Pipeline** trong app React (`/admin/system`).

| | Headlamp | Admin app (`/admin`) |
|---|----------|----------------------|
| Mục đích | Ops k8s: pod, event, YAML, log | Pipeline demo: health, commerce, user, ports |
| Đối tượng | Toàn cluster | Namespace `realtime` + metrics app |
| Cài đặt | Optional — script dưới | Có sẵn trong sprint3 |

## Yêu cầu

- k3s đang chạy trên WSL2
- **Helm 3** (cách cài chính thức hiện nay)

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

## Cài đặt (Helm, khuyên dùng)

Từ repo root, trong **Ubuntu WSL**:

```bash
bash infra/k8s/ops/kubernetes-dashboard/install.sh
```

Hoặc thủ công:

```bash
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
helm repo update
helm upgrade --install headlamp headlamp/headlamp \
  --namespace kube-system
```

## Truy cập

### Cách 1 — Port-forward (khuyên dùng demo)

```bash
bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh
```

Mở **http://localhost:8443**.

### Cách 2 — Từ Windows qua WSL

```powershell
wsl -d Ubuntu -- bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh
```

## Đăng nhập (Bearer token admin-user)

```bash
bash infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh
```

Copy token → Headlamp → **Token** → dán → Sign in.

**Cảnh báo:** `admin-user` có `cluster-admin` — chỉ dùng lab/demo, không expose ra internet.

## Gỡ cài đặt

```bash
helm uninstall headlamp -n kube-system
k3s kubectl -n kube-system delete sa admin-user || true
k3s kubectl delete clusterrolebinding headlamp-admin-user || true
```

## Xem namespace demo

Sau khi login, chọn namespace **`realtime`** để xem tracking-api, kafka, postgres, v.v.
