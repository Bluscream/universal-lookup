import type { AppEntry } from '../types/api';

interface AppTableProps {
  apps: AppEntry[];
}

function formatUpdated(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/**
 * The combined software list, as a table.
 *
 * One row per source that carries the package, because that is the question the
 * app lookup answers: where does this software come from, and at what version.
 * Sorted by source so the same source's rows stay together, and packages with a
 * version first — a row without one is the weaker answer.
 */
export function AppTable({ apps }: AppTableProps) {
  if (apps.length === 0) return null;

  const rows = [...apps].sort((a, b) => {
    if (!!a.version !== !!b.version) return a.version ? -1 : 1;
    return a.source.localeCompare(b.source) || a.name.localeCompare(b.name);
  });

  return (
    <div className="app-table-card full-width">
      <h4 className="section-title">
        📦 Software packages <span className="badge badge-info">{rows.length}</span>
      </h4>
      <div className="app-table-scroll">
        <table className="app-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Name</th>
              <th>Version</th>
              <th>Package</th>
              <th>Description</th>
              <th>License</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((app) => (
              <tr key={`${app.source}-${app.id ?? app.name}-${app.version ?? ''}`}>
                <td>
                  <span className="badge badge-primary">{app.source}</span>
                </td>
                <td className="app-name">
                  {app.url ? (
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="detail-link"
                    >
                      {app.name}
                    </a>
                  ) : (
                    app.name
                  )}
                </td>
                <td className="mono">{app.version || '—'}</td>
                <td className="mono app-id" title={app.install || undefined}>
                  {app.id || '—'}
                </td>
                <td className="app-desc">{app.description || '—'}</td>
                <td>{app.license || '—'}</td>
                <td>{formatUpdated(app.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
