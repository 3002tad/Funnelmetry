# Build from Streaming_Pipeline root; independent of host node_modules/workspace.
FROM node:22-bookworm-slim
WORKDIR /workspace/apps/dashboard-api
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/funnelmetry-polars \
    && /opt/funnelmetry-polars/bin/pip install --no-cache-dir polars==1.34.0 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/funnelmetry-polars/bin:${PATH}"
COPY apps/dashboard-api/package.json apps/dashboard-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY apps/dashboard-api/src ./src
COPY apps/dashboard-api/scripts ./scripts
COPY analytics/src /workspace/analytics/src
COPY analytics/metadata /workspace/analytics/metadata
COPY analytics/sql /workspace/analytics/sql
COPY integrations/medusa/canonical-mappings.v1.json /workspace/integrations/medusa/canonical-mappings.v1.json
COPY infra/postgres /workspace/infra/postgres
COPY infra/bootstrap/bootstrap-handoff.mjs /workspace/infra/bootstrap/bootstrap-handoff.mjs
COPY infra/bootstrap/bootstrap-swarm.mjs /workspace/infra/bootstrap/bootstrap-swarm.mjs
COPY infra/bootstrap/cdc-candidate-migrations.mjs /workspace/infra/bootstrap/cdc-candidate-migrations.mjs
COPY infra/docker/swarm-entrypoint.mjs /workspace/infra/docker/swarm-entrypoint.mjs
COPY infra/docker/swarm-readiness.mjs /workspace/infra/docker/swarm-readiness.mjs
COPY tools/v2-e2e/test/analytics-image-smoke.mjs /workspace/tools/analytics-image-smoke.mjs
ENV NODE_ENV=production PORT=32000 DASHBOARD_ENABLE_LEGACY=false DASHBOARD_ENABLE_AI=false DASHBOARD_ENABLE_POLARS=false DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING=false DASHBOARD_ENABLE_ORDER_CHAT_STAGING=false
USER node
EXPOSE 32000
CMD ["node", "src/index.js"]
