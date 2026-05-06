# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Production
FROM node:22-slim

# Install Chromium for Puppeteer + traceroute + ping
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    traceroute \
    iputils-ping \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built app
COPY --from=builder /app/dist ./dist/

# Copy frontend (not compiled, served as static)
COPY src/frontend/ ./dist/frontend/

# Create data directory
RUN mkdir -p /app/data/maxmind && chown -R node:node /app/data

# Use non-root user
USER node

# Default env vars
ENV PORT=24010
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/cache.db
ENV MAXMIND_DB_PATH=/app/data/maxmind
ENV LOG_LEVEL=info

EXPOSE 24010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:24010/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.source="https://github.com/Bluscream/universal-lookup"
LABEL org.opencontainers.image.description="Universal Lookup — Aggregated intelligence service for phone numbers, IPs, emails, locations, and parcels"
LABEL org.opencontainers.image.licenses="MIT"

CMD ["node", "dist/index.js"]
