// Universal Lookup — Frontend Application
(() => {
  const form = document.getElementById('lookup-form');
  const typeSelect = document.getElementById('lookup-type');
  const queryInput = document.getElementById('lookup-query');
  const submitBtn = document.getElementById('lookup-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnSpinner = submitBtn.querySelector('.btn-spinner');

  const resultsSection = document.getElementById('results-section');
  const resultTime = document.getElementById('result-time');
  const resultType = document.getElementById('result-type');
  const resultCached = document.getElementById('result-cached');
  const resultError = document.getElementById('result-error');
  const resultCards = document.getElementById('result-cards');
  const resultJson = document.getElementById('result-json');
  const resultErrors = document.getElementById('result-errors');
  const errorsList = document.getElementById('errors-list');

  const optRaw = document.getElementById('opt-raw');
  const optFresh = document.getElementById('opt-fresh');

  const PLACEHOLDERS = {
    ip: 'e.g. 8.8.8.8, google.com',
    tel: 'e.g. +493012345678',
    email: 'e.g. user@example.com',
    location: 'e.g. Berlin, Germany or 52.52,13.40',
    parcel: 'e.g. 00340434515310596216',
    web: 'e.g. what is my ip, tellows 01756350071',
  };

  // Update placeholder on type change
  typeSelect.addEventListener('change', () => {
    queryInput.placeholder = PLACEHOLDERS[typeSelect.value] || 'Enter query...';
  });

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = typeSelect.value;
    const query = queryInput.value.trim();
    if (!query) {
      queryInput.focus();
      return;
    }

    setLoading(true);
    hideResults();

    const params = new URLSearchParams();
    if (optRaw.checked) params.set('raw', 'true');
    if (optFresh.checked) params.set('fresh', 'true');

    const url = `/api/${type}/${encodeURIComponent(query)}${params.toString() ? `?${params}` : ''}`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();
      showResults(data);
      // Update URL
      const newUrl = `/${type}/${encodeURIComponent(query)}${params.toString() ? `?${params}` : ''}`;
      history.pushState({ type, query }, '', newUrl);
    } catch (err) {
      showError(`Request failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  });

  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    if (e.state?.type && e.state?.query) {
      typeSelect.value = e.state.type;
      queryInput.value = e.state.query;
      form.dispatchEvent(new Event('submit'));
    }
  });

  // Parse URL on load (e.g. /ip/8.8.8.8)
  const pathMatch = location.pathname.match(/^\/(tel|ip|email|location|parcel|web)\/(.+)$/);
  if (pathMatch) {
    typeSelect.value = pathMatch[1];
    queryInput.value = decodeURIComponent(pathMatch[2]);
    queryInput.placeholder = PLACEHOLDERS[pathMatch[1]] || '';
    form.dispatchEvent(new Event('submit'));
  }

  // Keyboard shortcut: Ctrl+K to focus search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      queryInput.focus();
      queryInput.select();
    }
  });

  function setLoading(loading) {
    submitBtn.disabled = loading;
    btnText.classList.toggle('hidden', loading);
    btnSpinner.classList.toggle('hidden', !loading);
  }

  function hideResults() {
    resultsSection.classList.add('hidden');
    resultError.classList.add('hidden');
    resultErrors.classList.add('hidden');
    resultCached.classList.add('hidden');
  }

  function showError(msg) {
    resultsSection.classList.remove('hidden');
    resultError.classList.remove('hidden');
    resultError.textContent = msg;
  }

  function showResults(data) {
    resultsSection.classList.remove('hidden');

    // Meta badges
    resultTime.textContent = data.lookup_time || '';
    resultType.textContent = data.request?.type?.toUpperCase() || '';
    if (data.lookup_time?.includes('cached')) {
      resultCached.classList.remove('hidden');
    }

    // Render cards
    resultCards.innerHTML = '';
    const response = data.response || {};
    const CARD_KEYS = [
      'ip',
      'country',
      'country_code',
      'city',
      'region',
      'postal_code',
      'latitude',
      'longitude',
      'timezone',
      'isp',
      'org',
      'asn',
      'asn_org',
      'reverse_dns',
      'proxy',
      'vpn',
      'tor',
      'datacenter',
      'hosting',
      'risk_score',
      'risk_level',
      'name',
      'phone',
      'street',
      'address',
      'caller_type',
      'tellows_score',
      'email',
      'valid_syntax',
      'disposable',
      'free_provider',
      'mx_records',
      'reachable',
      'display_name',
      'formatted_address',
      'tracking_number',
      'carrier',
      'status',
      'status_description',
      'ping_alive',
      'ping_latency_ms',
    ];

    for (const key of CARD_KEYS) {
      if (
        key in response &&
        response[key] !== null &&
        response[key] !== undefined &&
        response[key] !== ''
      ) {
        resultCards.appendChild(createCard(key, response[key]));
      }
    }

    // Special handling for arrays (like web results or emails)
    if (Array.isArray(response.web)) {
      resultCards.appendChild(createWebResultsCard(response.web));
    }

    if (Array.isArray(response.emails)) {
      for (const email of response.emails) {
        resultCards.appendChild(createCard('email', email));
      }
    }

    // Remaining keys not in the priority list
    for (const [key, value] of Object.entries(response)) {
      if (!CARD_KEYS.includes(key) && key !== 'web' && key !== 'emails' && value !== null && value !== undefined && value !== '') {
        if (typeof value !== 'object') {
          resultCards.appendChild(createCard(key, value));
        }
      }
    }

    // JSON viewer
    resultJson.innerHTML = syntaxHighlight(JSON.stringify(data, null, 2));

    // Provider errors
    const errors = data.errors || {};
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      resultErrors.classList.remove('hidden');
      errorsList.innerHTML = '';
      for (const [provider, msg] of Object.entries(errors)) {
        const el = document.createElement('div');
        el.className = 'error-item';
        el.innerHTML = `<span class="error-provider">${esc(provider)}</span><span class="error-message">${esc(msg)}</span>`;
        errorsList.appendChild(el);
      }
    }
  }

  function createCard(key, value) {
    const card = document.createElement('div');
    card.className = 'result-card';
    const label = key.replace(/_/g, ' ');
    const isMono =
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      ['ip', 'asn', 'latitude', 'longitude', 'postal_code'].includes(key);
    const displayValue = typeof value === 'boolean' ? (value ? '✓ Yes' : '✗ No') : String(value);
    card.innerHTML = `<div class="card-label">${esc(label)}</div><div class="card-value${isMono ? ' mono' : ''}">${esc(displayValue)}</div>`;
    return card;
  }

  function createWebResultsCard(results) {
    const card = document.createElement('div');
    card.className = 'result-card web-results-card';
    card.style.gridColumn = '1 / -1'; // Full width
    
    let html = '<div class="card-label">Web Results</div><div class="web-results-list">';
    for (const res of results) {
      html += `
        <div class="web-result-item">
          <a href="${esc(res.url)}" target="_blank" rel="noopener" class="web-result-link">
            <span class="web-result-title">${esc(res.title)}</span>
            <span class="web-result-url">${esc(res.url)}</span>
          </a>
          ${res.description ? `<p class="web-result-description">${esc(res.description)}</p>` : ''}
          <span class="web-result-provider badge">${esc(res.provider)}</span>
        </div>`;
    }
    html += '</div>';
    card.innerHTML = html;
    return card;
  }

  function syntaxHighlight(json) {
    return json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?/g, (match) => {
        let cls = 'json-string';
        if (match.endsWith(':')) {
          cls = 'json-key';
          match = `${match.slice(0, -1)}:`;
          return `<span class="${cls}">${match.slice(0, -1)}</span>:`;
        }
        return `<span class="${cls}">${match}</span>`;
      })
      .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
      .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
      .replace(/\bnull\b/g, '<span class="json-null">null</span>');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();
