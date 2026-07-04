export function OrderCard({ response }: { response: Record<string, unknown> }) {
  const items = response.items as Array<{ name: string; url?: string }> | undefined;
  const trackingNumbers = response.tracking_numbers as string[] | undefined;
  const shipments = response.shipments as
    | Array<{
        tracking_url?: string;
        tracking_id?: string;
        item_id?: string;
        package_index?: string;
      }>
    | undefined;

  if (
    (!items || items.length === 0) &&
    (!trackingNumbers || trackingNumbers.length === 0) &&
    (!shipments || shipments.length === 0)
  ) {
    return null;
  }

  return (
    <div className="result-card full-width" style={{ flexDirection: 'column', gap: '1rem' }}>
      <div className="card-label" style={{ marginBottom: '0.5rem' }}>
        Order Details
      </div>

      {trackingNumbers && trackingNumbers.length > 0 && !shipments && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong>Tracking Numbers:</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {trackingNumbers.map((id) => (
              <span key={id} className="badge" style={{ padding: '0.5rem', fontSize: '0.9rem' }}>
                {id}
              </span>
            ))}
          </div>
        </div>
      )}

      {shipments && shipments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <strong>Shipments:</strong>
          {shipments.map((shipment, sIdx) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: shipments have no unique ID and order is stable
              key={sIdx}
              className="result-card"
              style={{
                flexDirection: 'column',
                gap: '0.5rem',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              {shipment.tracking_id && (
                <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  Tracking ID: {shipment.tracking_id}
                </div>
              )}
              {shipment.tracking_url && (
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <a
                    href={`/shipment/${encodeURIComponent(shipment.tracking_url)}`}
                    style={{
                      color: 'var(--accent-primary)',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    Track Package 📦
                  </a>
                  <a
                    href={shipment.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.85rem', opacity: 0.7, color: 'var(--text-secondary)' }}
                  >
                    (External Link)
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {items && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong>Items:</strong>
          <ul
            style={{
              margin: 0,
              paddingLeft: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {items.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items have no unique ID and order is stable
              <li key={i}>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
                  >
                    {item.name}
                  </a>
                ) : (
                  <span>{item.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
