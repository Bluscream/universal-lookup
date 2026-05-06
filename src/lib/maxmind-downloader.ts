import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { config } from '../config.js';
import axios from 'axios';

/**
 * Auto-download GeoLite2 databases if they don't exist.
 * Uses community-hosted mirrors since official MaxMind requires license key for latest.
 */

const DB_FILES = [
  { name: 'GeoLite2-City.mmdb', url: 'https://git.io/GeoLite2-City.mmdb' },
  { name: 'GeoLite2-ASN.mmdb', url: 'https://git.io/GeoLite2-ASN.mmdb' },
  { name: 'GeoLite2-Country.mmdb', url: 'https://git.io/GeoLite2-Country.mmdb' },
];

// Alternative mirrors (P3TERX's GitHub hosted copies)
const ALT_DB_FILES = [
  { name: 'GeoLite2-City.mmdb', url: 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb' },
  { name: 'GeoLite2-ASN.mmdb', url: 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-ASN.mmdb' },
  { name: 'GeoLite2-Country.mmdb', url: 'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-Country.mmdb' },
];

export async function ensureMaxmindDbs(): Promise<void> {
  const dbPath = config.maxmindDbPath;

  // Ensure directory exists
  if (!existsSync(dbPath)) {
    mkdirSync(dbPath, { recursive: true });
  }

  const missing: typeof DB_FILES = [];

  for (const db of DB_FILES) {
    const filePath = join(dbPath, db.name);
    if (!existsSync(filePath)) {
      missing.push(db);
    }
  }

  if (missing.length === 0) {
    console.log('✅ MaxMind databases present');
    return;
  }

  console.log(`📥 Downloading ${missing.length} MaxMind database(s)...`);

  for (const db of missing) {
    const filePath = join(dbPath, db.name);
    let downloaded = false;

    // Try primary URL first
    try {
      await downloadFile(db.url, filePath);
      console.log(`  ✅ Downloaded ${db.name}`);
      downloaded = true;
    } catch (err) {
      console.log(`  ⚠ Primary download failed for ${db.name}: ${(err as Error).message}`);
    }

    // Try alternative URL
    if (!downloaded) {
      const altDb = ALT_DB_FILES.find(a => a.name === db.name);
      if (altDb) {
        try {
          await downloadFile(altDb.url, filePath);
          console.log(`  ✅ Downloaded ${db.name} (alt mirror)`);
          downloaded = true;
        } catch (err) {
          console.log(`  ❌ Alt download also failed for ${db.name}: ${(err as Error).message}`);
        }
      }
    }

    if (!downloaded) {
      console.log(`  ⚠ Could not download ${db.name} — MaxMind lookups will be limited`);
    }
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 60000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'universal-lookup/1.0' },
  });

  const writer = createWriteStream(dest);
  await pipeline(response.data, writer);
}
