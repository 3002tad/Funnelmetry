# Docker build definitions

| File | Build context | Purpose |
|---|---|---|
| `dashboard-api.Dockerfile` | repository root (`.`) | API image build definition; includes analytics and bootstrap. Swarm deploys a separately pinned image. |
| `dashboard-web.Dockerfile` | repository root (`.`) | Current dashboard Web image |
| `pipeline-workers.Dockerfile` | repository root (`.`) | Current shared Pipeline worker image |
| `node-service.Dockerfile` | repository root (`.`) | Shared Node image referenced by the separate Edge Relay server deployment; not part of the Pipeline Swarm stack |

From the repository root, local API/Web build examples are:

```text
docker build -f infra/docker/dashboard-api.Dockerfile -t funnelmetry/api:local .
docker build -f infra/docker/dashboard-web.Dockerfile -t funnelmetry/web:local .
```

Runtime env files belong under `runtime/`, never in a Docker build context or image.
