import type { FastifyInstance } from 'fastify';

const PROVIDER_CATEGORIES: Record<string, string> = {
  // tel
  tellows: 'tel',
  fritzbox: 'tel',
  emergency: 'tel',
  dastelefonbuch: 'tel',
  dasoertliche: 'tel',
  '11880': 'tel',

  // ip
  traceroute: 'ip',
  portscan: 'ip',
  ping: 'ip',
  maxmind: 'ip',
  'ip-api-io': 'ip',
  'ip-api-io-risk': 'ip',
  'ip-api.com': 'ip',
  ipapicom: 'ip',
  ipapiio: 'ip',

  // domain
  whois: 'domain',
  subdomain: 'domain',
  dns: 'domain',

  // email
  'ip-api-io-email-risk': 'email',
  'ip-api-io-email': 'email',
  'ip-api-io-adv-email': 'email',
  'dns-email': 'email',

  // location
  nominatim: 'location',
  'google-maps': 'location',
  googlemaps: 'location',

  // parcel
  pkge: 'parcel',
  parcelsapp: 'parcel',
  dhl: 'parcel',
  'dhl-web': 'parcel',
  '17track': 'parcel',
  seventeentrack: 'parcel',

  // steam
  steamdb: 'steam',
  'steam-xml': 'steam',
  'steam-inventory': 'steam',
  'steam-api': 'steam',
  playerdb: 'steam',
  csfloat: 'steam',
  'backpack-tf': 'steam',
  backpacktf: 'steam',

  // url
  virustotal: 'url',
  urlscan: 'url',
  metadata: 'url',
  'ip-info': 'url',
  ipinfo: 'url',
  'dns-lookup': 'url',
  dnslookup: 'url',

  // apk
  apk: 'apk',

  // web
  google: 'web',
  bing: 'web',
  duckduckgo: 'web',
  yahoo: 'web',
};

