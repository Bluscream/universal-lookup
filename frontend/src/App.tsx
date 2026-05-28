import { useEffect, useState } from 'react';
import { LookupResult } from './components/LookupResult';
import { SearchBar } from './components/SearchBar';
import type { LookupResponse, LookupType } from './types/api';
import './index.css';

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse initial state from URL synchronously on initial load
  const getInitialState = () => {
    const pathMatch = location.pathname.match(
      /^\/(?:api\/)?(?:v\d+\/)?(auto|tel|ip|domain|email|location|parcel|web|steam|url|apk)\/(.+)$/,
    );
    const searchParams = new URLSearchParams(location.search);
    const raw = searchParams.get('raw') === 'true' || searchParams.get('raw') === '1';
    const fresh = searchParams.get('fresh') === 'true' || searchParams.get('fresh') === '1';
    const wait = searchParams.get('wait') === 'true' || searchParams.get('wait') === '1';

    if (pathMatch) {
      return {
        type: pathMatch[1] as LookupType,
        query: decodeURIComponent(pathMatch[2]),
        raw,
        fresh,
        wait,
        autoTrigger: true,
      };
    }
    return {
      type: 'auto' as LookupType,
      query: '',
      raw,
      fresh,
      wait,
      autoTrigger: false,
    };
  };

  const [init] = useState(getInitialState);

  const [initialType, setInitialType] = useState<LookupType | undefined>(init.type);
  const [initialQuery, setInitialQuery] = useState<string | undefined>(init.query);
  const [initialRaw] = useState(init.raw);
  const [initialFresh] = useState(init.fresh);
  const [initialWait] = useState(init.wait);

  // Declare performLookup before any effects use it
  const performLookup = async (
    type: LookupType,
    query: string,
    options: { raw: boolean; fresh: boolean; wait: boolean },
  ) => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    const params = new URLSearchParams();
    if (options.raw) params.set('raw', 'true');
    if (options.fresh) params.set('fresh', 'true');
    if (options.wait) params.set('wait', 'true');

    const backendPort = import.meta.env.VITE_BACKEND_PORT || '24011';
    const backendUrl = `${location.protocol}//${location.hostname}:${backendPort}`;
    const apiUrl = `${backendUrl}/api/v1/${type}/${encodeURIComponent(query)}${params.toString() ? `?${params}` : ''}`;

    try {
      const resp = await fetch(apiUrl);
      const data: LookupResponse = await resp.json();
      setResult(data);

      // Update browser URL
      const newUrl = `/${type}/${encodeURIComponent(query)}${params.toString() ? `?${params}` : ''}`;
      history.pushState({ type, query }, '', newUrl);
    } catch (err) {
      setError(`Request failed: ${(err as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger lookup automatically on initial load
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial mount only
  useEffect(() => {
    if (init.autoTrigger && init.type && init.query) {
      setTimeout(() => {
        performLookup(init.type, init.query, { raw: init.raw, fresh: init.fresh, wait: init.wait });
      }, 0);
    }
  }, []);

  // Handle browser back/forward
  // biome-ignore lint/correctness/useExhaustiveDependencies: popstate listener only
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state?.type && e.state?.query) {
        setInitialType(e.state.type);
        setInitialQuery(e.state.query);
        performLookup(e.state.type, e.state.query, {
          raw: false,
          fresh: false,
          wait: false,
        });
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return (
    <>
      <nav className="navbar">
        <div className="nav-brand">
          <span className="nav-icon">🔍</span>
          <span className="nav-title">Universal Lookup</span>
        </div>
        <div className="nav-links">
          <a href="/" className="nav-link active">
            Home
          </a>
          <a href="/docs" className="nav-link">
            API Docs
          </a>
          <a
            href="https://github.com/Bluscream/universal-lookup"
            className="nav-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </nav>

      <main className="main-container">
        <SearchBar
          onSearch={performLookup}
          isLoading={isLoading}
          initialType={initialType}
          initialQuery={initialQuery}
          initialRaw={initialRaw}
          initialFresh={initialFresh}
          initialWait={initialWait}
        />

        {error && (
          <section className="results-section">
            <div className="error-banner">{error}</div>
          </section>
        )}

        {result && <LookupResult data={result} />}
      </main>

      <footer className="footer">
        <span>Universal Lookup &copy; {new Date().getFullYear()}</span>
        <span className="footer-sep">·</span>
        <a href="/docs">API Docs</a>
        <span className="footer-sep">·</span>
        <a
          href="https://github.com/Bluscream/universal-lookup"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </footer>
    </>
  );
}

export default App;
