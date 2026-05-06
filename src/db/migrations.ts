import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { config, ensureDataDir } from '../config.js';

let db: SqlJsDatabase | null = null;

/** Initialize the SQLite database and create tables */
export async function initDatabase(): Promise<SqlJsDatabase> {
  ensureDataDir();
  const SQL = await initSqlJs();

  // Load existing DB or create new one
  if (existsSync(config.dbPath)) {
    const buffer = readFileSync(config.dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create cache table
  db.run(`
    CREATE TABLE IF NOT EXISTS cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      query TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL DEFAULT 86400,
      UNIQUE(type, query)
    );
  `);

  // Create index
  db.run(`CREATE INDEX IF NOT EXISTS idx_cache_type_query ON cache(type, query);`);

  // Create rate limit tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      provider TEXT PRIMARY KEY,
      remaining INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL DEFAULT 0,
      limit_total INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Save to disk
  saveDatabase();

  return db;
}

/** Get the database instance */
export function getDatabase(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

/** Save database to disk */
export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(config.dbPath, buffer);
}

/** Close the database connection */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
