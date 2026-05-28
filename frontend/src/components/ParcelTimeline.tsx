import type { ParcelEvent } from '../types/api';
import { MapCard } from './MapCard';

interface ParcelTimelineProps {
  trackingNumber: string;
  carrier: string;
  delivered: boolean;
  origin?: string;
  destination?: string;
  estimatedDelivery?: string;
  events: ParcelEvent[];
  latitude?: number;
  longitude?: number;
}

export function ParcelTimeline({
  trackingNumber,
  carrier,
  delivered,
  events,
  latitude,
  longitude,
}: ParcelTimelineProps) {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // Build coordinate list from events + top-level coords
  const coordinates: { lat: number; lng: number; label: string }[] = [];
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    coordinates.push({ lat: latitude, lng: longitude, label: 'Current Position' });
  }
  events.forEach((evt) => {
    if (typeof evt.latitude === 'number' && typeof evt.longitude === 'number') {
      coordinates.push({
        lat: evt.latitude,
        lng: evt.longitude,
        label: evt.status || 'Transit checkpoint',
      });
    }
  });

  return (
    <div className="parcel-dual-pane full-width">
      <div className="parcel-timeline-pane">
        <div style={{ marginBottom: '1rem' }}>
          <h3 className="parcel-timeline-title">📦 Tracking Timeline</h3>
          <div className="parcel-timeline-meta">
            Carrier: <strong>{carrier || 'Unknown'}</strong> &bull; Delivered:{' '}
            <strong>{delivered ? '✓ Yes' : '✗ No'}</strong>
          </div>
          <div className="parcel-tracking-number mono">{trackingNumber}</div>
        </div>
        <div className="timeline-container">
          {sortedEvents.length === 0 ? (
            <div className="timeline-empty">No tracking history events recorded yet.</div>
          ) : (
            sortedEvents.map((evt, idx) => {
              const timeStr = evt.date ? new Date(evt.date).toLocaleString() : 'N/A';
              const isLatest = idx === 0;
              return (
                <div
                  className={`timeline-event${isLatest ? ' latest' : ''}`}
                  key={`${evt.date}-${evt.status}-${evt.source}`}
                >
                  <div className="timeline-dot" />
                  <div className="timeline-time">{timeStr}</div>
                  <div className="timeline-desc">{evt.status || evt.description || ''}</div>
                  {evt.location && <div className="timeline-loc">📍 {evt.location}</div>}
                  {evt.source && <span className="timeline-source">{evt.source}</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="parcel-map-pane">
        {coordinates.length > 0 ? (
          <MapCard coordinates={coordinates} title="📦 Route Map" height={450} />
        ) : (
          <MapCard
            coordinates={[{ lat: 51.1657, lng: 10.4515, label: 'Geographic routing not provided' }]}
            title="📦 Route Map"
            height={450}
          />
        )}
      </div>
    </div>
  );
}
