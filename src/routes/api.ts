import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, getCacheTtl } from '../config.js';
import { getCached, setCache } from '../db/cache.js';
import { collectErrors, collectRaw, deepClean, mergeResponses } from '../lib/merger.js';
import { detectType, normalizeQuery, SPECIAL_NUMBERS } from '../lib/normalizer.js';
import { lookupEmail } from '../providers/email/index.js';
import { lookupIp } from '../providers/ip/index.js';
import { lookupLocation } from '../providers/location/index.js';
import { lookupParcel } from '../providers/parcel/index.js';
import { lookupTel } from '../providers/tel/index.js';
import { lookupDomain } from '../providers/domain/index.js';
import { lookupWeb } from '../providers/web/index.js';
import type { LookupResponse, LookupType, ProviderResult } from '../types/common.js';

const VALID_TYPES = new Set<string>(['tel', 'ip', 'domain', 'email', 'location', 'parcel', 'web', 'auto']);

const responseSchema = {
  200: {
    type: 'object',
    properties: {
      errors: { type: 'object', additionalProperties: { type: 'string' } },
      lookup_time: { type: 'string' },
      raw: { type: 'object', additionalProperties: true },
      request: {
        type: 'object',
        properties: {
          ip: { type: 'string' },
          query: { type: 'string' },
          time: { type: 'string' },
          type: { type: 'string' },
        },
      },
      response: { type: 'object', additionalProperties: true },
      success: { type: 'boolean' },
    },
  },
};

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // GET: /api/:type/:query
  app.get<{
    Params: { type: string; query: string };
    Querystring: { raw?: string; fresh?: string };
  }>(
    '/api/:type/:query',
    {
      schema: {
        tags: ['Lookup'],
        summary: 'Perform a lookup (GET)',
        description: 'Perform a lookup of the specified type for the given query.',
        params: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...VALID_TYPES], description: 'Lookup type' },
            query: { type: 'string', description: 'The query to look up' },
          },
          required: ['type', 'query'],
        },
        querystring: {
          type: 'object',
          properties: {
            raw: { type: 'string', enum: ['true', 'false', '1', '0'] },
            fresh: { type: 'string', enum: ['true', 'false', '1', '0'] },
          },
        },
        response: responseSchema,
      },
    },
    async (request) => {
      return handleLookup(request.params.type, request.params.query, request.query, request.ip);
    },
  );

  // POST: /api/:type (Home Assistant / rest_command support)
  app.post<{
    Params: { type: string };
    Body: { query?: string; raw?: boolean | string; fresh?: boolean | string };
  }>(
    '/api/:type',
    {
      schema: {
        tags: ['Lookup'],
        summary: 'Perform a lookup (POST)',
        description: 'Support for Home Assistant rest_command. Send query in JSON body.',
        params: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...VALID_TYPES] },
          },
          required: ['type'],
        },
        body: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            raw: { type: ['boolean', 'string'] },
            fresh: { type: ['boolean', 'string'] },
          },
          required: ['query'],
        },
        response: responseSchema,
      },
    },
    async (request) => {
      const { query, raw, fresh } = request.body;
      const queryParams = {
        raw: typeof raw === 'boolean' ? (raw ? 'true' : 'false') : raw,
        fresh: typeof fresh === 'boolean' ? (fresh ? 'true' : 'false') : fresh,
      };
      return handleLookup(request.params.type, query || '', queryParams, request.ip);
    },
  );

  // POST: /api/lookup (Generic)
  app.post<{
    Body: { type: string; query: string; raw?: boolean | string; fresh?: boolean | string };
  }>(
    '/api/lookup',
    {
      schema: {
        tags: ['Lookup'],
        summary: 'Perform a lookup (Generic POST)',
        body: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...VALID_TYPES] },
            query: { type: 'string' },
            raw: { type: ['boolean', 'string'] },
            fresh: { type: ['boolean', 'string'] },
          },
          required: ['type', 'query'],
        },
        response: responseSchema,
      },
    },
    async (request) => {
      const { type, query, raw, fresh } = request.body;
      const queryParams = {
        raw: typeof raw === 'boolean' ? (raw ? 'true' : 'false') : raw,
        fresh: typeof fresh === 'boolean' ? (fresh ? 'true' : 'false') : fresh,
      };
      return handleLookup(type, query, queryParams, request.ip);
    },
  );

  // Wildcard for multi-segment queries
  app.get<{
    Params: { type: string; '*': string };
    Querystring: { raw?: string; fresh?: string };
  }>(
    '/api/:type/*',
    { schema: { hide: true } },
    async (request) => {
      const query = (request.params as Record<string, string>)['*'];
      return handleLookup(request.params.type, query, request.query, request.ip);
    },
  );
}

