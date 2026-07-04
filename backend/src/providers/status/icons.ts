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
};

/** CDN URL of a service's brand icon, or null if we don't have one. */
export function serviceIconUrl(service: string): string | null {
  return SERVICE_ICON_URL[service.toLowerCase()] ?? null;
}
