import { useState } from 'react';
import type { LookupResponse, LookupType, WebResult } from '../types/api';
import { ApkCard } from './ApkCard';
import { MapCard } from './MapCard';
import { ParcelTimeline } from './ParcelTimeline';
import { SteamProfileCard } from './SteamProfileCard';
import { UrlMetadataCard } from './UrlMetadataCard';

interface LookupResultProps {
  data: LookupResponse;
}

// Priority display order
const CARD_KEYS = [
  'ip',
  'country',
  'country_code',
  'city',
  'region',
  'postal_code',
  'latitude',
  'longitude',
  'timezone',
  'isp',
  'org',
  'asn',
  'asn_org',
  'reverse_dns',
  'proxy',
  'vpn',
  'tor',
  'datacenter',
  'hosting',
  'risk_score',
  'risk_level',
  'name',
  'phone',
  'street',
  'address',
  'caller_type',
  'tellows_score',
  'email',
  'valid_syntax',
  'disposable',
  'free_provider',
  'mx_records',
  'reachable',
  'display_name',
  'formatted_address',
  'tracking_number',
  'carrier',
  'status',
  'status_description',
  'ping_alive',
  'ping_latency_ms',
];

function formatLabel(k: string) {
  return k.replace(/_/g, ' ');
}

function formatValue(_key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? '✓ Yes' : '✗ No';
  return String(value);
}

function isMonoValue(key: string, value: unknown): boolean {
  return (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    ['ip', 'asn', 'latitude', 'longitude', 'postal_code'].includes(key)
  );
}

function syntaxHighlight(json: string) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?/g, (match) => {
      let cls = 'json-string';
      if (match.endsWith(':')) {
        cls = 'json-key';
        return `<span class="${cls}">${match.slice(0, -1)}</span>:`;
      }
      return `<span class="${cls}">${match}</span>`;
    })
    .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
    .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
    .replace(/\bnull\b/g, '<span class="json-null">null</span>');
}

