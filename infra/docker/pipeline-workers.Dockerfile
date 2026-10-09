FROM node:22-bookworm-slim
WORKDIR /workspace
COPY packages ./packages
COPY integrations ./integrations
COPY workers/shared ./workers/shared
COPY workers/canonical-normalizer/ workers/canonical-normalizer/
COPY workers/canonical-ledger-writer/ workers/canonical-ledger-writer/
COPY workers/ingress-telemetry-writer/ workers/ingress-telemetry-writer/
COPY workers/journey-processor/ workers/journey-processor/
COPY workers/funnel-processor/ workers/funnel-processor/
COPY workers/kpi-projector/ workers/kpi-projector/
COPY workers/source-connector/ workers/source-connector/
COPY workers/catalog-sync/ workers/catalog-sync/
COPY workers/funnel-maturity-scheduler/ workers/funnel-maturity-scheduler/
RUN set -eu; for service in canonical-normalizer canonical-ledger-writer ingress-telemetry-writer journey-processor funnel-processor kpi-projector source-connector catalog-sync funnel-maturity-scheduler; do \
      cd /workspace/workers/$service; npm ci --omit=dev --ignore-scripts; \
    done; npm cache clean --force
USER node
WORKDIR /workspace/workers/source-connector
CMD ["node", "src/main.js"]
