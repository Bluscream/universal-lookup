/**
 * What a GitHub account has published: its repositories, and the organisations
 * it belongs to.
 *
 * Sorted by last push rather than by stars. The question this stage answers is
 * "what has this account been doing", and a repository that was starred heavily
 * in 2019 and untouched since answers a different one. Stars are still carried,
 * as `score`, so a caller can re-rank.
 *
 * Forks are included but marked, because an account whose recent activity is
 * entirely forks is itself a useful signal and silently dropping them would
 * make such an account look inactive instead.
 */

import { Octokit } from '@octokit/rest';
import { config } from '../../../config.js';
import type { SocialAccount, SocialActivity } from '../../../types/common.js';
import { type DetailResult, defineDetailer } from '../shared.js';

const NAME = 'github-repos';

let client: Octokit | undefined;

function octokit(): Octokit {
  client ??= new Octokit({ auth: config.githubToken || undefined, userAgent: 'universal-lookup' });
  return client;
}

export const githubRepos = defineDetailer({
  name: NAME,
  platform: 'github',
  // Works unauthenticated; GITHUB_TOKEN only raises the rate limit.
  isAvailable: () => true,
  async read(account: SocialAccount, limit: number): Promise<DetailResult> {
    const handle = account.account?.trim();
    if (!handle) return {};

    // Two independent reads, so one failing must not cost the other.
    const [repos, orgs] = await Promise.all([
      octokit().rest.repos.listForUser({
        username: handle,
        sort: 'pushed',
        direction: 'desc',
        per_page: limit,
      }),
      octokit()
        .rest.orgs.listForUser({ username: handle, per_page: 10 })
        .catch(() => null),
    ]);

    const activity: SocialActivity[] = repos.data.map((repo) => ({
      kind: 'repo',
      source: NAME,
      id: String(repo.id),
      title: repo.name,
      text: repo.description,
      url: repo.html_url,
      // When it was last pushed to, which is what "recent" means for a repo.
      time: repo.pushed_at ?? repo.updated_at ?? null,
      score: repo.stargazers_count ?? null,
      metrics: {
        language: repo.language,
        forks: repo.forks_count ?? null,
        open_issues: repo.open_issues_count ?? null,
        archived: repo.archived ?? null,
        fork: repo.fork,
        created_at: repo.created_at ?? null,
        topics: repo.topics ?? null,
      },
    }));

    const details: Record<string, unknown> = {};
    if (orgs?.data.length) {
      details.organizations = orgs.data.map((org) => ({
        login: org.login,
        url: `https://github.com/${org.login}`,
        avatar: org.avatar_url,
        description: org.description,
      }));
    }

    return { activity, details: Object.keys(details).length > 0 ? details : undefined };
  },
});
