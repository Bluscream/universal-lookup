import type { StatusServiceEntry } from '@universal-lookup/common';
import { Activity, Calendar } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { ServiceLogo } from './ServiceLogo';

const PALETTE = [
  '#E65100', // BARQ orange
  '#5865F2', // Discord blurple
  '#22C55E', // Green
  '#3B82F6', // Blue
  '#A855F7', // Purple
  '#EC4899', // Pink
  '#F59E0B', // Amber
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#6366F1', // Indigo
];

function formatDateLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function UptimeGraph({ services }: { services: StatusServiceEntry[] }) {
  const chartId = useId();
  const [daysWindow, setDaysWindow] = useState<30 | 90>(30);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hiddenServices, setHiddenServices] = useState<Set<string>>(() => new Set());

  // Only render if at least one service has history datapoints
  const hasAnyHistory = useMemo(
    () => services.some((s) => Array.isArray(s.history) && s.history.length > 0),
    [services],
  );

  // Collect the timeline dates from services that provide history
  const allDates = useMemo(() => {
    const datesSet = new Set<string>();
    for (const s of services) {
      if (Array.isArray(s.history)) {
        for (const pt of s.history) {
          if (pt.date) datesSet.add(pt.date);
        }
      }
    }
    const sorted = [...datesSet].sort();
    return sorted.slice(-daysWindow);
  }, [services, daysWindow]);

  // Color assignments per service
  const serviceColors = useMemo(() => {
    const colors = new Map<string, string>();
    services.forEach((s, idx) => {
      const color = s.service_color || PALETTE[idx % PALETTE.length];
      colors.set(s.service, color);
    });
    return colors;
  }, [services]);

  // Map each service to an array of ratios aligned to allDates
  const seriesData = useMemo(() => {
    if (allDates.length === 0) return [];

    return services.map((s) => {
      const historyMap = new Map<string, number>();
      if (Array.isArray(s.history)) {
        for (const pt of s.history) {
          if (pt.date) historyMap.set(pt.date, pt.ratio);
        }
      }

      const points = allDates.map((date) => {
        if (historyMap.has(date)) {
          return historyMap.get(date)!;
        }
        // Baseline fallback for services without daily history: 100% operational
        return s.operational ? 100 : 0;
      });

      // Calculate average over the active window
      const avg =
        points.length > 0
          ? Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100
          : 100;

      return {
        service: s.service,
        name: s.name,
        icon: s.icon,
        color: serviceColors.get(s.service) || '#3B82F6',
        points,
        avg,
      };
    });
  }, [services, allDates, serviceColors]);

  if (!hasAnyHistory || allDates.length === 0) {
    return null;
  }

  // Calculate Y-scale bounds
  let minRatio = 100;
  for (const series of seriesData) {
    if (hiddenServices.has(series.service)) continue;
    for (const val of series.points) {
      if (val < minRatio) minRatio = val;
    }
  }
  // Floor to nearest sensible round number (e.g. 95, 90, 80) so minor dips are prominent
  const yMin = Math.max(0, Math.floor((minRatio - 1) / 5) * 5);
  const yMax = 100;
  const yRange = Math.max(1, yMax - yMin);

  // SVG dimensions
  const width = 800;
  const height = 200;
  const paddingLeft = 45;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (idx: number) => {
    if (allDates.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (idx / (allDates.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return paddingTop + chartHeight - ((clamped - yMin) / yRange) * chartHeight;
  };

  // Build gridlines (3 to 5 horizontal ticks)
  const yTicks = [yMax];
  const step = yRange <= 5 ? 1 : yRange <= 15 ? 5 : yRange <= 40 ? 10 : 25;
  for (let val = yMax - step; val >= yMin; val -= step) {
    yTicks.push(val);
  }

  // X-axis label indices (5 evenly spaced labels)
  const xIndices: number[] = [];
  const numLabels = Math.min(5, allDates.length);
  for (let i = 0; i < numLabels; i++) {
    const idx = Math.round((i / (numLabels - 1)) * (allDates.length - 1));
    if (!xIndices.includes(idx)) xIndices.push(idx);
  }

  const toggleService = (srv: string) => {
    setHiddenServices((prev) => {
      const next = new Set(prev);
      if (next.has(srv)) next.delete(srv);
      else next.add(srv);
      return next;
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '0.85rem 1rem',
        borderRadius: '0.5rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Header and window controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <Activity size={16} color="#E65100" />
          <span>Uptime History</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 400 }}>
            ({allDates.length} days)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Calendar size={13} style={{ opacity: 0.6 }} />
          {([30, 90] as const).map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setDaysWindow(days)}
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.55rem',
                borderRadius: '0.3rem',
                border: '1px solid rgba(255,255,255,0.15)',
                background: daysWindow === days ? 'rgba(230,81,0,0.25)' : 'transparent',
                color: daysWindow === days ? '#FF9800' : 'inherit',
                cursor: 'pointer',
                fontWeight: daysWindow === days ? 600 : 400,
              }}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Service pill legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {seriesData.map((s) => {
          const isHidden = hiddenServices.has(s.service);
          return (
            <button
              key={s.service}
              type="button"
              onClick={() => toggleService(s.service)}
              title={isHidden ? `Show ${s.name}` : `Hide ${s.name}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.55rem',
                borderRadius: '1rem',
                fontSize: '0.75rem',
                background: isHidden ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isHidden ? 'transparent' : s.color}`,
                opacity: isHidden ? 0.4 : 1,
                cursor: 'pointer',
                color: 'inherit',
                transition: 'opacity 0.15s ease',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: s.color,
                }}
              />
              <ServiceLogo service={s.service} iconUrl={s.icon} size={12} />
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ opacity: 0.75, fontSize: '0.7rem' }}>{s.avg}%</span>
            </button>
          );
        })}
      </div>

      {/* SVG Chart */}
      <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            if (relX >= paddingLeft && relX <= width - paddingRight) {
              const frac = (relX - paddingLeft) / chartWidth;
              const idx = Math.max(
                0,
                Math.min(allDates.length - 1, Math.round(frac * (allDates.length - 1))),
              );
              setHoverIndex(idx);
            }
          }}
        >
          <title>Service Uptime History</title>
          <defs>
            {seriesData.map((s) => (
              <linearGradient
                key={s.service}
                id={`${chartId}-grad-${s.service}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
              </linearGradient>
            ))}
          </defs>

          {/* Gridlines & Y-axis labels */}
          {yTicks.map((tick) => {
            const y = getY(tick);
            return (
              <g key={tick}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="rgba(255,255,255,0.07)"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="rgba(255,255,255,0.4)"
                  fontSize="10"
                  fontFamily="sans-serif"
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* X-axis date labels */}
          {xIndices.map((idx) => {
            const x = getX(idx);
            const dateStr = allDates[idx];
            return (
              <text
                key={dateStr}
                x={x}
                y={height - 10}
                textAnchor={idx === 0 ? 'start' : idx === allDates.length - 1 ? 'end' : 'middle'}
                fill="rgba(255,255,255,0.45)"
                fontSize="10"
                fontFamily="sans-serif"
              >
                {formatDateLabel(dateStr)}
              </text>
            );
          })}

          {/* Area & Line for each active series */}
          {seriesData.map((s) => {
            if (hiddenServices.has(s.service)) return null;

            // Generate SVG path commands
            let pathD = '';
            s.points.forEach((val, idx) => {
              const x = getX(idx);
              const y = getY(val);
              pathD += idx === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
            });

            const areaD = `${pathD} L ${getX(s.points.length - 1)} ${getY(yMin)} L ${getX(0)} ${getY(yMin)} Z`;

            return (
              <g key={s.service}>
                <path d={areaD} fill={`url(#${chartId}-grad-${s.service})`} />
                <path
                  d={pathD}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Vertical hover guide and point dots */}
          {hoverIndex !== null && hoverIndex >= 0 && hoverIndex < allDates.length && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={paddingTop}
                x2={getX(hoverIndex)}
                y2={paddingTop + chartHeight}
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              {seriesData.map((s) => {
                if (hiddenServices.has(s.service)) return null;
                const val = s.points[hoverIndex];
                return (
                  <circle
                    key={s.service}
                    cx={getX(hoverIndex)}
                    cy={getY(val)}
                    r="4"
                    fill={s.color}
                    stroke="#1a1a1a"
                    strokeWidth="1.5"
                  />
                );
              })}
            </g>
          )}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoverIndex !== null && hoverIndex >= 0 && hoverIndex < allDates.length && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: `${Math.min(75, Math.max(10, (getX(hoverIndex) / width) * 100))}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(20, 20, 20, 0.95)',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              borderRadius: '0.4rem',
              padding: '0.4rem 0.6rem',
              pointerEvents: 'none',
              zIndex: 10,
              fontSize: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              minWidth: '130px',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                paddingBottom: '0.2rem',
              }}
            >
              {formatDateLabel(allDates[hoverIndex])}
            </div>
            {seriesData.map((s) => {
              if (hiddenServices.has(s.service)) return null;
              const ratio = s.points[hoverIndex];
              const ratioColor = ratio >= 99.9 ? '#22C55E' : ratio >= 99 ? '#F59E0B' : '#EF4444';
              return (
                <div
                  key={s.service}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: s.color,
                      }}
                    />
                    <span>{s.name}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: ratioColor }}>{ratio}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
