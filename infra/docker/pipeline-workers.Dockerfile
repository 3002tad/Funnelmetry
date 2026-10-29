FROM node:22-bookworm-slim
WORKDIR /workspace
COPY packages ./packages
COPY integrations ./integrations
COPY workers/shared ./workers/shared
COPY workers/canonical-normalizer/ workers/canonical-normalizer/
COPY workers/canonical-ledger-writer/ workers/canonical-ledger-writer/
COPY workers/ingress-telemetry-writer/ workers/ingress-telemetry-writer/
COPY workers/traffic-source-writer/ workers/traffic-source-writer/
COPY workers/journey-processor/ workers/journey-processor/
COPY workers/funnel-processor/ workers/funnel-processor/
COPY workers/kpi-projector/ workers/kpi-projector/
COPY workers/source-connector/ workers/source-connector/
COPY workers/catalog-sync/ workers/catalog-sync/
COPY workers/catalog-cdc-writer/ workers/catalog-cdc-writer/
COPY workers/inventory-price-cdc-writer/ workers/inventory-price-cdc-writer/
COPY workers/reference-order-cdc-v2-mapper/ workers/reference-order-cdc-v2-mapper/
COPY workers/reference-order-cdc-v2-sink/ workers/reference-order-cdc-v2-sink/
COPY workers/funnel-maturity-scheduler/ workers/funnel-maturity-scheduler/
COPY infra/docker/swarm-entrypoint.mjs /workspace/infra/docker/swarm-entrypoint.mjs
COPY infra/docker/swarm-readiness.mjs /workspace/infra/docker/swarm-readiness.mjs
COPY infra/docker/swarm-kafka-topics.mjs /workspace/infra/docker/swarm-kafka-topics.mjs
RUN set -eu; for service in canonical-normalizer canonical-ledger-writer ingress-telemetry-writer traffic-source-writer journey-processor funnel-processor kpi-projector source-connector catalog-sync catalog-cdc-writer inventory-price-cdc-writer reference-order-cdc-v2-mapper reference-order-cdc-v2-sink funnel-maturity-scheduler; do \
      cd /workspace/workers/$service; npm ci --omit=dev --ignore-scripts; \
    done; npm cache clean --force
USER node
WORKDIR /workspace/workers/source-connector
CMD ["node", "src/main.js"]
