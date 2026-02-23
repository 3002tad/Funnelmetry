# Multi-stage build for API Generator
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy from build stage
COPY --from=build /app /app

# Expose port
EXPOSE 7070

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:7070/health || exit 1

# Run application
CMD ["node", "server.js"]
