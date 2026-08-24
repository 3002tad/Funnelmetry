FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
