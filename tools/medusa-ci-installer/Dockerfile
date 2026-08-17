FROM node:20-alpine

WORKDIR /opt/funnelmetry-installer
COPY package.json ./
COPY src ./src

ENTRYPOINT ["node", "src/cli.mjs"]
