# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY common/package*.json ./common/
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY common/ ./common/
COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN npm run build

# Stage 2: Production
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

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

COPY package*.json ./
COPY common/package*.json ./common/
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm install --ignore-scripts

COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY frontend/vite.config.ts ./frontend/
COPY scripts/ ./scripts/

RUN mkdir -p /app/backend/data/maxmind

ENV PORT=24010
ENV HOST=0.0.0.0
ENV VITE_BACKEND_URL=http://localhost:24011
ENV DB_PATH=/app/backend/data/cache.db
ENV MAXMIND_DB_PATH=/app/backend/data/maxmind
ENV LOG_LEVEL=info

EXPOSE 24010 24011

CMD ["node", "scripts/start-all.js"]