export async function registerShortcutRoutes(app: FastifyInstance): Promise<void> {
  // SPA-style routes: /:type/:query serves the frontend, which auto-triggers lookup via /api/
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const indexPath = join(__dirname, '..', 'frontend', 'index.html');

  const serveIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
    const html = await readFile(indexPath, 'utf-8');
    return reply.type('text/html').send(html);
  };

  app.get<{
    Params: { type: string; query: string };
  }>(
    '/:type/:query',
    {
      schema: { hide: true },
    },
    async (request, reply) => {
      if (!VALID_TYPES.has(request.params.type)) return; // Let other handlers deal with it
      return serveIndex(request, reply);
    },
  );

  // Wildcard for multi-segment queries (e.g. /email/user@example.com)
  app.get<{
    Params: { type: string; '*': string };
  }>(
    '/:type/*',
    {
      schema: { hide: true },
    },
    async (request, reply) => {
      const type = request.params.type;
      if (!VALID_TYPES.has(type)) return; // Let static/frontend handle it
      return serveIndex(request, reply);
    },
  );
}

async function handleLookup(
  type: string,
  query: string,
  queryParams: { raw?: string; fresh?: string },
  clientIp: string,
): Promise<LookupResponse> {
  const startTime = Date.now();
  const includeRaw = !config.disableRaw && (queryParams.raw === 'true' || queryParams.raw === '1');
  const forceFresh =
    !config.disableFresh && (queryParams.fresh === 'true' || queryParams.fresh === '1');

  if (!VALID_TYPES.has(type)) {
    return {
      lookup_time: `${Date.now() - startTime}ms`,
      success: false,
      response: {},
      errors: {
        system: `Invalid lookup type: ${type}. Valid types: ${[...VALID_TYPES].join(', ')}`,
      },
      raw: {},
      request: { time: new Date().toISOString(), ip: clientIp, type: type as LookupType, query },
    };
  }

  // Handle auto-detection
  let resolvedType = type as LookupType;
  if (resolvedType === 'auto') {
    resolvedType = detectType(query);
  }

  // Normalize the query
  const normalizedQuery = await normalizeQuery(resolvedType, query);
  const normalizedLower = normalizedQuery.toLowerCase();

  // Handle special emergency numbers
  let specialInfo: { name: string; number_type: string } | null = null;
  if (resolvedType === 'tel') {
    if (normalizedLower in SPECIAL_NUMBERS) {
      specialInfo = SPECIAL_NUMBERS[normalizedLower];
    }
  }

  // Check cache (unless ?fresh=true)
  if (!forceFresh) {
    const cached = getCached(type, normalizedQuery);
    if (cached) {
      // Update request metadata for this specific request
      cached.request.time = new Date().toISOString();
      cached.request.ip = clientIp;
      cached.lookup_time = `${Date.now() - startTime}ms (cached)`;
      if (!includeRaw) cached.raw = {};
      return cached;
    }
  }

  // Run providers
  let results: ProviderResult[] = [];
  
  if (type === 'auto' && (resolvedType === 'ip' || resolvedType === 'domain')) {
    // Dual lookup logic
    const firstResults = await getLookupFunction(resolvedType)(normalizedQuery);
    results = [...firstResults];
    
    // Attempt to find the "other" query
    if (resolvedType === 'ip') {
      // IP -> Domain
      const dnsResult = firstResults.find(r => r.provider === 'dns' && r.success);
      const domain = (dnsResult?.data?.reverse_dns as string[])?.[0];
      if (domain) {
        const domainResults = await lookupDomain(domain);
        results = [...results, ...domainResults];
      }
    } else {
      // Domain -> IP
      const dnsResult = firstResults.find(r => r.provider === 'dns' && r.success);
      const ip = (dnsResult?.data?.dns_a as string[])?.[0] || (dnsResult?.data?.dns_aaaa as string[])?.[0];
      if (ip) {
        const ipResults = await lookupIp(ip);
        results = [...results, ...ipResults];
      }
    }
  } else {
    // Normal single lookup
    const lookupFn = getLookupFunction(resolvedType);
    results = await lookupFn(normalizedQuery);
  }

  // Build response
  let merged = mergeResponses(results);
  const errors = collectErrors(results);
  const raw = includeRaw ? collectRaw(results) : {};
  let success = results.some((r) => r.success);

  // Apply special info if it was a special number
  if (specialInfo) {
    success = true;
    merged = {
      ...merged,
      name: specialInfo.name,
      number_type: specialInfo.number_type,
      phone: normalizedQuery,
    };
  }

  const response: LookupResponse = {
    lookup_time: `${Date.now() - startTime}ms`,
    success,
    response: merged,
    errors,
    raw,
    request: {
      time: new Date().toISOString(),
      ip: clientIp,
      type: resolvedType,
      query: normalizedQuery,
    },
  };

  // Cache the response (with raw for potential future ?raw requests)
  const fullResponse = { ...response, raw: collectRaw(results) };
  setCache(type, normalizedQuery, fullResponse, getCacheTtl(type));

  return sortObjectKeys(deepClean(response)) as LookupResponse;
}

function getLookupFunction(type: LookupType) {
  switch (type) {
    case 'ip':
      return lookupIp;
    case 'tel':
      return lookupTel;
    case 'domain':
      return lookupDomain;
    case 'email':
      return lookupEmail;
    case 'location':
      return lookupLocation;
    case 'parcel':
      return lookupParcel;
    case 'web':
      return lookupWeb;
    default:
      return lookupWeb;
  }
}

/**
 * Sort object keys alphabetically.
 */
function sortObjectKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys) as unknown as T;
  }
  
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as object).sort();

  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }

  return sorted as T;
}
