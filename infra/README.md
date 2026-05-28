# Infra

| Path | Mục đích |
|------|----------|
| [`.env.example`](.env.example) | Mẫu biến môi trường — copy thành `.env` (gitignore) |
| [`PORTS.md`](PORTS.md) | NodePort, URL từ Windows/Laptop 2 |
| [`postgres/`](postgres/) | **Nguồn SQL** schema (áp vào k8s qua configmap) |
| [`k8s/`](k8s/) | Manifest k3s + script deploy |

## Chạy backend (tóm tắt)

Chi tiết: [`docs/RUNTIME.md`](../docs/RUNTIME.md)

```bash
cp infra/.env.example infra/.env
bash infra/k8s/install-k3s-wsl.sh          # lần đầu
bash infra/k8s/import-images.sh            # build + import image
k3s kubectl apply -k infra/k8s/sprint3   # deploy full stack
```

Sau khi sửa code: `bash infra/k8s/rebuild-all-dev-images.sh` hoặc CI/CD — [`docs/CI_CD.md`](../docs/CI_CD.md)

## Cấu trúc `k8s/`

```text
k8s/
├── base/              # namespace
├── data/              # postgres, kafka, qdrant, rabbitmq
├── apps/              # deployment từng service
├── sprint1/           # kustomize layer (core pipeline) — không apply riêng
├── sprint2/           # + dashboard, qdrant, ollama
├── sprint3/           # + commerce — **luôn apply cái này**
├── ops/kubernetes-dashboard/  # Headlamp K8s UI, tuỳ chọn
└── *.sh               # install, import-images, port-forward, rebuild
```

**Chỉ** `kubectl apply -k infra/k8s/sprint3` — `sprint1`/`sprint2` là layer nội bộ của kustomize.

## Postgres SQL

File trong `infra/postgres/` là bản ghi chú schema. Cluster dùng bản nhúng trong `k8s/data/postgres/configmap-init-sql.yaml` — khi đổi schema, cập nhật **cả hai** (hoặc PVC mới).