function WebResultsCard({ results }: { results: WebResult[] }) {
  return (
    <div className="result-card web-results-card full-width">
      <div className="card-label">Web Results</div>
      <div className="web-results-list">
        {results.map((res) => (
          <div className="web-result-item" key={`${res.url}-${res.provider}`}>
            <a href={res.url} target="_blank" rel="noopener noreferrer" className="web-result-link">
              <span className="web-result-title">{res.title}</span>
              <span className="web-result-url">{res.url}</span>
            </a>
            {res.description && <p className="web-result-description">{res.description}</p>}
            <span className="web-result-provider badge">{res.provider}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenericCard({ label, value, isMono }: { label: string; value: string; isMono: boolean }) {
  return (
    <div className="result-card">
      <div className="card-label">{label}</div>
      <div className={`card-value${isMono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}

export function LookupResult({ data }: LookupResultProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const response = (data.response || {}) as Record<string, unknown>;
  const reqType = (data.request?.type || 'auto') as LookupType;

  const isSteam = reqType === 'steam' || 'steam_id_64' in response;
  const isUrl = reqType === 'url' || 'landing_url' in response;
  const isApk = reqType === 'apk' || 'package_name' in response;
  const isParcel = reqType === 'parcel' || 'tracking_number' in response;

  // Determine excluded keys based on card type
  let excludedKeys: string[] = [];
  if (isSteam) {
    excludedKeys = [
      'steam_links',
      'inventories',
      'total_inventory_items',
      'has_public_inventories',
      'username',
      'profile_url',
      'avatar_url',
      'persona_state',
      'community_visibility_state',
      'last_logoff',
      'real_name',
      'primary_clan_id',
      'created_at',
      'country_code',
      'state_code',
      'city_id',
      'game_extrainfo',
      'game_id',
      'community_banned',
      'vac_banned',
      'vac_bans_count',
      'days_since_last_ban',
      'game_bans_count',
      'economy_ban_state',
      'steam_id_64',
      'steam_id_2',
      'steam_id_3',
      'backpack_value_tf2',
      'trust_positive',
      'trust_negative',
      'backpack_tf_banned',
      'backpack_tf_premium',
      'csfloat_registered',
      'csfloat_username',
      'csfloat_avatar',
      'csfloat_total_sales',
      'csfloat_total_purchases',
      'csfloat_median_delivery_seconds',
      'price_today',
      'price_lowest',
      'games_owned',
      'hours_played',
      'game_count',
      'total_playtime_hours',
      'most_played_game',
      'avatar_icon',
      'avatar_medium',
      'avatar_full',
      'privacy_state',
      'custom_url',
      'member_since',
      'headline',
      'summary',
      'state_message',
      'trade_ban_state',
      'is_limited_account',
    ];
  } else if (isUrl) {
    excludedKeys = [
      'query',
      'landing_url',
      'http_status',
      'content_type',
      'content_length',
      'server',
      'powered_by',
      'redirect_chain',
      'is_redirected',
      'security_headers',
      'ssl',
      'meta',
    ];
  } else if (isApk) {
    excludedKeys = [
      'package_name',
      'package',
      'title',
      'version',
      'versionName',
      'developer',
      'developer_email',
      'score',
      'installs',
      'genre',
      'price',
      'is_free',
      'free_provider',
      'updated',
      'url',
      'icon',
      'downloads',
      'application',
      'manifest',
      'usesPermissions',
      'permissions',
      'checksums',
      'filelist',
    ];
  } else if (isParcel) {
    excludedKeys = [
      'tracking_number',
      'carrier',
      'status',
      'status_code',
      'status_description',
      'delivered',
      'origin',
      'destination',
      'weight',
      'estimated_delivery',
      'days_in_transit',
      'events',
      'couriers',
    ];
  }

  // Check for geographic coordinates
  const hasLatLong =
    (typeof response.latitude === 'number' && typeof response.longitude === 'number') ||
    (typeof response.lat === 'number' && typeof response.lon === 'number') ||
    (typeof response.lat === 'number' && typeof response.lng === 'number');

  if (hasLatLong && !isParcel) {
    excludedKeys.push('latitude', 'longitude', 'lat', 'lon', 'lng');
  }

  // Build geo coordinates for map
  const geoCoordinates: { lat: number; lng: number; label: string }[] = [];
  if (hasLatLong && !isParcel) {
    const lat = (
      typeof response.latitude === 'number' ? response.latitude : response.lat
    ) as number;
    const lng = (
      typeof response.longitude === 'number' ? response.longitude : (response.lon ?? response.lng)
    ) as number;
    const label =
      (response.formatted_address as string) ||
      (response.display_name as string) ||
      (response.city as string) ||
      (response.ip as string) ||
      'Location Pin';
    geoCoordinates.push({ lat, lng, label });
  }

  // Collect provider errors
  const errors = data.errors || {};
  const errorKeys = Object.keys(errors);

  return (
    <section id="results-section" className="results-section">
      {/* Meta header */}
      <div className="results-header">
        <h2 className="results-title">Results</h2>
        <div className="results-meta">
          {data.lookup_time && <span className="meta-badge">{data.lookup_time}</span>}
          <span className="meta-badge type-badge">{reqType.toUpperCase()}</span>
          {data.lookup_time?.includes('cached') && (
            <span className="meta-badge cached">cached</span>
          )}
        </div>
      </div>

      {/* Result cards grid */}
      <div className="result-cards">
        {/* Premium custom cards */}
        {isSteam && <SteamProfileCard response={response} />}
        {isUrl && <UrlMetadataCard response={response} />}
        {isApk && <ApkCard response={response} />}
        {isParcel && (
          <ParcelTimeline
            trackingNumber={(response.tracking_number as string) || 'Unknown'}
            carrier={
              Array.isArray(response.couriers)
                ? (response.couriers as string[]).join(', ')
                : 'Unknown'
            }
            delivered={!!response.delivered}
            origin={response.origin as string}
            destination={response.destination as string}
            estimatedDelivery={response.estimated_delivery as string}
            events={(response.events as unknown as import('../types/api').ParcelEvent[]) || []}
            latitude={response.latitude as number}
            longitude={response.longitude as number}
          />
        )}

        {/* Priority key cards */}
        {CARD_KEYS.filter(
          (key) =>
            !excludedKeys.includes(key) &&
            key in response &&
            response[key] != null &&
            response[key] !== '',
        ).map((key) => (
          <GenericCard
            key={key}
            label={formatLabel(key)}
            value={formatValue(key, response[key])}
            isMono={isMonoValue(key, response[key])}
          />
        ))}

        {/* Location map */}
        {geoCoordinates.length > 0 && <MapCard coordinates={geoCoordinates} />}

        {/* Email array */}
        {Array.isArray(response.emails) &&
          (response.emails as string[]).map((email) => (
            <GenericCard key={email} label="email" value={email} isMono={false} />
          ))}

        {/* Remaining non-priority keys */}
        {Object.entries(response)
          .filter(
            ([key, value]) =>
              !CARD_KEYS.includes(key) &&
              !excludedKeys.includes(key) &&
              key !== 'web' &&
              key !== 'emails' &&
              value != null &&
              value !== '' &&
              typeof value !== 'object',
          )
          .map(([key, value]) => (
            <GenericCard
              key={key}
              label={formatLabel(key)}
              value={formatValue(key, value)}
              isMono={isMonoValue(key, value)}
            />
          ))}

        {/* Web results at bottom */}
        {Array.isArray(response.web) && <WebResultsCard results={response.web as WebResult[]} />}
      </div>

      {/* JSON viewer */}
      <details
        className="json-details"
        open={jsonOpen}
        onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="json-summary">Full JSON Response</summary>
        <pre
          className="json-viewer"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted JSON syntax highlighting generated locally
          dangerouslySetInnerHTML={{
            __html: syntaxHighlight(JSON.stringify(data, null, 2)),
          }}
        />
      </details>

      {/* Provider errors */}
      {errorKeys.length > 0 && (
        <div className="errors-section">
          <h3 className="errors-title">⚠ Provider Errors</h3>
          <div className="errors-list">
            {errorKeys.map((provider) => (
              <div className="error-item" key={provider}>
                <span className="error-provider">{provider}</span>
                <span className="error-message">{errors[provider]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
