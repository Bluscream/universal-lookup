/**
 * GitHub releases, as the last-resort source.
 *
 * Plenty of software is only ever distributed as a release on its own
 * repository — no package manager carries it. This is deliberately last in the
 * registry and deliberately narrow: repository search, then the latest release
 * tag for the top few, so a result still carries a version like every other
 * source does.
 *
 * Unauthenticated search is limited to 10 requests a minute across the whole
 * host, which is why GITHUB_TOKEN exists. It is optional: without it the
 * provider still runs and reports a rate limit as the failure it is, rather than
 * as an empty result.
 */

import { config } from '../../config.js';
import type {
  AppData,
  AppEntry,
  LookupType,
  Provider,
  ProviderResult,
} from '../../types/common.js';
import { failure, get, getAllowing404, result, toIso } from './shared.js';

/** How many repositories get their latest release looked up. */
const RELEASE_LOOKUPS = 5;

function headers(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
  };
}

export const githubProvider: Provider = {
  name: 'github',
  isAvailable: () => true,
  async lookup(query: string, _type?: LookupType): Promise<ProviderResult<AppData>> {
    const start = Date.now();
    try {
      const body = await get<{
        items?: Array<{
          full_name?: string;
          name?: string;
          description?: string;
          html_url?: string;
          homepage?: string | null;
          license?: { spdx_id?: string | null } | null;
          owner?: { login?: string };
          pushed_at?: string;
          stargazers_count?: number;
        }>;
      }>(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10`,
        { headers: headers() },
      );

      const repos = body.items ?? [];
      const versions = new Map<string, { tag: string; published: string | null }>();
      await Promise.all(
        repos.slice(0, RELEASE_LOOKUPS).map(async (repo) => {
          if (!repo.full_name) return;
          const release = await getAllowing404<{ tag_name?: string; published_at?: string }>(
            `https://api.github.com/repos/${repo.full_name}/releases/latest`,
            { headers: headers() },
          );
          if (release?.tag_name) {
            versions.set(repo.full_name, {
              tag: release.tag_name,
              published: release.published_at ?? null,
            });
          }
        }),
      );

      const apps: AppEntry[] = repos.map((repo) => {
        const release = repo.full_name ? versions.get(repo.full_name) : undefined;
        return {
          name: repo.name ?? repo.full_name ?? '',
          source: 'github',
          id: repo.full_name ?? null,
          version: release?.tag.replace(/^v/, '') ?? null,
          description: repo.description ?? null,
          url: repo.html_url ?? null,
          homepage: repo.homepage || null,
          license: repo.license?.spdx_id ?? null,
          publisher: repo.owner?.login ?? null,
          updated: toIso(release?.published ?? repo.pushed_at),
          platform: 'cross-platform',
          stars: repo.stargazers_count ?? null,
        };
      });

      return result('github', start, query, apps, { repos: repos.length });
    } catch (error) {
      return failure('github', start, error);
    }
  },
};
