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
# Runtime needs only production dependencies. The previous `npm install` pulled
# every devDependency into the final image — biome (107 MB), typescript (24 MB),
# vitest, tsx, and the whole frontend build chain (rolldown, esbuild, babel,
# lightningcss) — none of which run in production. `--ignore-scripts` still
# matters: puppeteer must not download its own Chromium, the system one is used.
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY scripts/ ./scripts/

RUN mkdir -p /app/backend/data/maxmind

# One server, one port. The backend already serves the built SPA through
# @fastify/static with an SPA fallback, so the separate `vite preview` process
# that used to hold 24010 was serving a byte-identical page from a dev tool —
# and it was the only reason vite had to exist in the runtime image.
ENV PORT=24011
ENV HOST=0.0.0.0
ENV DB_PATH=/app/backend/data/cache.db
ENV MAXMIND_DB_PATH=/app/backend/data/maxmind
ENV AMAZON_COOKIES_FILE=/app/backend/data/amazon-cookies.json
ENV AMAZON_SESSION_DIR=/app/backend/data/amazon-session
ENV ALIEXPRESS_COOKIES_FILE=/app/backend/data/aliexpress-cookies.json
ENV LOG_LEVEL=info

EXPOSE 24011

CMD ["node", "backend/dist/index.js"]
