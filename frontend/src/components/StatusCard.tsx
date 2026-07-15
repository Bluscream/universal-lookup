import { AlertTriangle, CheckCircle2, CircleDashed, Wrench } from 'lucide-react';
import type { StatusIncident, StatusIndicator, StatusServiceEntry } from '../types/api';
import { ServiceLogo } from './ServiceLogo';

/** Colour + icon for each canonical indicator. */
const INDICATOR_META: Record<StatusIndicator, { color: string; label: string }> = {
  none: { color: '#22c55e', label: 'Operational' },
  minor: { color: '#eab308', label: 'Minor issues' },
  major: { color: '#f97316', label: 'Major outage' },
  critical: { color: '#ef4444', label: 'Critical outage' },
  maintenance: { color: '#3b82f6', label: 'Maintenance' },
  unknown: { color: '#6b7280', label: 'Unknown' },
};

function meta(indicator: StatusIndicator) {
  return INDICATOR_META[indicator] ?? INDICATOR_META.unknown;
}

function isMaintenance(
  statusText?: string | null,
  name?: string | null,
  indicator?: string | null,
  impact?: string | null
): boolean {
  if (indicator === 'maintenance' || impact === 'maintenance') return true;
  const matchPattern = /mainten/i;
  if (statusText && matchPattern.test(statusText)) return true;
  if (name && matchPattern.test(name)) return true;
  return false;
}

function IndicatorIcon({ indicator }: { indicator: StatusIndicator }) {
  const { color } = meta(indicator);
  if (indicator === 'none') return <CheckCircle2 size={18} color={color} />;
  if (indicator === 'maintenance') return <Wrench size={18} color={color} />;
  if (indicator === 'unknown') return <CircleDashed size={18} color={color} />;
  return <AlertTriangle size={18} color={color} />;
}

function ServiceTile({ s }: { s: StatusServiceEntry }) {
  const isMaint = isMaintenance(s.status, s.name, s.indicator);
  const m = isMaint ? INDICATOR_META.maintenance : meta(s.indicator);
  const tile = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.6rem 0.75rem',
        borderRadius: '0.5rem',
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${m.color}33`,
        borderLeft: `3px solid ${m.color}`,
      }}
    >
      <IndicatorIcon indicator={isMaint ? 'maintenance' : s.indicator} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <ServiceLogo service={s.service} /> {s.name}
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: m.color,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {s.status}
          {s.active_incidents ? ` (${s.active_incidents})` : ''}
        </div>
      </div>
    </div>
  );

  return s.page_url ? (
    <a href={s.page_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
      {tile}
    </a>
  ) : (
    tile
  );
}

const CATEGORY_ORDER = ['AI', 'Cloud', 'Games', 'Web', 'Other'];

/** Group services by category, categories in preferred order, services A–Z within. */
function groupByCategory(services: StatusServiceEntry[]): Array<[string, StatusServiceEntry[]]> {
  const groups = new Map<string, StatusServiceEntry[]>();
  for (const s of services) {
    const cat = s.category || 'Other';
    const list = groups.get(cat) ?? [];
    list.push(s);
    groups.set(cat, list);
  }
  const cats = [
    ...CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ];
  return cats.map((c) => [
    c,
    (groups.get(c) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
  ]);
}

export function StatusCard({ response }: { response: Record<string, unknown> }) {
  const services = (response.services as StatusServiceEntry[] | undefined) || [];
  const incidents = (response.incidents as StatusIncident[] | undefined) || [];

  if (services.length === 0 && incidents.length === 0) return null;

  const down = services.filter((s) => !s.operational);
  const allOk = down.length === 0 && services.length > 0;

  return (
    <div className="result-card full-width" style={{ flexDirection: 'column', gap: '1rem' }}>
      {/* Header / rollup */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <div className="card-label">Service Status</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontWeight: 600,
            color: allOk ? INDICATOR_META.none.color : INDICATOR_META.major.color,
          }}
        >
          {allOk ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {allOk
            ? `All ${services.length} services operational`
            : `${down.length} of ${services.length} services affected`}
        </div>
      </div>

      {/* Service grid, grouped by category */}
      {groupByCategory(services).map(([category, entries]) => (
        <div key={category}>
          <div
            className="card-label"
            style={{ marginBottom: '0.4rem', fontSize: '0.75rem', opacity: 0.7 }}
          >
            {category}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.6rem',
            }}
          >
            {entries.map((s) => (
              <ServiceTile key={s.service} s={s} />
            ))}
          </div>
        </div>
      ))}

      {/* Active incidents */}
      {incidents.length > 0 && (
        <div>
          <div className="card-label" style={{ marginBottom: '0.5rem' }}>
            Active Incidents ({incidents.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {incidents
              .slice()
              .sort((a, b) => a.service.localeCompare(b.service))
              .map((inc) => {
                const isMaint = isMaintenance(inc.status, inc.name, null, inc.impact);
                const color = isMaint ? INDICATOR_META.maintenance.color : INDICATOR_META.major.color;
                const bg = isMaint ? 'rgba(59,130,246,0.06)' : 'rgba(249,115,22,0.06)';
                return (
                  <a
                    key={`${inc.service}-${inc.name}`}
                    href={inc.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.6rem',
                      padding: '0.5rem 0.6rem',
                      borderRadius: '0.4rem',
                      background: bg,
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        color: color,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isMaint ? <Wrench size={13} color={color} /> : <ServiceLogo service={inc.service} size={13} />}
                      {inc.service}
                    </span>
                    <span style={{ flex: 1 }}>{inc.name}</span>
                    {inc.status && (
                      <span style={{ fontSize: '0.75rem', opacity: 0.7, whiteSpace: 'nowrap' }}>
                        {inc.status}
                      </span>
                    )}
                  </a>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
