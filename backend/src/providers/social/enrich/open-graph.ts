/**
 * Profile facts read from a page's Open Graph tags.
 *
 * For the platforms with no usable API: Instagram's Basic Display API was shut
 * off in December 2024 and its replacement only reads Business accounts through
 * an app-reviewed Meta app; Threads has a `profile_lookup` that App Review gates
 * to Meta's own accounts. Both, however, still render ordinary `og:` tags into
 * the profile page for link previews, and those tags carry exactly the counts
 * this lookup wants.
 *
 * Three things make this acceptable where a scraper would not be.
 *
 * It needs **no credentials at all** — no app, no review, no user's session
 * cookie, nothing that could get somebody's account banned. It reads the same
 * bytes any chat client fetches to draw a link preview.
 *
 * It needs **no impersonation**. Probed against the live sites: Instagram and
 * Threads serve these tags to any non-browser user-agent, including this
 * project's own honest one naming itself and its repository. A browser-like
 * user-agent gets the JavaScript application shell instead, which is why this
 * sends the plain one. TikTok is deliberately absent: it answers only a small
 * allowlist of named crawler agents — `facebookexternalhit` works, an honest
 * agent gets nothing and Googlebot gets 403 — and claiming to be Facebook's
 * crawler is a lie this codebase will not tell.
 *
 * And it is **honest about being approximate**. Open Graph counts are rounded
 * for display ("15.4k Likes"), so what comes back is the platform's own rounded
 * figure, not a precise one, and it is reported as such.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { USER_AGENT } from '../shared.js';

/** The tags, as read off the page. */
export interface OpenGraph {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

export function parseOpenGraph(html: string): OpenGraph {
  const $ = cheerio.load(html);
  const tag = (property: string): string | undefined =>
    $(`meta[property="og:${property}"]`).attr('content') ??
    $(`meta[name="og:${property}"]`).attr('content');

  return {
    title: tag('title'),
    description: tag('description'),
    image: tag('image'),
    url: tag('url'),
  };
}

/**
 * A count as Open Graph writes it.
 *
 * These are display strings, so every shape a human reader would accept turns
 * up: `1,234`, `15.4k`, `2.1M`, `1 234`. Returns null rather than 0 for
 * anything unreadable, because a profile with no followers and a profile whose
 * count could not be parsed are different answers.
 */
export function parseCount(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([\d.,\s\u00a0]+)\s*([kmb])?$/i.exec(value.trim());
  if (!match) return null;

  const [, digits, suffix] = match;
  // Thousands separators vary by locale and the decimal point does not, since
  // an abbreviated count is the only place one appears.
  const cleaned = (digits as string).replace(/[,\s\u00a0]/g, '');
  const base = Number.parseFloat(cleaned);
  if (Number.isNaN(base)) return null;

  const scale = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[
    (suffix ?? '').toLowerCase() as 'k' | 'm' | 'b'
  ];
  return Math.round(base * (scale ?? 1));
}

/**
 * Pull `<n> <label>` pairs out of an og:description.
 *
 * Instagram writes "165 Followers, 132 Following, 104 Posts - See Instagram
 * photos and videos from …"; Threads writes "15 Followers • 18 Threads. See the
 * latest conversations with …". One pattern covers both, and anything else that
 * follows the same convention.
 */
export function parseCounts(description: string | undefined): Record<string, number> {
  if (!description) return {};
  const counts: Record<string, number> = {};
  for (const match of description.matchAll(/([\d.,\u00a0]+\s*[kmb]?)\s+([A-Za-z]+)/g)) {
    const value = parseCount(match[1]);
    const label = (match[2] as string).toLowerCase();
    if (value !== null && !(label in counts)) counts[label] = value;
  }
  return counts;
}

/**
 * The display name from an og:title of the form `Name (@handle) • Something`.
 *
 * Returns null when the title does not carry a handle, which is how a platform's
 * generic landing page looks — and that page is what a missing account serves.
 */
export function parseDisplayName(title: string | undefined): string | null {
  if (!title) return null;
  const match = /^(.+?)\s*\(@[^)]+\)/.exec(title);
  return match ? (match[1] as string).trim() : null;
}

/**
 * Read one profile page.
 *
 * Plain axios with the project's own user-agent — see the note at the top of
 * the file for why that is both sufficient and the only honest option here.
 */
export async function readProfile(url: string): Promise<OpenGraph | null> {
  // Not the shared `get`. That one rejects any 200 whose body is HTML, because
  // every other reader here asks for JSON and an HTML answer means a block —
  // see `assertNotAnInterstitial`. Here HTML *is* the document, so the guard
  // would reject every successful read.
  const response = await axios.get<string>(url, {
    timeout: config.serverTimeout,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    responseType: 'text',
  });

  // A missing account does not 404 on either platform — both answer 200, one
  // with no tags at all and the other with the signed-out marketing page — so
  // absence is decided by the caller from the content, never from the status.
  const html = response.data;
  if (typeof html !== 'string' || html.length === 0) return null;
  return parseOpenGraph(html);
}

/** Shared shape for the two enrichers built on this. */
export function toAccount(
  og: OpenGraph,
  handle: string,
  counts: Record<string, number>,
  followersKey: string,
  uploadsKey: string,
  source: string,
): Partial<SocialAccount> {
  return {
    account: handle,
    url: og.url ?? null,
    display_name: parseDisplayName(og.title),
    avatar: og.image ?? null,
    followers: counts[followersKey] ?? null,
    uploads: counts[uploadsKey] ?? null,
    metrics: {
      ...counts,
      // Said plainly, because the number is not exact and a caller comparing it
      // against an API figure deserves to know why they differ.
      counts_are_rounded: true,
      read_from: 'open-graph',
      source,
    },
  };
}