// JSON Schemas for each CategoryData model
const CATEGORY_SCHEMAS: Record<string, Record<string, any>> = {
  tel: {
    type: 'object',
    properties: {
      phone: { type: ['string', 'null'] },
      phone_formatted: { type: ['string', 'null'] },
      name: { type: ['string', 'null'] },
      number_type: { type: ['string', 'null'] },
      tellows_score: { type: ['integer', 'null'] },
      tellows_score_color: { type: ['string', 'null'] },
      caller_type: { type: ['string', 'null'] },
      caller_type_id: { type: ['integer', 'null'] },
      city: { type: ['string', 'null'] },
      country: { type: ['string', 'null'] },
      comments_count: { type: ['integer', 'null'] },
      searches_count: { type: ['integer', 'null'] },
      assessment: { type: ['string', 'null'] },
      call_types: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            count: { type: 'integer' },
          },
          required: ['type', 'count'],
        },
      },
      caller_names: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'integer' },
          },
          required: ['name', 'count'],
        },
      },
      last_call: { type: ['string', 'null'] },
      monthly_views: { type: ['integer', 'null'] },
      blocklist_position: { type: ['integer', 'null'] },
      area_name: { type: ['string', 'null'] },
      city_score: { type: ['integer', 'null'] },
      area_code: { type: ['string', 'null'] },
      postal_code: { type: ['string', 'null'] },
      population: { type: ['integer', 'null'] },
      provider: { type: ['string', 'null'] },
      comments: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            date: { type: 'string' },
            score: { type: 'integer' },
            author: { type: 'string' },
          },
          required: ['text'],
        },
      },
      street: { type: ['string', 'null'] },
    },
  },
  ip: {
    type: 'object',
    properties: {
      ip: { type: ['string', 'null'] },
      accuracy_radius: { type: ['integer', 'null'] },
      as: { type: ['string', 'null'] },
      asn: { type: ['string', 'null'] },
      asn_org: { type: ['string', 'null'] },
      city: { type: ['string', 'null'] },
      continent: { type: ['string', 'null'] },
      continent_code: { type: ['string', 'null'] },
      country: { type: ['string', 'null'] },
      country_code: { type: ['string', 'null'] },
      currency: { type: ['string', 'null'] },
      hops: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            ip: { type: ['string', 'null'] },
            rtt_ms: { type: ['number', 'null'] },
          },
        },
      },
      hosting: { type: ['boolean', 'null'] },
      isp: { type: ['string', 'null'] },
      latitude: { type: ['number', 'null'] },
      longitude: { type: ['number', 'null'] },
      mobile: { type: ['boolean', 'null'] },
      network: { type: ['string', 'null'] },
      open_ports: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            port: { type: 'integer' },
            service: { type: 'string' },
          },
          required: ['port', 'service'],
        },
      },
      org: { type: ['string', 'null'] },
      ping_alive: { type: ['boolean', 'null'] },
      ping_latency_ms: { type: ['number', 'null'] },
      ping_packet_loss: { type: ['number', 'null'] },
      postal_code: { type: ['string', 'null'] },
      proxy: { type: ['boolean', 'null'] },
      region: { type: ['string', 'null'] },
      region_code: { type: ['string', 'null'] },
      reverse_dns: { type: ['string', 'null'] },
      timezone: { type: ['string', 'null'] },
      vpn: { type: ['boolean', 'null'] },
    },
  },
  domain: {
    type: 'object',
    properties: {
      domain: { type: ['string', 'null'] },
      registrar: { type: ['string', 'null'] },
      status: { type: ['array', 'null'], items: { type: 'string' } },
      whois_server: { type: ['string', 'null'] },
      created_at: { type: ['string', 'null'] },
      updated_at: { type: ['string', 'null'] },
      expires_at: { type: ['string', 'null'] },
      name_servers: { type: ['array', 'null'], items: { type: 'string' } },
      whois_raw: { type: ['string', 'null'] },
      subdomains: { type: ['array', 'null'], items: { type: 'string' } },
      dns_a: { type: ['array', 'null'], items: { type: 'string' } },
      dns_aaaa: { type: ['array', 'null'], items: { type: 'string' } },
      dns_mx: { type: ['array', 'null'], items: { type: 'string' } },
      dns_txt: { type: ['array', 'null'], items: { type: 'string' } },
      dns_ns: { type: ['array', 'null'], items: { type: 'string' } },
      dns_cname: { type: ['array', 'null'], items: { type: 'string' } },
    },
  },
  email: {
    type: 'object',
    properties: {
      email: { type: ['string', 'null'] },
      format_valid: { type: ['boolean', 'null'] },
      mx_found: { type: ['boolean', 'null'] },
      disposable: { type: ['boolean', 'null'] },
      free: { type: ['boolean', 'null'] },
      deliverable: { type: ['boolean', 'null'] },
      score: { type: ['number', 'null'] },
      dmarc_record: { type: ['string', 'null'] },
      risk_score: { type: ['number', 'null'] },
    },
  },
  location: {
    type: 'object',
    properties: {
      name: { type: ['string', 'null'] },
      latitude: { type: ['number', 'null'] },
      longitude: { type: ['number', 'null'] },
      city: { type: ['string', 'null'] },
      state: { type: ['string', 'null'] },
      country: { type: ['string', 'null'] },
      country_code: { type: ['string', 'null'] },
      postal_code: { type: ['string', 'null'] },
      bounding_box: { type: ['array', 'null'], items: { type: 'string' } },
      display_name: { type: ['string', 'null'] },
    },
  },
  parcel: {
    type: 'object',
    properties: {
      tracking_number: { type: ['string', 'null'] },
      couriers: { type: ['array', 'null'], items: { type: 'string' } },
      status: { type: ['string', 'null'] },
      status_code: { type: ['number', 'null'] },
      status_description: { type: ['string', 'null'] },
      delivered: { type: ['boolean', 'null'] },
      origin: { type: ['string', 'null'] },
      destination: { type: ['string', 'null'] },
      weight: { type: ['string', 'null'] },
      estimated_delivery: { type: ['string', 'null'] },
      days_in_transit: { type: ['string', 'null'] },
      events: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            status: { type: 'string' },
            location: { type: 'string' },
            courier: { type: 'string' },
            source: { type: ['string', 'null'] },
          },
          required: ['date', 'status'],
        },
      },
    },
  },
  steam: {
    type: 'object',
    properties: {
      steam_id_64: { type: ['string', 'null'] },
      username: { type: ['string', 'null'] },
      profile_url: { type: ['string', 'null'] },
      avatar_icon: { type: ['string', 'null'] },
      avatar_medium: { type: ['string', 'null'] },
      avatar_full: { type: ['string', 'null'] },
      avatar_url: { type: ['string', 'null'] },
      persona_state: { type: ['integer', 'null'] },
      community_visibility_state: { type: ['integer', 'null'] },
      last_logoff: { type: ['string', 'null'] },
      real_name: { type: ['string', 'null'] },
      primary_clan_id: { type: ['string', 'null'] },
      created_at: { type: ['string', 'null'] },
      country_code: { type: ['string', 'null'] },
      state_code: { type: ['string', 'null'] },
      city_id: { type: ['integer', 'null'] },
      game_extrainfo: { type: ['string', 'null'] },
      game_id: { type: ['string', 'null'] },
      headline: { type: ['string', 'null'] },
      summary: { type: ['string', 'null'] },
      state_message: { type: ['string', 'null'] },
      privacy_state: { type: ['string', 'null'] },
      custom_url: { type: ['string', 'null'] },
      member_since: { type: ['string', 'null'] },
      community_banned: { type: ['boolean', 'null'] },
      vac_bans_count: { type: ['integer', 'null'] },
      days_since_last_ban: { type: ['integer', 'null'] },
      game_bans_count: { type: ['integer', 'null'] },
      economy_ban_state: { type: ['string', 'null'] },
      game_count: { type: ['integer', 'null'] },
      total_playtime_hours: { type: ['integer', 'null'] },
      most_played_game: {
        type: ['object', 'null'],
        properties: {
          appid: { type: 'integer' },
          name: { type: 'string' },
          playtime_hours: { type: 'integer' },
        },
        required: ['appid', 'name', 'playtime_hours'],
      },
      inventories: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            app_id: { type: 'integer' },
            game: { type: 'string' },
            item_count: { type: 'integer' },
            sample_items: { type: 'array', items: { type: 'string' } },
            status: { type: 'string' },
          },
          required: ['app_id', 'game', 'item_count', 'status'],
        },
      },
      total_inventory_items: { type: ['integer', 'null'] },
      trade_ban_state: { type: ['string', 'null'] },
      csfloat_registered: { type: ['boolean', 'null'] },
    },
  },
  url: {
    type: 'object',
    properties: {
      url: { type: ['string', 'null'] },
      title: { type: ['string', 'null'] },
      description: { type: ['string', 'null'] },
      server_ip: { type: ['string', 'null'] },
      dns_resolved: { type: ['array', 'null'], items: { type: 'string' } },
      ssl_valid: { type: ['boolean', 'null'] },
      ssl_subject: { type: ['string', 'null'] },
      ssl_issuer: { type: ['string', 'null'] },
      ssl_valid_to: { type: ['string', 'null'] },
      redirect_chain: { type: ['array', 'null'] },
      status_code: { type: ['integer', 'null'] },
      risk_score: { type: ['integer', 'null'] },
      threats: { type: ['array', 'null'], items: { type: 'string' } },
    },
  },
  apk: {
    type: 'object',
    properties: {
      package_name: { type: ['string', 'null'] },
      title: { type: ['string', 'null'] },
      version: { type: ['string', 'null'] },
      developer: { type: ['string', 'null'] },
      developer_email: { type: ['string', 'null'] },
      score: { type: ['number', 'null'] },
      installs: { type: ['string', 'null'] },
      genre: { type: ['string', 'null'] },
      price: { type: ['string', 'number', 'null'] },
      is_free: { type: ['boolean', 'null'] },
      updated: { type: ['string', 'null'] },
      url: { type: ['string', 'null'] },
      icon: { type: ['string', 'null'] },
      downloads: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            version: { type: 'string' },
            url: { type: 'string' },
            size: { type: 'number' },
            md5: { type: 'string' },
            status: { type: 'integer' },
          },
          required: ['source', 'url'],
        },
      },
    },
  },
  web: {
    type: 'object',
    properties: {
      web: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            url: { type: 'string' },
            provider: { type: 'string' },
          },
          required: ['title', 'description', 'url', 'provider'],
        },
      },
    },
  },
};

