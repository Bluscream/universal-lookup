# Stage 1: Build
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY common/package*.json ./common/
COPY frontend/package*.json ./frontend/
RUN npm install -g npm@latest && npm ci --ignore-scripts
COPY tsconfig.json ./
COPY common/ ./common/
COPY frontend/ ./frontend/
RUN npm run build -w frontend

# Stage 2: Production
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY common/package*.json ./common/
COPY frontend/package*.json ./frontend/
RUN npm install -g npm@latest && npm ci --ignore-scripts
COPY --from=builder /app/common/dist ./common/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY frontend/vite.config.ts ./frontend/

EXPOSE 24010

ENV PORT=24010
ENV HOST=0.0.0.0

CMD ["npm", "run", "preview", "-w", "frontend"]
