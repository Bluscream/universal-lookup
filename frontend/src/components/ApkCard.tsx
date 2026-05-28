interface ApkCardProps {
  response: Record<string, unknown>;
}

export function ApkCard({ response: res }: ApkCardProps) {
  if (!res.package_name && !res.package) return null;

  const icon = (res.icon as string) || '';
  const title =
    (res.title as string) ||
    (res.package_name as string) ||
    (res.package as string) ||
    'Unknown App';
  const developer = (res.developer as string) || 'Unknown Developer';
  const devEmail = res.developer_email as string;
  const version = (res.version as string) || (res.versionName as string) || 'N/A';
  const price = (res.price as string) || (res.is_free ? 'Free' : 'N/A');
  const score = res.score ? parseFloat(String(res.score)).toFixed(1) : 'N/A';
  const installs = (res.installs as string) || 'N/A';
  const genre = (res.genre as string) || 'N/A';
  const updated = res.updated ? new Date(res.updated as string).toLocaleDateString() : 'N/A';

  const downloads = (res.downloads || []) as Array<{
    source: string;
    url: string;
    size?: number;
    status?: number;
  }>;

  return (
    <div className="apk-card full-width">
      <div className="url-meta-header apk-header">
        {icon && (
          <div className="url-favicon-wrapper apk-icon-wrapper">
            <img src={icon} alt="App Icon" className="url-favicon apk-icon" />
          </div>
        )}
        <div className="url-title-wrapper">
          <h3 className="url-page-title">
            {title} <span className="badge badge-info">{version}</span>
          </h3>
          <div className="apk-developer">
            {developer}
            {devEmail && (
              <>
                {' '}
                (
                <a href={`mailto:${devEmail}`} className="detail-link">
                  {devEmail}
                </a>
                )
              </>
            )}
          </div>
        </div>
        <div className="url-status-badge download-badges">
          <span className="badge badge-warning">⭐ {score}</span>
          <span className="badge badge-success">⬇️ {installs}</span>
          <span className="badge badge-primary">🏷️ {genre}</span>
          <span className="badge badge-dark">💰 {price}</span>
        </div>
      </div>

      <div className="ssl-details-grid apk-meta-details">
        <div className="ssl-detail-item">
          <span className="ssl-label">Package Name</span>
          <span className="ssl-value mono">
            {(res.package_name as string) || (res.package as string)}
          </span>
        </div>
        <div className="ssl-detail-item">
          <span className="ssl-label">Last Updated</span>
          <span className="ssl-value">{updated}</span>
        </div>
      </div>

      {downloads.length > 0 && (
        <div className="apk-downloads-section">
          <h4 className="section-title">📥 Downloads</h4>
          <div className="apk-downloads-list">
            {downloads.map((dl) => (
              <div className="apk-download-item" key={`${dl.source}-${dl.url}`}>
                <a href={dl.url} target="_blank" rel="noopener noreferrer" className="detail-link">
                  <span className="dl-source font-bold">{dl.source}</span>
                </a>
                <div className="download-badges">
                  {dl.size && (
                    <span className="badge badge-info">
                      {(dl.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  )}
                  <span className={`badge ${dl.status === 200 ? 'badge-success' : 'badge-danger'}`}>
                    HTTP {dl.status || 'Unknown'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
