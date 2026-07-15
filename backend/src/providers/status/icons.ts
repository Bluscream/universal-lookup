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
/** Arbitrary Iconify icon, for brands not in Simple Icons (e.g. `ri/openai-fill`). */
const IC = (path: string) => `https://api.iconify.design/${path}.svg`;

const SERVICE_ICON_URL: Record<string, string> = {
  steam: SI('steam'),
  ubisoft: SI('ubisoft'),
  playstation: SI('playstation'),
  battlenet: SI('battledotnet'),
  activision: SI('activision'),
  nintendo: MDI('nintendo-switch'),
  xbox: MDI('microsoft-xbox'),
  cs2: SI('counterstrike'),
  gcp: SI('googlecloud'),
  aws: MDI('aws'),
  azure: MDI('microsoft-azure'),
};

const SERVICE_COLOR: Record<string, string> = {
  steam: '#00ADEE',
  ubisoft: '#000000',
  playstation: '#003087',
  battlenet: '#00AEFF',
  activision: '#000000',
  nintendo: '#E60012',
  xbox: '#107C10',
  cs2: '#DE9B35',
  gcp: '#4285F4',
  aws: '#FF9900',
  azure: '#0078D4',
};

/** CDN URL of a service's brand icon, or null if we don't have one. */
export function serviceIconUrl(service: string): string | null {
  return SERVICE_ICON_URL[service.toLowerCase()] ?? null;
}

/** Brand accent color of a service, or a default gray. */
export function serviceColor(service: string): string {
  return SERVICE_COLOR[service.toLowerCase()] ?? '#9ca3af';
}


/** Category a service belongs to, for grouping in the UI. */
const SERVICE_CATEGORY: Record<string, string> = {
  // Cloud / hosting / infrastructure
  aws: 'Cloud',
  azure: 'Cloud',
  gcp: 'Cloud',
  // Games / gaming platforms
  steam: 'Games',
  cs2: 'Games',
  xbox: 'Games',
  playstation: 'Games',
  nintendo: 'Games',
  activision: 'Games',
  ubisoft: 'Games',
  battlenet: 'Games',
};

/** Category for a service (Cloud / Games / Web), or 'Other' if unmapped. */
export function serviceCategory(service: string): string {
  return SERVICE_CATEGORY[service.toLowerCase()] ?? 'Other';
}
