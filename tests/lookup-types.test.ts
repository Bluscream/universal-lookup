import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOOKUP_TYPES } from '../backend/src/types/common.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('LOOKUP_TYPES really is the single source of truth', () => {
  /**
   * It claims to be, and it was not. `VALID_TYPES` in routes/api.ts was a
   * hand-written copy that fed Fastify's parameter schema, so `social` was
   * routable and auth-protected but rejected by request validation with
   * "params/type must be equal to one of the allowed values" — a 400 that looks
   * like a client mistake and is not one. Every surface that enumerates the
   * types is checked here by reading the source, because a surface that restates
   * the list is the failure mode, and a surface that derives it cannot drift.
   */
  it('routes/api.ts derives its request schema from it rather than restating it', () => {
    const src = readFileSync(join(ROOT, 'backend/src/routes/api.ts'), 'utf-8');
    expect(src).toMatch(/const VALID_TYPES = new Set<string>\(LOOKUP_TYPES\)/);
  });

  it('no surface spells out a list of lookup types of its own', () => {
    // A literal array holding three or more known type names is a copy of the
    // list, wherever it appears.
    const surfaces = ['backend/src/routes/api.ts', 'backend/src/lib/normalizer.ts'];
    const sample = ['tel', 'ip', 'domain', 'email', 'parcel'];

    for (const file of surfaces) {
      const src = readFileSync(join(ROOT, file), 'utf-8');
      const literals = [...src.matchAll(/\[[^[\]]*\]/g)].map((m) => m[0]);
      const copies = literals.filter(
        (literal) => sample.filter((type) => literal.includes(`'${type}'`)).length >= 3,
      );
      expect(copies, file).toEqual([]);
    }
  });

  it('every type the route accepts dispatches to its own lookup, not the web fallback', async () => {
    // The other half of the same bug, and the reason this does not merely assert
    // that a function comes back: `getLookupFunction` ends in `default: return
    // lookupWeb`, so a type missing from the switch still returns something and
    // silently answers with a web search. Only `web` and `auto` may map to it.
    const { getLookupFunction } = await import('../backend/src/routes/api.js');
    const { lookupWeb } = await import('../backend/src/providers/web/index.js');

    const fellThrough = LOOKUP_TYPES.filter(
      (type) => type !== 'web' && type !== 'auto' && getLookupFunction(type) === lookupWeb,
    );
    expect(fellThrough).toEqual([]);
  });
});
