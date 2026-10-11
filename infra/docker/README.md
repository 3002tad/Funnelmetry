# Docker build definitions

| File | Build context | Purpose |
|---|---|---|
| `dashboard-api.Dockerfile` | repository root (`.`) | Current API image for unified Compose; includes analytics and bootstrap |
| `dashboard-web.Dockerfile` | repository root (`.`) | Current dashboard Web image |
| `pipeline-workers.Dockerfile` | repository root (`.`) | Current shared Pipeline worker image |
| `node-service.Dockerfile` | repository root (`.`) | Shared Node image still referenced by the separate Edge Relay server deployment; not used by unified Pipeline Compose |

From the repository root, the current API/Web commands are:

```text
docker build -f infra/docker/dashboard-api.Dockerfile -t funnelmetry/api:local .
docker build -f infra/docker/dashboard-web.Dockerfile -t funnelmetry/web:local .
```

Runtime env files belong under `runtime/`, never in a Docker build context or image.
