/**
 * archive.today (archive.ph / archive.is / archive.md), read-only.
 *
 * Its submission form is behind an interactive CAPTCHA and its ordinary pages
 * sit behind bot mitigation — a plain `/newest/` request answers HTTP 429. There
 * is no API key, no documented submission endpoint and no arrangement for
 * automated callers, so the only way to submit a URL would be to defeat the
 * check. That is not something this service will do, so saving here is simply
 * not implemented and the provider says so rather than pretending.
 *
 * Reading is a different matter: the Memento `/timemap/` endpoint is a plain,
 * unprotected, machine-readable feed, and it answers the question that matters
 * most before anyone archives anything — is there already a copy?
 *
 * The save note is deliberately in `note` and not `error`: the provider was
 * asked what it knows and it answered. Only a *failed* request is an error here.
 *
 * The timemap parsing itself now lives in `memento.ts`, shared with the national
 * archives that speak the same RFC 7089 format.
 */

import { createMementoProvider } from './memento.js';

const NO_SAVE_NOTE =
  'archive.today has no automated submission path — its form is CAPTCHA-protected, which this ' +
  'service will not attempt to bypass. Existing snapshots are reported; nothing was submitted.';

export const archiveToday = createMementoProvider({
  service: 'archive-today',
  timemapBase: 'https://archive.ph/timemap',
  label: 'archive.today',
  saveNote: NO_SAVE_NOTE,
  // The timemap gives http:// links for a site that serves https.
  upgradeToHttps: true,
});
