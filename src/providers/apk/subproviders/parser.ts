import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
// @ts-expect-error
import AppInfoParser from 'app-info-parser';

export interface ApkMetadata {
  [key: string]: unknown;
  checksums?: {
    md5: string;
    sha1: string;
    sha256: string;
  };
}

export async function parseApkFromUrl(url: string): Promise<ApkMetadata> {
  const tmpDir = os.tmpdir();
  const filename = `apk-parser-${Date.now()}-${Math.floor(Math.random() * 10000)}.apk`;
  const filePath = path.join(tmpDir, filename);

  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download APK: ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(filePath);
    await pipeline(response.body, fileStream);

    // Compute checksums
    const fileBuffer = await fs.promises.readFile(filePath);
    const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
    const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex');
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Parse APK
    const parser = new AppInfoParser(filePath);
    const result = await parser.parse();

    return {
      ...result,
      checksums: {
        md5,
        sha1,
        sha256,
      },
    };
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      console.error(`[APK] Error cleaning up temporary file ${filePath}:`, err);
    }
  }
}
