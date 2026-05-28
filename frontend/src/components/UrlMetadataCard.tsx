interface UrlMetadataCardProps {
  response: Record<string, unknown>;
}

function siteNameFromUrl(urlStr: string) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return '';
  }
}

export function UrlMetadataCard({ response: res }: UrlMetadataCardProps) {
  const meta = (res.meta || {}) as Record<string, unknown>;
  const title = (meta.title as string) || (res.query as string) || 'Scanned URL';
  const description = (meta.description as string) || 'No description available for this page.';
  const landingUrl = (res.landing_url as string) || (res.query as string) || '';
  const httpStatus = (res.http_status as number) || 200;

  let faviconUrl: string;
  try {
    faviconUrl =
      (meta.favicon as string) ||
      `https://www.google.com/s2/favicons?domain=${new URL(landingUrl).hostname}&sz=32`;
  } catch {
    faviconUrl = '';
  }

  let statusClass = 'badge-success';
  if (httpStatus >= 300 && httpStatus < 400) statusClass = 'badge-warning';
  if (httpStatus >= 400) statusClass = 'badge-danger';

  const techBadges: { label: string; value: string }[] = [];
  if (res.server) techBadges.push({ label: 'Server', value: res.server as string });
  if (res.powered_by) techBadges.push({ label: 'Powered by', value: res.powered_by as string });
  if (res.content_type) techBadges.push({ label: 'Type', value: res.content_type as string });
  if (res.content_length)
    techBadges.push({
      label: 'Size',
      value: `${((res.content_length as number) / 1024).toFixed(2)} KB`,
    });

  // Open Graph
  const og = (meta.open_graph || {}) as Record<string, string>;
  const twitter = (meta.twitter || {}) as Record<string, string>;
  const ogTitle = og.title || twitter.title;
  const ogDesc = og.description || twitter.description;
  const ogImg = og.image || twitter.image;
  const siteName = og.site_name || siteNameFromUrl(landingUrl);

  // Redirect chain
  const redirectChain = (res.redirect_chain || []) as Array<{ url: string; status: number }>;

  // SSL
  const ssl = res.ssl as Record<string, unknown> | undefined;

  // Security headers
  const secHeaders = res.security_headers as Record<string, string | null> | undefined;

  const headerLabels: Record<string, string> = {
    content_security_policy: 'Content-Security-Policy',
    strict_transport_security: 'Strict-Transport-Security',
    x_frame_options: 'X-Frame-Options',
    x_content_type_options: 'X-Content-Type-Options',
    x_xss_protection: 'X-XSS-Protection',
    referrer_policy: 'Referrer-Policy',
  };

  return (
    <>
      {/* Main metadata card */}
      <div className="url-metadata-card full-width">
        <div className="url-meta-header">
          {faviconUrl && (
            <div className="url-favicon-wrapper">
              <img src={faviconUrl} alt="Favicon" className="url-favicon" />
            </div>
          )}
          <div className="url-title-wrapper">
            <h3 className="url-page-title">{title}</h3>
            <a
              href={landingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="url-landing-link"
            >
              {landingUrl}
            </a>
          </div>
          <div className="url-status-badge">
            <span className={`badge ${statusClass}`}>HTTP {httpStatus}</span>
          </div>
        </div>
        <p className="url-page-description">{description}</p>
        {techBadges.length > 0 && (
          <div className="url-tech-info">
            {techBadges.map((b) => (
              <span key={b.label} className="badge tech-badge">
                {b.label}: {b.value}
              </span>
            ))}
          </div>
        )}
        {(ogTitle || ogDesc || ogImg) && (
          <div className="og-embed-preview">
            <div className="og-embed-site">{siteName}</div>
            {ogTitle && (
              <div className="og-embed-title">
                <a href={landingUrl} target="_blank" rel="noopener noreferrer">
                  {ogTitle}
                </a>
              </div>
            )}
            {ogDesc && <div className="og-embed-description">{ogDesc}</div>}
            {ogImg && (
              <div className="og-embed-image-wrapper">
                <img src={ogImg} alt="Open Graph Preview" className="og-embed-image" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Redirect chain */}
      {redirectChain.length > 0 && (
        <div className="url-redirect-card full-width">
          <div className="card-label">
            Redirect Flow ({redirectChain.length} redirect
            {redirectChain.length > 1 ? 's' : ''})
          </div>
          <div className="redirect-flow-container">
            {redirectChain.map((step, idx) => (
              <div className="redirect-step" key={`${step.url}-${step.status}`}>
                <div className="redirect-node">
                  <span className="redirect-index">{idx + 1}</span>
                  <div className="redirect-url-info">
                    <span className="redirect-url-text">{step.url}</span>
                    <span className="badge badge-warning">HTTP {step.status}</span>
                  </div>
                </div>
                <div className="redirect-arrow">↓</div>
              </div>
            ))}
            <div className="redirect-step final-step">
              <div className="redirect-node">
                <span className="redirect-index">✔</span>
                <div className="redirect-url-info">
                  <span className="redirect-url-text final">{landingUrl}</span>
                  <span className="badge badge-success">HTTP {httpStatus}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SSL certificate */}
      {ssl && (
        <div className="url-ssl-card full-width">
          <div className="ssl-header-row">
            <div className="ssl-title">
              <span className="ssl-icon">🔒</span>
              <strong>SSL Certificate Details</strong>
            </div>
            <span
              className={`badge ${
                (ssl.days_remaining as number) <= 0 || ssl.is_expired
                  ? 'badge-danger blink'
                  : (ssl.days_remaining as number) < 30
                    ? 'badge-warning'
                    : 'badge-success'
              }`}
            >
              {Number(ssl.days_remaining) <= 0 || ssl.is_expired
                ? 'Expired!'
                : `${String(ssl.days_remaining)} days remaining`}
            </span>
          </div>
          <div className="ssl-details-grid">
            <div className="ssl-detail-item">
              <span className="ssl-label">Subject CN:</span>
              <span className="ssl-value font-bold">{ssl.subject as string}</span>
            </div>
            {typeof ssl.subject_org === 'string' && (
              <div className="ssl-detail-item">
                <span className="ssl-label">Organization:</span>
                <span className="ssl-value">{ssl.subject_org}</span>
              </div>
            )}
            <div className="ssl-detail-item">
              <span className="ssl-label">Issuer:</span>
              <span className="ssl-value">{ssl.issuer as string}</span>
            </div>
            {typeof ssl.issuer_org === 'string' && (
              <div className="ssl-detail-item">
                <span className="ssl-label">Issuer Org:</span>
                <span className="ssl-value">{ssl.issuer_org}</span>
              </div>
            )}
            <div className="ssl-detail-item">
              <span className="ssl-label">Validity Period:</span>
              <span className="ssl-value">
                {new Date(ssl.valid_from as string).toLocaleDateString()} to{' '}
                {new Date(ssl.valid_to as string).toLocaleDateString()}
              </span>
            </div>
            <div className="ssl-detail-item full-width-item">
              <span className="ssl-label">Serial Number:</span>
              <code className="ssl-code">{ssl.serial_number as string}</code>
            </div>
            <div className="ssl-detail-item full-width-item">
              <span className="ssl-label">SHA-256 Fingerprint:</span>
              <code className="ssl-code">{ssl.fingerprint as string}</code>
            </div>
          </div>
        </div>
      )}

      {/* Security headers */}
      {secHeaders && (
        <div className="url-headers-card full-width">
          {(() => {
            let secureCount = 0;
            const items = Object.entries(headerLabels).map(([key, label]) => {
              const val = secHeaders[key];
              const isSecured = val != null;
              if (isSecured) secureCount++;
              return { key, label, val, isSecured };
            });
            const pct = Math.round((secureCount / 6) * 100);
            let scoreClass = 'badge-danger';
            if (pct >= 50) scoreClass = 'badge-warning';
            if (pct >= 80) scoreClass = 'badge-success';

            return (
              <>
                <div className="headers-header-row">
                  <div>
                    <span className="ssl-icon">🛡</span>
                    <strong>Security Headers Check</strong>
                  </div>
                  <span className={`badge ${scoreClass}`}>
                    {secureCount} / 6 Secured ({pct}%)
                  </span>
                </div>
                <div className="headers-checklist">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={`header-check-item ${item.isSecured ? 'secured' : 'missing'}`}
                    >
                      <div className="header-check-info">
                        <span className="header-check-bullet">{item.isSecured ? '✓' : '✗'}</span>
                        <strong className="header-name">{item.label}</strong>
                      </div>
                      <div className="header-value-box">
                        {item.isSecured ? (
                          <code className="header-val">{item.val}</code>
                        ) : (
                          <span className="header-missing-msg">Missing (High Risk)</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
