import { useState } from 'react';
import type { ShortLink } from '../types/api';

interface ShortLinksCardProps {
  longUrl: string;
  links: ShortLink[];
}

/**
 * The /shorten result: one row per service, each with its own copy button.
 *
 * Every row is a link that now exists on somebody's server, so a row that came
 * back from a service that already held the URL says so rather than looking
 * like a fresh one.
 */
export function ShortLinksCard({ longUrl, links }: ShortLinksCardProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
    } catch {
      // Clipboard access can be refused (no permission, insecure context). The
      // link is on screen and selectable either way, so this stays silent.
    }
  };

  return (
    <div className="result-card short-links-card full-width">
      <div className="card-label">
        Short Links ({links.length}) for{' '}
        <a href={longUrl} target="_blank" rel="noopener noreferrer">
          {longUrl}
        </a>
      </div>
      <div className="short-links-list">
        {links.map((link) => (
          <div className="short-link-item" key={`${link.service}-${link.short_url}`}>
            <span className="badge short-link-service">{link.service}</span>
            <a
              href={link.short_url}
              target="_blank"
              rel="noopener noreferrer"
              className="short-link-url mono"
            >
              {link.short_url}
            </a>
            {link.existing && (
              <span className="badge badge-warning" title="The service already had this URL">
                existing
              </span>
            )}
            {typeof link.clicks === 'number' && <span className="badge">{link.clicks} clicks</span>}
            <button
              type="button"
              className="short-link-copy"
              onClick={() => copy(link.short_url)}
              aria-label={`Copy the ${link.service} short link`}
            >
              {copied === link.short_url ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
