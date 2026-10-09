FROM node:22-bookworm-slim

ARG SERVICE_PATH

WORKDIR /workspace
COPY packages ./packages
COPY integrations ./integrations
COPY workers/shared ./workers/shared
COPY ${SERVICE_PATH}/package.json ${SERVICE_PATH}/package-lock.json ./${SERVICE_PATH}/

WORKDIR /workspace/${SERVICE_PATH}
RUN npm ci --omit=dev

COPY ${SERVICE_PATH}/ ./

CMD ["node", "src/main.js"]
