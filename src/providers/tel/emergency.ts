import { SPECIAL_NUMBERS } from '../../lib/normalizer.js';
import type { Provider, ProviderResult } from '../../types/common.js';

export const emergencyProvider: Provider = {
  name: 'emergency',
  isAvailable: () => true,
  lookup: async (query: string): Promise<ProviderResult> => {
    const start = Date.now();
    const info = SPECIAL_NUMBERS[query];

    if (info) {
      return {
        provider: 'emergency',
        success: true,
        data: {
          name: info.name,
          number_type: info.number_type,
          phone: query,
        },
        duration: Date.now() - start,
      };
    }

    return {
      provider: 'emergency',
      success: false,
      data: {},
      error: 'Not a special emergency number',
      duration: Date.now() - start,
    };
  },
};
