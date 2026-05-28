# CI/CD

GitHub Actions trong [`.github/workflows/`](../.github/workflows/).

## Workflows

| File | Khi chạy | Việc làm |
|------|----------|----------|
| [`ci.yml`](../.github/workflows/ci.yml) | PR + push `main` | Validate kustomize, build dashboard UI, build 6 Docker image (không push) |
| [`cd.yml`](../.github/workflows/cd.yml) | Push `main` | Build + **push** image lên **GHCR** (`ghcr.io/<owner>/<repo>/<service>:<sha>`) |
| [`cd-k3s-self-hosted.yml`](../.github/workflows/cd-k3s-self-hosted.yml) | Push `main` (runner WSL) | `import-images.sh` + `apply sprint3` + rollout trên **máy bạn** |

## CI (tự chạy khi mở PR)

Không cần cấu hình thêm. Vào tab **Actions** trên GitHub xem pass/fail.

## CD — GHCR (image registry)

Sau push `main`, workflow **CD** đẩy image ví dụ:

```text
ghcr.io/3002tad/business-data-streaming---processing-pipeline/tracking-api:<commit-sha>
```

**Lần đầu:** Repo → **Settings → Actions → General** → Workflow permissions: **Read and write**.

Package **public** (demo) hoặc **private** (team): **Packages** → chọn package → Change visibility.

Kéo image về k3s (thay `OWNER/REPO` và `TAG`):

```bash
docker pull ghcr.io/OWNER/REPO/tracking-api:TAG
docker tag ghcr.io/OWNER/REPO/tracking-api:TAG tracking-api:dev
docker save tracking-api:dev | sudo k3s ctr images import -
# lặp cho từng service, hoặc dùng overlay ghcr (dưới)
```

Overlay GHCR: [`infra/k8s/overlays/ghcr/`](../infra/k8s/overlays/ghcr/) + `kustomize edit set image` — xem comment trong file.

## CD — Deploy thẳng lên k3s WSL (self-hosted)

Phù hợp demo: **mỗi lần push `main` → máy Laptop 1 tự rebuild + rollout**.

### 1. Cài GitHub Actions runner trong WSL

```bash
# Trong Ubuntu WSL, thư mục tạm
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf actions-runner-linux-x64.tar.gz
```

Trên GitHub: **Settings → Actions → Runners → New self-hosted runner** → copy token, chạy:

```bash
./config.sh --url https://github.com/3002tad/Business-Data-Streaming---Processing-Pipeline \
  --token <TOKEN> \
  --labels k3s,Linux \
  --name wsl-k3s-laptop1
sudo ./svc.sh install
sudo ./svc.sh start
```

Runner cần: `docker`, `k3s`, quyền `sudo` cho `k3s ctr images import` (như script local).

### 2. Workflow

File [`cd-k3s-self-hosted.yml`](../.github/workflows/cd-k3s-self-hosted.yml) chạy khi:

- Push `main`, **và**
- Có runner online với label **`k3s`**

Nếu chưa gắn runner, workflow **đợi** — không fail CI trên GitHub hosted.

### 3. Chỉ deploy tay (không runner)

```bash
bash infra/k8s/rebuild-all-dev-images.sh
```

## Gợi ý team

| Môi trường | Cách |
|------------|------|
| Review code | CI trên PR |
| Image artifact | CD → GHCR |
| Laptop 1 demo | Self-hosted CD hoặc `rebuild-all-dev-images.sh` |

## Submodule `clients/web-shop`

CI/CD **không** build web-shop submodule. Web-shop chạy riêng trên Laptop 2 — xem [RUNTIME.md](RUNTIME.md).
