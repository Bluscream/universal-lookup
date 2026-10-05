/**
 * GitHub profile facts, via Octokit — GitHub's own SDK.
 *
 * Named `github-user` rather than `github` because the flat PROVIDERS_BLACKLIST
 * namespace already holds a `github`: the app lookup's package source and the
 * status lookup's status page. Three different things called `github` would make
 * one blacklist entry disable all three.
 *
 * GITHUB_TOKEN is optional and already read by the app lookup, so this needs no
 * new configuration. Without one GitHub allows 60 requests an hour per host,
 * which one busy lookup can exhaust; with one it is 5000.
 */

import { Octokit } from '@octokit/rest';
import { config } from '../../../config.js';
import type { SocialAccount } from '../../../types/common.js';
import { defineEnricher } from '../shared.js';

const NAME = 'github-user';

/** One client, reused: it holds a throttling plugin and no per-call state. */
let client: Octokit | undefined;

function octokit(): Octokit {
  client ??= new Octokit({
    auth: config.githubToken || undefined,
    userAgent: 'universal-lookup',
  });
  return client;
}

export const githubUser = defineEnricher({
  name: NAME,
  platform: 'github',
  // Works unauthenticated; a token only raises the rate limit.
  isAvailable: () => true,
  async read(account: SocialAccount): Promise<Partial<SocialAccount> | null> {
    const handle = account.account?.trim();
    if (!handle) return null;

    try {
      const { data } = await octokit().rest.users.getByUsername({ username: handle });
      return {
        account: data.login,
        account_id: String(data.id),
        url: data.html_url,
        display_name: data.name,
        description: data.bio,
        avatar: data.avatar_url,
        followers: data.followers,
        uploads: data.public_repos,
        created_at: data.created_at,
        following: data.following,
        public_gists: data.public_gists,
        company: data.company,
        location: data.location,
        blog: data.blog || null,
        type: data.type,
        site_admin: data.site_admin,
      };
    } catch (error) {
      // 404 is a claim that has gone stale — the account was renamed or
      // deleted. Anything else (403 rate limit, 5xx) is a real failure and
      // must not be reported as a missing account.
      if (isNotFound(error)) return null;
      throw error;
    }
  },
  async findByName(handle: string): Promise<Partial<SocialAccount>[]> {
    // `type:user` keeps organisations out: the chain is looking for a person's
    // other accounts, and an org that happens to share the name is not one.
    const { data } = await octokit().rest.search.users({
      q: `${handle} type:user`,
      per_page: 5,
    });
    return data.items.map((item) => ({
      account: item.login,
      account_id: String(item.id),
      url: item.html_url,
      avatar: item.avatar_url,
    }));
  },
});

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}
