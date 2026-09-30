/**
 * The Estonian Web Archive (Eesti veebiarhiiv), run by the National Library of
 * Estonia — read-only.
 *
 * The cleanest archive found in the 2026-09 survey (docs/archive-services-research.md):
 * no key, no account, no bot protection, and a correct empty 404 for a URL it
 * has never crawled. Its crawl is national in scope, so for most URLs it will
 * have nothing — which is a real answer and exactly why it is worth asking. It
 * holds Estonian material that Wayback's broad crawl misses entirely.
 *
 * It publishes no submission API; the archive is curated by the library.
 */

import { createMementoProvider } from './memento.js';

export const veebiarhiiv = createMementoProvider({
  service: 'veebiarhiiv-ee',
  timemapBase: 'https://veebiarhiiv.digar.ee/a/timemap/link',
  label: 'Estonian Web Archive',
  saveNote:
    'The Estonian Web Archive publishes no submission API — its collection is curated by the ' +
    'National Library of Estonia. Existing snapshots are reported; nothing was submitted.',
  // Its timemap already emits https links; the rewrite is left off so that a
  // genuinely-http memento is reported as the archive actually stores it.
  upgradeToHttps: false,
});
