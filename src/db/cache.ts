import type { LookupResponse } from '../types/common.js';
import { getDatabase, saveDatabase } from './migrations.js';

/** Get a cached response if it exists and hasn't expired */
export function getCached(type: string, query: string): LookupResponse | null {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(
    'SELECT response, created_at, ttl FROM cache WHERE type = ? AND query = ? AND (created_at + ttl) > ?',
  );
  stmt.bind([type, query.toLowerCase(), now]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    try {
      return JSON.parse(row.response as string) as LookupResponse;
    } catch {
      return null;
    }
  }
  stmt.free();
  return null;
}

/** Store a response in the cache */
export function setCache(type: string, query: string, response: LookupResponse, ttl: number): void {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  db.run(
    `INSERT INTO cache (type, query, response, created_at, ttl) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(type, query) DO UPDATE SET response = excluded.response, created_at = excluded.created_at, ttl = excluded.ttl`,
    [type, query.toLowerCase(), JSON.stringify(response), now, ttl],
  );

  saveDatabase();
}

/** Invalidate cache for a specific type and query */
export function invalidateCache(type: string, query: string): void {
  const db = getDatabase();
  db.run('DELETE FROM cache WHERE type = ? AND query = ?', [type, query.toLowerCase()]);
  saveDatabase();
}

/** Clean up all expired cache entries */
export function cleanExpiredCache(): number {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  db.run('DELETE FROM cache WHERE (created_at + ttl) <= ?', [now]);
  const changes = db.getRowsModified();
  if (changes > 0) saveDatabase();
  return changes;
}

/** Get cache statistics */
export function getCacheStats(): { total: number; expired: number } {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM cache');
  totalStmt.step();
  const total = (totalStmt.getAsObject().count as number) || 0;
  totalStmt.free();

  const expiredStmt = db.prepare(
    'SELECT COUNT(*) as count FROM cache WHERE (created_at + ttl) <= ?',
  );
  expiredStmt.bind([now]);
  expiredStmt.step();
  const expired = (expiredStmt.getAsObject().count as number) || 0;
  expiredStmt.free();

  return { total, expired };
}
