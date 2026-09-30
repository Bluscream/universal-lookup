import axios from 'axios';
import { config } from '../../config.js';
import type {
  ArchiveSnapshot,
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { ARCHIVE_USER_AGENT, archiveResult, describeError, queueSave } from './shared.js';

const SERVICE = 'perma-cc';
const API_URL = 'https://api.perma.cc/v1';

interface PermaArchive {
  guid?: string;
  url?: string;
  creation_timestamp?: string;
  status?: string;
  title?: string;
}

/**
 * perma.cc — save-only.
 *
 * Unlike the others there is no way to ask perma.cc "does a link for this URL
 * already exist?" without credentials: its read endpoints are scoped to the
 * calling account, and an unauthenticated request answers HTTP 403. So this
 * provider reports itself unavailable without PERMA_CC_API_KEY, and when it is
 * configured it reads back that account's own links.
 *
 * As of 2026-09-30 this provider probably cannot work from a server at all:
 * api.perma.cc and perma.cc both answer `403` with `cf-mitigated: challenge`,
 * a Cloudflare interactive challenge, before any API key is considered. That is
 * not something to work around — see docs/archive-services-research.md. Left
 * registered because a key still gates it, so it costs a configured operator one
 * clear error rather than silently disappearing, and the block may be
 * geographic or temporary. Nothing here has been verified against a real key.
 *
 * A perma link is a durable citation, and a free account has a small monthly
 * quota — another reason saving is opt-in rather than something every lookup
 * does.
 */

/** Links this account already made for `url`. */
async function readOwn(url: string): Promise<ArchiveSnapshot[]> {
  const resp = await axios.get<{ objects?: PermaArchive[] }>(`${API_URL}/archives/`, {
    params: { api_key: config.permaCcApiKey, url, limit: 10 },
    timeout: config.serverTimeout,
    headers: { 'User-Agent': ARCHIVE_USER_AGENT },
  });
  return (resp.data?.objects ?? [])
    .filter((a): a is PermaArchive & { guid: string } => typeof a.guid === 'string')
    .map((a) => ({
      service: SERVICE,
      snapshot_url: `https://perma.cc/${a.guid}`,
      original_url: a.url ?? url,
      timestamp: a.creation_timestamp,
      saved_now: false,
    }));
}

async function save(url: string): Promise<ArchiveSnapshot> {
  const body: Record<string, string> = { url };
  if (config.permaCcFolderId) body.folder = config.permaCcFolderId;

  const resp = await axios.post<PermaArchive>(`${API_URL}/archives/`, body, {
    params: { api_key: config.permaCcApiKey },
    timeout: config.archiveSaveTimeout,
    headers: { 'User-Agent': ARCHIVE_USER_AGENT, 'Content-Type': 'application/json' },
  });

  const guid = resp.data?.guid;
  if (!guid) throw new Error('perma.cc accepted the request but returned no link id');
  return {
    service: SERVICE,
    snapshot_url: `https://perma.cc/${guid}`,
    original_url: resp.data.url ?? url,
    timestamp: resp.data.creation_timestamp,
    saved_now: true,
  };
}

export const permaCc: Provider = {
  name: SERVICE,

  isAvailable: () => config.permaCcApiKey !== '',

  async lookup(
    query: string,
    _type?: LookupType,
    _originalQuery?: string,
    options?: LookupOptions,
  ): Promise<ProviderResult> {
    const start = Date.now();
    const wantsSave = options?.save === true;
    const base = { service: SERVICE, url: query, saveRequested: wantsSave };

    if (!wantsSave) {
      try {
        const snapshots = await readOwn(query);
        return archiveResult(
          {
            ...base,
            status: snapshots.length ? 'existing' : 'not-archived',
            note: snapshots.length
              ? undefined
              : 'perma.cc only reports links made by this account.',
            snapshots,
          },
          start,
        );
      } catch (error) {
        return archiveResult(
          { ...base, status: 'not-archived', error: `perma.cc: ${describeError(error)}` },
          start,
        );
      }
    }

    try {
      const snapshot = await queueSave(() => save(query), config.archiveSaveMinGapMs);
      return archiveResult({ ...base, status: 'saved', snapshots: [snapshot] }, start);
    } catch (error) {
      return archiveResult(
        { ...base, status: 'existing', error: `perma.cc save failed: ${describeError(error)}` },
        start,
      );
    }
  },
};
