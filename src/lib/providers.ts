import type { Provider } from '../types/common.js';

/**
 * Filter and sort providers based on a comma-separated list of names.
 * If names is empty, returns all available providers in their default order.
 */
export function filterAndSortProviders(allProviders: Provider[], names?: string): Provider[] {
  const available = allProviders.filter((p) => p.isAvailable());

  if (!names || names.trim() === '') {
    return available;
  }

  const requestedNames = names
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');

  if (requestedNames.length === 0) {
    return available;
  }

  // Create a map for quick lookup
  const providerMap = new Map<string, Provider>();
  for (const p of available) {
    const name = p.name.toLowerCase();
    providerMap.set(name, p);
    // Add common aliases
    providerMap.set(name.replace(/[^a-z0-9]/g, ''), p); // e.g. "ip-api-com" -> "ipapicom"
    if (name === '11880') providerMap.set('provider11880', p);
    if (name === 'ip-api.com') providerMap.set('ipapicom', p);
    if (name === 'ip-api.io') providerMap.set('ipapiio', p);
  }

  const sorted: Provider[] = [];
  const seen = new Set<string>();

  for (const name of requestedNames) {
    const cleanName = name.replace(/[^a-z0-9]/g, '');
    const provider = providerMap.get(name) || providerMap.get(cleanName);

    if (provider && !seen.has(provider.name)) {
      sorted.push(provider);
      seen.add(provider.name);
    }
  }

  return sorted;
}
