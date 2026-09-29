#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { API_PREFIX, config } from './config.js';
import { cleanExpiredCache } from './db/cache.js';
import { closeDatabase, initDatabase } from './db/migrations.js';
import { ensureMaxmindDbs } from './lib/maxmind-downloader.js';
import { resolvePuppeteerExecutablePath } from './lib/puppeteer.js';
import { registerApiRoutes, registerShortcutRoutes } from './routes/api.js';
import { registerDocsRoutes } from './routes/docs.js';
import { LOOKUP_TYPES } from './types/common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('🔧 Starting Universal Lookup backend...');

  // Initialize database
  console.log('📀 Initializing database...');
  await initDatabase();
  console.log('✅ Database initialized');

  // Clean expired cache on startup
  const cleaned = cleanExpiredCache();
  if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired cache entries`);

  // Auto-download MaxMind DBs if missing
  console.log('🌍 Checking MaxMind databases...');
  await ensureMaxmindDbs();
  console.log('✅ MaxMind check complete');

  const chromiumPath = resolvePuppeteerExecutablePath();
  if (chromiumPath) {
    console.log(`🌐 Puppeteer Chromium: ${chromiumPath}`);
  } else {
    console.warn(
      '⚠️  Chromium not found — parcel/web scrapers needing Puppeteer will fail until PUPPETEER_EXECUTABLE_PATH is set',
    );
  }

  // Create Fastify instance
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    trustProxy: true,
    ajv: {
      customOptions: {
        allowUnionTypes: true,
      },
    },
  });

  // CORS
  await app.register(fastifyCors, { origin: true });

  // Rate limiting for our own API
  await app.register(fastifyRateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    allowList: ['127.0.0.1', '::1'],
  });

  // Every lookup route, under whichever prefix it was reached by.
  const PROTECTED_ROUTES = ['/lookup', ...LOOKUP_TYPES.map((t) => `/${t}`)];

  // Auth hook — if REQUIRE_TOKEN is set, validate the token on every lookup route
  if (config.requireToken) {
    app.addHook('onRequest', async (request, reply) => {
      // The lookup routes are registered under three prefixes (/api/v1, /api and
      // bare), so matching on /api/v1 alone left the other two wide open. Strip
      // whichever prefix is present and judge the remaining route.
      const path = request.url.split('?')[0];
      const route = path.startsWith(`${API_PREFIX}/`)
        ? path.slice(API_PREFIX.length)
        : path.startsWith('/api/')
          ? path.slice('/api'.length)
          : path;

      // Leaves the frontend, /docs, /health and /types alone — none of them are
      // lookup routes, so none of them match.
      if (!PROTECTED_ROUTES.some((r) => route === r || route.startsWith(`${r}/`))) {
        return;
      }

      const token =
        (request.query as Record<string, unknown>)?.token ||
        request.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (token !== config.requireToken) {
        return reply.code(401).send({
          success: false,
          error: 'Unauthorized — provide a valid token via ?token= or Authorization: Bearer header',
        });
      }
    });
    console.log('🔒 Token authentication enabled');
  }

  // Swagger/OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Universal Lookup API',
        description:
          'Aggregated lookup service for phone numbers, IP addresses, emails, locations, and parcel tracking. Merges results from multiple providers with smart caching.',
        version: '1.0.0',
        contact: { name: 'Bluscream', url: 'https://github.com/Bluscream/universal-lookup' },
        license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      },
      servers: [
        { url: `http://localhost:${config.port}`, description: 'Local development' },
        { url: 'https://lookup.minopia.de', description: 'Production' },
        { url: 'https://lookup.tail230321.ts.net', description: 'Tailscale' },
      ],
      tags: [
        { name: 'Lookup', description: 'Main lookup endpoints' },
        { name: 'System', description: 'System endpoints' },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      defaultModelsExpandDepth: 3,
    },
    theme: { title: 'Universal Lookup API Docs' },
  });

  const { existsSync } = await import('node:fs');
  const reactBuildDir = existsSync(join(process.cwd(), 'frontend', 'dist'))
    ? join(process.cwd(), 'frontend', 'dist')
    : join(process.cwd(), '..', 'frontend', 'dist');
  const legacyFrontendDir = existsSync(join(process.cwd(), 'src', 'frontend'))
    ? join(process.cwd(), 'src', 'frontend')
    : join(process.cwd(), '..', 'backend', 'src', 'frontend');
  const frontendRoot = existsSync(reactBuildDir) ? reactBuildDir : legacyFrontendDir;

  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: '/',
    decorateReply: true,
    wildcard: false,
  });

  // Register routes
  await registerApiRoutes(app);
  await registerShortcutRoutes(app);
  await registerDocsRoutes(app);

  // SPA fallback — serve index.html for any unmatched GET that isn't /api or /docs
  app.setNotFoundHandler(async (request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/docs')
    ) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down...');
    await app.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`\n🚀 Universal Lookup running at ${address}`);
    console.log(`📖 API Docs: ${address}/docs`);
    console.log(`🌐 Frontend: ${address}/`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