export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { provider: string };
  }>('/docs/:provider.schema.json', async (request, reply) => {
    const { provider } = request.params;
    const cleanProviderName = provider.toLowerCase().trim();

    // Resolve category name based on provider name
    const category = PROVIDER_CATEGORIES[cleanProviderName];

    if (!category || !CATEGORY_SCHEMAS[category]) {
      return reply.code(404).send({
        success: false,
        error: `JSON Schema not found for provider '${provider}'.`,
      });
    }

    const categorySchema = CATEGORY_SCHEMAS[category];

    // Build complete Draft-07 JSON Schema wrapper
    const responseSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: `Lookup Result Schema - ${provider}`,
      description: `JSON schema of the possible responses clients can expect when querying the '${provider}' provider under the '${category}' category.`,
      type: 'object',
      properties: {
        provider: { type: 'string', const: cleanProviderName },
        success: { type: 'boolean' },
        data: categorySchema,
        error: { type: ['string', 'null'] },
        duration: { type: 'integer', description: 'Query duration in milliseconds' },
        raw: { type: 'object', additionalProperties: true, description: 'Raw subprovider payload if requested' },
      },
      required: ['provider', 'success', 'data', 'duration'],
    };

    return reply.type('application/json').send(JSON.stringify(responseSchema, null, 2));
  });
}
