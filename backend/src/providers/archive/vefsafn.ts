/**
 * The Icelandic Web Archive (Vefsafn.is), run by the National and University
 * Library of Iceland — read-only.
 *
 * Unauthenticated and unprotected, like the Estonian archive, but noticeably
 * slower: in the 2026-09 survey a timemap for example.com took 36.8 s to return
 * 352 KB, having timed out twice at a 25 s deadline first. A URL it has never
 * seen answers 404 in under a third of a second, so the slowness is
 * proportional to how much it holds, and the pathological case is a URL with
 * thousands of mementos.
 *
 * SERVER_TIMEOUT defaults to 30 s, so this provider will sometimes time out on
 * heavily-archived URLs. That is left as-is rather than given a longer deadline
 * of its own: a timeout here surfaces as a real error, which is honest, and
 * holding a request open longer for one national archive would make every
 * archive lookup slower.
 *
 * Note the memento URLs carry pywb's `mp_` rewrite modifier
 * (`https://vefsafn.is/20260805153124mp_/http://example.com/`). They are
 * reported exactly as the archive emits them, because that is the URL that
 * resolves.
 *
 * It publishes no submission API.
 */

import { createMementoProvider } from './memento.js';

export const vefsafn = createMementoProvider({
  service: 'vefsafn-is',
  timemapBase: 'https://vefsafn.is/timemap/link',
  label: 'Icelandic Web Archive',
  saveNote:
    'The Icelandic Web Archive publishes no submission API — its collection is curated by the ' +
    'National and University Library of Iceland. Existing snapshots are reported; nothing was ' +
    'submitted.',
  upgradeToHttps: false,
});
