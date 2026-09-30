import type { ArchiveSaveState, ArchiveServiceResult, ArchiveSnapshot } from '../types/api';

interface ArchiveCardProps {
  response: Record<string, unknown>;
}

const SERVICE_LABELS: Record<string, string> = {
  wayback: 'Wayback Machine',
  'archive-today': 'archive.today',
  ghostarchive: 'Ghostarchive',
  'arquivo-pt': 'arquivo.pt',
  'perma-cc': 'perma.cc',
};

const STATE_LABELS: Record<ArchiveSaveState, string> = {
  saved: 'Saved now',
  existing: 'Already archived',
  'not-archived': 'No snapshot',
  'read-only': 'Cannot submit',
  unconfigured: 'Not configured',
};

/** Green for a copy that exists, amber for a service that cannot be written to. */
const STATE_BADGES: Record<ArchiveSaveState, string> = {
  saved: 'badge-success',
  existing: 'badge-success',
  'not-archived': 'badge-warning',
  'read-only': 'badge-warning',
  unconfigured: 'badge-warning',
};

function label(service: string): string {
  return SERVICE_LABELS[service] ?? service;
}

function formatDate(timestamp: string | undefined): string {
  if (!timestamp) return 'date unknown';
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toLocaleString();
}

function SnapshotRow({ snapshot }: { snapshot: ArchiveSnapshot }) {
  return (
    <div className="archive-snapshot">
      <a
        href={snapshot.snapshot_url}
        target="_blank"
        rel="noopener noreferrer"
        className="archive-snapshot-link"
      >
        {snapshot.snapshot_url}
      </a>
      <span className="archive-snapshot-meta">
        {formatDate(snapshot.timestamp)}
        {snapshot.http_status ? ` · HTTP ${snapshot.http_status}` : ''}
        {snapshot.saved_now ? ' · just saved' : ''}
      </span>
    </div>
  );
}

export function ArchiveCard({ response }: ArchiveCardProps) {
  const services = (response.archives ?? []) as ArchiveServiceResult[];
  const snapshots = (response.snapshots ?? []) as ArchiveSnapshot[];
  const originalUrl = (response.original_url as string) || '';
  const saveRequested = response.save_requested === true;
  const savedCount = snapshots.filter((s) => s.saved_now).length;

  return (
    <div className="archive-card full-width">
      <div className="archive-header">
        <div>
          <h3 className="archive-title">Web archives</h3>
          {originalUrl && (
            <a
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="archive-original-url"
            >
              {originalUrl}
            </a>
          )}
        </div>
        <div className="archive-header-badges">
          <span className={`badge ${snapshots.length ? 'badge-success' : 'badge-warning'}`}>
            {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
          </span>
          {/* Saving publishes the URL, so whether this request did is worth
              stating outright rather than leaving to be inferred from a date. */}
          <span className={`badge ${saveRequested ? 'badge-danger' : 'tech-badge'}`}>
            {saveRequested ? `Save requested · ${savedCount} published` : 'Read-only lookup'}
          </span>
        </div>
      </div>

      {!saveRequested && (
        <p className="archive-hint">
          This lookup only reported existing copies. Add <code>?save=true</code> to publish the URL
          to the archives that accept submissions — that is public and cannot be undone.
        </p>
      )}

      <div className="archive-services">
        {services.map((service) => (
          <div className="archive-service" key={service.service}>
            <div className="archive-service-header">
              <strong>{label(service.service)}</strong>
              <span className={`badge ${STATE_BADGES[service.status] ?? 'tech-badge'}`}>
                {STATE_LABELS[service.status] ?? service.status}
              </span>
            </div>
            {service.note && <p className="archive-service-note">{service.note}</p>}
            {(service.snapshots ?? []).slice(0, 5).map((snapshot) => (
              <SnapshotRow key={snapshot.snapshot_url} snapshot={snapshot} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
