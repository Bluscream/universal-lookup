import axios from 'axios';
import { config } from '../../config.js';
import type {
  ArchiveSnapshot,
  LookupOptions,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import {
  ARCHIVE_USER_AGENT,
  archiveResult,
  describeError,
  isoFromArchiveStamp,
  queueSave,
  sleep,
} from './shared.js';

const SERVICE = 'wayback';
const AVAILABILITY_URL = 'https://archive.org/wayback/available';
const SAVE_URL = 'https://web.archive.org/save';

interface AvailabilityResponse {
  archived_snapshots?: {
    closest?: {
      available?: boolean;
      url?: string;
      timestamp?: string;
      status?: string;
    };
  };
}

interface SaveResponse {
  url?: string;
  job_id?: string;
  message?: string;
  status?: string;
  status_ext?: string;
  timestamp?: string;
  original_url?: string;
}

/** The closest existing snapshot, or undefined when there is none. */
async function readSnapshot(url: string): Promise<{ snapshot?: ArchiveSnapshot; raw: unknown }> {
  const resp = await axios.get<AvailabilityResponse>(AVAILABILITY_URL, {
    params: { url },
    timeout: config.serverTimeout,
    headers: { 'User-Agent': ARCHIVE_USER_AGENT },
  });
  const closest = resp.data?.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) return { raw: resp.data };
  const status = Number.parseInt(closest.status ?? '', 10);
  return {
    raw: resp.data,
    snapshot: {
      service: SERVICE,
      snapshot_url: closest.url,
      original_url: url,
      timestamp: isoFromArchiveStamp(closest.timestamp),
      http_status: Number.isNaN(status) ? undefined : status,
      saved_now: false,
    },
  };
}

/**
 * Ask Save Page Now to capture the URL, and wait for the job to finish.
 *
 * SPN2 answers immediately with a job id and captures asynchronously, so the
 * snapshot URL only exists once the job reports `success`. There is no event to
 * subscribe to — the only push mechanism is a `callback_url` the archive would
 * have to reach, which a service behind a LAN cannot offer — so this polls, and
 * that is the reason.
 */
async function pollJob(jobId: string, deadline: number): Promise<SaveResponse> {
  let lastStatus = 'pending';
  while (Date.now() < deadline) {
    // ARCHIVE_SAVE_MIN_GAP_MS is the politeness interval for talking to the save
    // endpoint, and polling its status is exactly that — no second knob for it.
    await sleep(config.archiveSaveMinGapMs);
    const resp = await axios.get<SaveResponse>(`${SAVE_URL}/status/${jobId}`, {
      timeout: config.serverTimeout,
      headers: { 'User-Agent': ARCHIVE_USER_AGENT, Accept: 'application/json' },
    });
    lastStatus = resp.data?.status ?? lastStatus;
    if (lastStatus === 'success' || lastStatus === 'error') return resp.data;
  }
  throw new Error(`Save Page Now job ${jobId} was still "${lastStatus}" at the deadline`);
}

async function save(url: string): Promise<ArchiveSnapshot> {
  const deadline = Date.now() + config.archiveSaveTimeout;
  const body = new URLSearchParams({ url, skip_first_archive: '1' });
  const resp = await axios.post<SaveResponse>(SAVE_URL, body.toString(), {
    timeout: config.serverTimeout,
    headers: {
      // The S3-style keys are sent as archive.org's own "LOW" scheme, which is
      // what Save Page Now accepts; there is no bearer-token form.
      Authorization: `LOW ${config.iaAccessKey}:${config.iaSecretKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ARCHIVE_USER_AGENT,
    },
  });

  const jobId = resp.data?.job_id;
  if (!jobId) {
    throw new Error(
      resp.data?.message ?? 'Save Page Now accepted the request but returned no job id',
    );
  }

  const done = await pollJob(jobId, deadline);
  if (done.status !== 'success') {
    throw new Error(done.status_ext ?? done.message ?? `Save Page Now reported "${done.status}"`);
  }
  const timestamp = done.timestamp;
  return {
    service: SERVICE,
    snapshot_url: `https://web.archive.org/web/${timestamp}/${done.original_url ?? url}`,
    original_url: url,
    timestamp: isoFromArchiveStamp(timestamp),
    saved_now: true,
  };
}

export const wayback: Provider = {
  name: SERVICE,

  // Reading existing snapshots needs no credentials, so the provider is always
  // available; only the save path is gated, and it says so when asked.
  isAvailable: () => true,

  async lookup(
    query: string,
    _type?: LookupType,
    _originalQuery?: string,
    options?: LookupOptions,
  ): Promise<ProviderResult> {
    const start = Date.now();
    const wantsSave = options?.save === true;

    let existing: { snapshot?: ArchiveSnapshot; raw: unknown };
    try {
      existing = await readSnapshot(query);
    } catch (error) {
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: 'not-archived',
          error: `Wayback: ${describeError(error)}`,
        },
        start,
      );
    }

    if (!wantsSave) {
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: existing.snapshot ? 'existing' : 'not-archived',
          snapshots: existing.snapshot ? [existing.snapshot] : [],
          raw: existing.raw,
        },
        start,
      );
    }

    if (!config.iaAccessKey || !config.iaSecretKey) {
      // A save that was asked for and did not happen is a failure, not a
      // footnote: reported through `error` so it reaches the response's errors
      // map instead of hiding behind the snapshot that was already there.
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: 'unconfigured',
          error:
            'Wayback: saving needs archive.org credentials — Save Page Now refuses anonymous ' +
            'requests. Set IA_ACCESS_KEY and IA_SECRET_KEY from https://archive.org/account/s3.php.',
        },
        start,
      );
    }

    try {
      const snapshot = await queueSave(() => save(query), config.archiveSaveMinGapMs);
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: 'saved',
          snapshots: [snapshot],
          raw: existing.raw,
        },
        start,
      );
    } catch (error) {
      return archiveResult(
        {
          service: SERVICE,
          url: query,
          saveRequested: wantsSave,
          status: 'existing',
          error: `Wayback save failed: ${describeError(error)}`,
        },
        start,
      );
    }
  },
};
