import { Loader2, Search } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { LOOKUP_OPTIONS, type LookupType, PLACEHOLDERS } from '../types/api';

interface SearchBarProps {
  onSearch: (
    type: LookupType,
    query: string,
    options: { raw: boolean; fresh: boolean; wait: boolean },
  ) => void;
  isLoading: boolean;
  initialType?: LookupType;
  initialQuery?: string;
  initialRaw?: boolean;
  initialFresh?: boolean;
  initialWait?: boolean;
}

export function SearchBar({
  onSearch,
  isLoading,
  initialType,
  initialQuery,
  initialRaw = false,
  initialFresh = false,
  initialWait = false,
}: SearchBarProps) {
  const [type, setType] = useState<LookupType>(initialType || 'auto');
  const [query, setQuery] = useState(initialQuery || '');
  const [raw, setRaw] = useState(initialRaw);
  const [fresh, setFresh] = useState(initialFresh);
  const [wait, setWait] = useState(initialWait);

  useEffect(() => {
    if (initialType) setType(initialType);
    if (initialQuery) setQuery(initialQuery);
    if (initialRaw !== undefined) setRaw(initialRaw);
    if (initialFresh !== undefined) setFresh(initialFresh);
    if (initialWait !== undefined) setWait(initialWait);
  }, [initialType, initialQuery, initialRaw, initialFresh, initialWait]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      onSearch(type, trimmed, { raw, fresh, wait });
    },
    [type, query, raw, fresh, wait, onSearch],
  );

  // Ctrl+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('lookup-query')?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <section className="search-section">
      <form id="lookup-form" className="search-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="select-wrapper">
            <select
              id="lookup-type"
              className="form-select"
              aria-label="Lookup type"
              value={type}
              onChange={(e) => setType(e.target.value as LookupType)}
            >
              {LOOKUP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.icon} {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="input-wrapper">
            <input
              type="text"
              id="lookup-query"
              className="form-input"
              placeholder={PLACEHOLDERS[type]}
              autoComplete="off"
              spellCheck={false}
              aria-label="Query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              id="lookup-btn"
              className="form-button"
              aria-label="Search"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="spinner-icon" size={18} /> : <Search size={18} />}
              <span className="btn-text">{isLoading ? 'Searching...' : 'Search'}</span>
            </button>
          </div>
        </div>
        <div className="form-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={raw}
              onChange={(e) => setRaw(e.target.checked)}
            />
            <span className="checkmark" />
            Include raw responses
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={fresh}
              onChange={(e) => setFresh(e.target.checked)}
            />
            <span className="checkmark" />
            Force fresh lookup
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={wait}
              onChange={(e) => setWait(e.target.checked)}
            />
            <span className="checkmark" />
            Wait for background results
          </label>
        </div>
      </form>
    </section>
  );
}
