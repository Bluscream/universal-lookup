import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { initDatabase, closeDatabase } from './db/migrations.js';
import { cleanExpiredCache, getCacheStats } from './db/cache.js';
import { registerApiRoutes, registerShortcutRoutes } from './routes/api.js';
import { ensureMaxmindDbs } from './lib/maxmind-downloader.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Initialize database
  await initDatabase();
  console.log('✅ Database initialized');

  // Clean expired cache on startup
  const cleaned = cleanExpiredCache();
  if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired cache entries`);

  // Auto-download MaxMind DBs if missing
  await ensureMaxmindDbs();

  // Create Fastify instance
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
    trustProxy: true,
  });

  // CORS
  await app.register(fastifyCors, { origin: true });

  // Rate limiting for our own API
  await app.register(fastifyRateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    allowList: ['127.0.0.1', '::1'],
  });

  // Auth hook — if REQUIRE_TOKEN is set, validate token on /api/* routes
  if (config.requireToken) {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url;
      // Only protect /api/* routes (not /docs, / frontend, etc.)
      if (!path.startsWith('/api/') || path.startsWith('/api/health') || path.startsWith('/api/types')) {
        return;
      }

      const token =
        (request.query as any)?.token ||
        request.headers.authorization?.replace(/^Bearer\s+/i, '');

      if (token !== config.requireToken) {
        reply.code(401).send({
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
        description: 'Aggregated lookup service for phone numbers, IP addresses, emails, locations, and parcel tracking. Merges results from multiple providers with smart caching.',
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

  // Serve frontend static files
  await app.register(fastifyStatic, {
    root: join(__dirname, 'frontend'),
    prefix: '/',
    decorateReply: false,
  });

  // System endpoints
  app.get('/api/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check',
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'number' }, cache: { type: 'object' } } } },
    },
  }, async () => {
    const stats = getCacheStats();
    return { status: 'ok', uptime: process.uptime(), cache: stats };
  });

  app.get('/api/types', {
    schema: {
      tags: ['System'],
      summary: 'List available lookup types',
      response: { 200: { type: 'object', properties: { types: { type: 'array', items: { type: 'object' } } } } },
    },
  }, async () => ({
    types: [
      { id: 'tel', name: 'Phone Number', description: 'Reverse phone lookup', example: '+493012345678' },
      { id: 'ip', name: 'IP / Domain', description: 'IP geolocation, WHOIS, DNS, ping, traceroute, port scan, security analysis', example: '8.8.8.8' },
      { id: 'email', name: 'Email', description: 'Email validation, risk scoring', example: 'user@example.com' },
      { id: 'location', name: 'Location', description: 'Geocoding and reverse geocoding', example: 'Berlin, Germany' },
      { id: 'parcel', name: 'Parcel', description: 'Package tracking', example: '00340434515310596216' },
    ],
  }));

  // Register routes
  await registerApiRoutes(app);
  await registerShortcutRoutes(app);

  // Serve frontend for root path
  app.get('/', { schema: { hide: true } }, async (request, reply) => {
    return reply.redirect('/index.html');
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
