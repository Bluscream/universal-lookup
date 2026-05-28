# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY common/package*.json ./common/
COPY backend/package*.json ./backend/
RUN npm install -g npm@latest && npm ci --ignore-scripts
COPY tsconfig.json ./
COPY common/ ./common/
COPY backend/ ./backend/
RUN npm run build -w backend

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
RUN npm install -g npm@latest && npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/backend/dist ./backend/dist

RUN mkdir -p /app/backend/data/maxmind

ENV PORT=24011
ENV HOST=0.0.0.0
ENV DB_PATH=/app/backend/data/cache.db
ENV MAXMIND_DB_PATH=/app/backend/data/maxmind
ENV LOG_LEVEL=info

EXPOSE 24011

CMD ["node", "backend/dist/index.js"]
