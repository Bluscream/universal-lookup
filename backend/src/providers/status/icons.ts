/**
 * Public CDN icon URL per status service, included in the API response as a
 * convenience for external consumers. The frontend renders its own inline SVGs
 * (for `currentColor` theming) and ignores this field.
 *
 * Most come from the Simple Icons CDN (https://cdn.simpleicons.org/<slug>);
 * Nintendo and Xbox aren't in Simple Icons, so they use Iconify's Material
 * Design Icons instead.
 */
const SI = (slug: string) => `https://cdn.simpleicons.org/${slug}`;
const MDI = (name: string) => `https://api.iconify.design/mdi/${name}.svg`;

const SERVICE_ICON_URL: Record<string, string> = {
  discord: SI('discord'),
  vrchat: SI('vrchat'),
  cloudflare: SI('cloudflare'),
  github: SI('github'),
  epic: SI('epicgames'),
  reddit: SI('reddit'),
  twitch: SI('twitch'),
  steam: SI('steam'),
  ea: SI('ea'),
  ubisoft: SI('ubisoft'),
  playstation: SI('playstation'),
  battlenet: SI('battledotnet'),
  activision: SI('activision'),
  nintendo: MDI('nintendo-switch'),
  xbox: MDI('microsoft-xbox'),
  cs2: SI('counterstrike'),
  vercel: SI('vercel'),
  digitalocean: SI('digitalocean'),
  netlify: SI('netlify'),
  gcp: SI('googlecloud'),
  aws: MDI('aws'),
  azure: MDI('microsoft-azure'),
};

/** CDN URL of a service's brand icon, or null if we don't have one. */
export function serviceIconUrl(service: string): string | null {
  return SERVICE_ICON_URL[service.toLowerCase()] ?? null;
}

/** Category a service belongs to, for grouping in the UI. */
const SERVICE_CATEGORY: Record<string, string> = {
  // Cloud / hosting / infrastructure
  cloudflare: 'Cloud',
  aws: 'Cloud',
  azure: 'Cloud',
  gcp: 'Cloud',
  vercel: 'Cloud',
  digitalocean: 'Cloud',
  netlify: 'Cloud',
  // Games / gaming platforms
  steam: 'Games',
  cs2: 'Games',
  xbox: 'Games',
  playstation: 'Games',
  nintendo: 'Games',
  activision: 'Games',
  ea: 'Games',
  ubisoft: 'Games',
  battlenet: 'Games',
  epic: 'Games',
  vrchat: 'Games',
  // Web / social / dev
  discord: 'Web',
  github: 'Web',
  reddit: 'Web',
  twitch: 'Web',
};

/** Category for a service (Cloud / Games / Web), or 'Other' if unmapped. */
export function serviceCategory(service: string): string {
  return SERVICE_CATEGORY[service.toLowerCase()] ?? 'Other';
}
