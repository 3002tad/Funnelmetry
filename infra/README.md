# Pipeline infrastructure

Deployment và phát triển hiện hành dùng [`compose.yaml`](compose.yaml), [`runtime/deploy.env.example`](../runtime/deploy.env.example) và các Dockerfile trong [`docker/`](docker/). Bootstrap schema nằm trong [`bootstrap/`](bootstrap/). Cùng một lệnh Docker Compose dùng được trên Windows/Linux từ root repository; xem [UNIFIED_COMPOSE.md](../docs/UNIFIED_COMPOSE.md).

```text
docker compose --env-file runtime/deploy.env -f infra/compose.yaml config --quiet
docker compose --env-file runtime/deploy.env -f infra/compose.yaml up -d --wait
```

Profile `live`, `catalog`, `monitoring` nằm trong cùng `compose.yaml` và chỉ bật khi đã đáp ứng preflight tương ứng. Các Compose V2 smoke/dev, handoff và private-ingress cũ đã bị loại bỏ; không dùng lệnh lịch sử trên project/volume hiện hành. Xem [schema](postgres/README.md) và [danh mục file](../docs/DEPLOYMENT_CONFIG_FILES.md).
