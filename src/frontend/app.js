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
    auto: 'e.g. 8.8.8.8, google.com, +49123..., user@..., 0034..., SteamID..., com.android...',
    ip: 'e.g. 8.8.8.8',
    domain: 'e.g. google.com',
    tel: 'e.g. +493012345678',
    email: 'e.g. user@example.com',
    location: 'e.g. Berlin, Germany or 52.52,13.40',
    parcel: 'e.g. 00340434515310596216',
    steam: 'e.g. 76561197960287930 or steamcommunity.com/id/gabelogannewell',
    url: 'e.g. https://github.com or google.com',
    apk: 'e.g. com.google.android.youtube or Play Store URL',
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
  const pathMatch = location.pathname.match(
    /^\/(auto|tel|ip|domain|email|location|parcel|web|steam|url|apk)\/(.+)$/,
  );
  if (pathMatch) {
    typeSelect.value = pathMatch[1];
    queryInput.value = decodeURIComponent(pathMatch[2]);
    queryInput.placeholder = PLACEHOLDERS[pathMatch[1]] || '';
    form.dispatchEvent(new Event('submit'));
  } else {
    queryInput.placeholder = PLACEHOLDERS[typeSelect.value] || '';
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
    const reqType = data.request?.type || 'auto';
    resultType.textContent = reqType.toUpperCase();
    if (data.lookup_time?.includes('cached')) {
      resultCached.classList.remove('hidden');
    }

    // Render cards
    resultCards.innerHTML = '';
    const response = data.response || {};

    // Premium custom cards
    const isSteam = reqType === 'steam' || 'steam_id_64' in response;
    const isUrl = reqType === 'url' || 'landing_url' in response;

    let excludedKeys = [];

    if (isSteam) {
      const profileCard = createSteamProfileCard(response);
      if (profileCard) resultCards.appendChild(profileCard);
      
      const invCard = createSteamInventoriesCard(response);
      if (invCard) resultCards.appendChild(invCard);

      excludedKeys = [
        'steam_links', 'inventories', 'total_inventory_items', 'has_public_inventories',
        'username', 'profile_url', 'avatar_url', 'persona_state', 'community_visibility_state',
        'last_logoff', 'real_name', 'primary_clan_id', 'created_at', 'country_code', 'state_code',
        'city_id', 'game_extrainfo', 'game_id', 'community_banned', 'vac_banned', 'vac_bans_count',
        'days_since_last_ban', 'game_bans_count', 'economy_ban_state', 'steam_id_64',
        'steam_id_2', 'steam_id_3', 'backpack_value_tf2', 'trust_positive', 'trust_negative',
        'backpack_tf_banned', 'backpack_tf_premium', 'csfloat_registered', 'csfloat_username',
        'csfloat_avatar', 'csfloat_total_sales', 'csfloat_total_purchases', 'csfloat_median_delivery_seconds',
        'price_today', 'price_lowest', 'games_owned', 'hours_played', 'game_count', 'total_playtime_hours',
        'most_played_game',
        'avatar_icon', 'avatar_medium', 'avatar_full', 'privacy_state', 'custom_url', 'member_since',
        'headline', 'summary', 'state_message', 'trade_ban_state', 'is_limited_account'
      ];
    } else if (isUrl) {
      const metaCard = createUrlMetadataCard(response);
      if (metaCard) resultCards.appendChild(metaCard);

      const redirectCard = createUrlRedirectChainCard(response);
      if (redirectCard) resultCards.appendChild(redirectCard);

      const sslCard = createUrlSslCard(response);
      if (sslCard) resultCards.appendChild(sslCard);

      const headersCard = createUrlSecurityHeadersCard(response);
      if (headersCard) resultCards.appendChild(headersCard);

      excludedKeys = [
        'query', 'landing_url', 'http_status', 'content_type', 'content_length', 'server',
        'powered_by', 'redirect_chain', 'is_redirected', 'security_headers', 'ssl', 'meta'
      ];
    }

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
        !excludedKeys.includes(key) &&
        key in response &&
        response[key] !== null &&
        response[key] !== undefined &&
        response[key] !== ''
      ) {
        resultCards.appendChild(createCard(key, response[key]));
      }
    }

    if (Array.isArray(response.emails)) {
      for (const email of response.emails) {
        resultCards.appendChild(createCard('email', email));
      }
    }

    // Remaining keys not in the priority list
    for (const [key, value] of Object.entries(response)) {
      if (
        !CARD_KEYS.includes(key) &&
        !excludedKeys.includes(key) &&
        key !== 'web' &&
        key !== 'emails' &&
        value !== null &&
        value !== undefined &&
        value !== ''
      ) {
        if (typeof value !== 'object') {
          resultCards.appendChild(createCard(key, value));
        }
      }
    }

    // Always put web results at the bottom
    if (Array.isArray(response.web)) {
      resultCards.appendChild(createWebResultsCard(response.web));
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

  function createSteamProfileCard(res) {
    const card = document.createElement('div');
    card.className = 'steam-profile-card';
    card.style.gridColumn = '1 / -1';

    const states = {
      0: { label: 'Offline', class: 'offline' },
      1: { label: 'Online', class: 'online' },
      2: { label: 'Busy', class: 'busy' },
      3: { label: 'Away', class: 'away' },
      4: { label: 'Snooze', class: 'snooze' },
      5: { label: 'Looking to Trade', class: 'trade' },
      6: { label: 'Looking to Play', class: 'play' }
    };
    
    let stateLabel = 'Offline';
    let stateClass = 'offline';
    
    if (res.persona_state !== undefined && states[res.persona_state]) {
      stateLabel = states[res.persona_state].label;
      stateClass = states[res.persona_state].class;
    }
    
    if (res.game_extrainfo) {
      stateLabel = `In-Game: ${res.game_extrainfo}`;
      stateClass = 'ingame';
    }

    const visibility = res.community_visibility_state === 3 ? 'Public' : 'Private';
    const visClass = res.community_visibility_state === 3 ? 'success' : 'danger';

    const isVacBanned = !!res.vac_banned;
    const isCommBanned = !!res.community_banned;
    const isEconBanned = res.economy_ban_state && res.economy_ban_state !== 'none';
    
    let bansHtml = '';
    if (isVacBanned) {
      bansHtml += `<span class="badge badge-danger blink">VAC Banned (${res.vac_bans_count || 1} ban${(res.vac_bans_count || 1) > 1 ? 's' : ''})</span>`;
    }
    if (isCommBanned) {
      bansHtml += `<span class="badge badge-danger">Community Banned</span>`;
    }
    if (isEconBanned) {
      bansHtml += `<span class="badge badge-danger">Economy Ban: ${res.economy_ban_state}</span>`;
    }
    if (!isVacBanned && !isCommBanned && !isEconBanned) {
      bansHtml += `<span class="badge badge-success">No Bans (Clean)</span>`;
    }

    const avatarUrl = res.avatar_url || 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';
    const username = res.username || 'Steam User';
    const realName = res.real_name ? `<span class="steam-realname">(${esc(res.real_name)})</span>` : '';
    const steamId = res.steam_id_64 || '';
    const createdAt = res.created_at ? new Date(res.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown';
    const lastLogoff = res.last_logoff ? new Date(res.last_logoff).toLocaleString() : 'Unknown';
    
    let location = '';
    if (res.country_code) {
      location = res.country_code;
      if (res.state_code) location += `, ${res.state_code}`;
    }

    // Calculations & IDs Grid HTML
    const steamId2 = res.steam_id_2 || 'Unknown';
    const steamId3 = res.steam_id_3 || 'Unknown';

    // Games Library Statistics
    const gameCount = res.game_count !== null && res.game_count !== undefined ? res.game_count : res.games_owned;
    const isGameCountAvailable = gameCount !== null && gameCount !== undefined;
    const gameCountSource = res.game_count !== null && res.game_count !== undefined ? 'API' : 'SteamDB';

    const totalPlaytime = res.total_playtime_hours !== null && res.total_playtime_hours !== undefined ? res.total_playtime_hours : res.hours_played;
    const isPlaytimeAvailable = totalPlaytime !== null && totalPlaytime !== undefined;
    const playtimeSource = res.total_playtime_hours !== null && res.total_playtime_hours !== undefined ? 'API' : 'SteamDB';

    let libraryHtml = '';
    if (isGameCountAvailable || isPlaytimeAvailable || res.most_played_game) {
      const gamesText = isGameCountAvailable ? `${gameCount.toLocaleString()} games <span class="stats-source">(${gameCountSource})</span>` : 'Private / Unknown';
      const hoursText = isPlaytimeAvailable ? `${totalPlaytime.toLocaleString()} hrs <span class="stats-source">(${playtimeSource})</span>` : 'Private / Unknown';
      
      let mostPlayedHtml = 'N/A / Private';
      if (res.most_played_game) {
        const mp = res.most_played_game;
        mostPlayedHtml = `
          <div class="most-played-pill">
            <span class="mp-name">${esc(mp.name)}</span>
            <span class="badge badge-info">${mp.playtime_hours.toLocaleString()} hrs</span>
          </div>
        `;
      }

      libraryHtml = `
        <div class="steam-dashboard-section">
          <h4 class="section-title">🎮 Steam Library Dashboard</h4>
          <div class="library-stats-grid">
            <div class="stat-badge-card">
              <span class="stat-badge-label">Games Owned</span>
              <span class="stat-badge-value">${gamesText}</span>
            </div>
            <div class="stat-badge-card">
              <span class="stat-badge-label">Total Playtime</span>
              <span class="stat-badge-value">${hoursText}</span>
            </div>
            <div class="stat-badge-card wide">
              <span class="stat-badge-label">Most Played Game</span>
              <span class="stat-badge-value">${mostPlayedHtml}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Third-party dashboards (Backpack.tf / CSFloat / SteamDB pricing)
    let hasThirdParty = false;
    let backpackHtml = '';
    let csfloatHtml = '';
    let steamDbWorthHtml = '';

    // Backpack.tf valuation
    if (res.backpack_value_tf2 !== undefined || res.trust_positive !== undefined) {
      hasThirdParty = true;
      const bpVal = res.backpack_value_tf2 !== null && res.backpack_value_tf2 !== undefined 
        ? `$${res.backpack_value_tf2.toFixed(2)}` 
        : 'N/A';
      const posTrust = res.trust_positive || 0;
      const negTrust = res.trust_negative || 0;
      const isBpBanned = !!res.backpack_tf_banned;
      const isBpPremium = !!res.backpack_tf_premium;

      backpackHtml = `
        <div class="third-party-card backpack-card">
          <div class="tp-card-header">
            <span class="tp-provider">backpack.tf</span>
            <div class="tp-badges">
              ${isBpPremium ? '<span class="badge badge-gold">Premium</span>' : ''}
              ${isBpBanned ? '<span class="badge badge-danger">Banned</span>' : ''}
            </div>
          </div>
          <div class="tp-details">
            <div class="tp-row">
              <span class="tp-label">TF2 Inventory Value:</span>
              <span class="tp-value highlight-gold">${esc(bpVal)}</span>
            </div>
            <div class="tp-row">
              <span class="tp-label">Trust Rating:</span>
              <div class="trust-pills">
                <span class="trust-pill trust-positive">+${posTrust}</span>
                <span class="trust-pill trust-negative">-${negTrust}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // CSFloat Database & Sales reputation
    if (res.csfloat_registered !== undefined) {
      hasThirdParty = true;
      const isReg = !!res.csfloat_registered;
      
      if (isReg) {
        const usernameFloat = res.csfloat_username || 'Registered';
        const sales = res.csfloat_total_sales || 0;
        const purchases = res.csfloat_total_purchases || 0;
        const delivery = res.csfloat_median_delivery_seconds 
          ? `${Math.round(res.csfloat_median_delivery_seconds / 60)} mins` 
          : 'N/A';

        csfloatHtml = `
          <div class="third-party-card csfloat-card">
            <div class="tp-card-header">
              <span class="tp-provider">CSFloat Market</span>
              <span class="badge badge-success">Registered</span>
            </div>
            <div class="tp-details">
              <div class="tp-row">
                <span class="tp-label">Market Username:</span>
                <span class="tp-value font-bold">${esc(usernameFloat)}</span>
              </div>
              <div class="tp-row">
                <span class="tp-label">Market Stats:</span>
                <span class="tp-value font-medium">${sales} sales / ${purchases} buys</span>
              </div>
              <div class="tp-row">
                <span class="tp-label">Avg Delivery Time:</span>
                <span class="tp-value">${esc(delivery)}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        csfloatHtml = `
          <div class="third-party-card csfloat-card disabled">
            <div class="tp-card-header">
              <span class="tp-provider">CSFloat Market</span>
              <span class="badge badge-muted">Not Registered</span>
            </div>
            <div class="tp-details">
              <span class="tp-placeholder-text">This profile has not registered a store or purchased listings on CSFloat.</span>
            </div>
          </div>
        `;
      }
    }

    // SteamDB pricing worth
    if (res.price_today !== undefined || res.price_lowest !== undefined) {
      hasThirdParty = true;
      const priceToday = res.price_today || 'N/A';
      const priceLowest = res.price_lowest || 'N/A';

      steamDbWorthHtml = `
        <div class="third-party-card steamdb-worth-card">
          <div class="tp-card-header">
            <span class="tp-provider">SteamDB Calculator</span>
            <span class="badge badge-info">Scraped</span>
          </div>
          <div class="tp-details">
            <div class="tp-row">
              <span class="tp-label">Estimated Worth (Today):</span>
              <span class="tp-value highlight-green">${esc(priceToday)}</span>
            </div>
            <div class="tp-row">
              <span class="tp-label">All-time Sales Lowest:</span>
              <span class="tp-value highlight-blue">${esc(priceLowest)}</span>
            </div>
          </div>
        </div>
      `;
    }

    let thirdPartyHtml = '';
    if (hasThirdParty) {
      thirdPartyHtml = `
        <div class="steam-dashboard-section">
          <h4 class="section-title">📊 Third-Party Trading & Value Analytics</h4>
          <div class="third-party-grid">
            ${backpackHtml}
            ${csfloatHtml}
            ${steamDbWorthHtml}
          </div>
        </div>
      `;
    }

    const links = res.steam_links || {};
    let linksHtml = '';
    if (links.steam_community) linksHtml += `<a href="${esc(links.steam_community)}" target="_blank" rel="noopener" class="steam-btn steam-community-btn">Steam Community</a>`;
    if (links.steam_db) linksHtml += `<a href="${esc(links.steam_db)}" target="_blank" rel="noopener" class="steam-btn steamdb-btn">SteamDB</a>`;
    if (links.steam_rep) linksHtml += `<a href="${esc(links.steam_rep)}" target="_blank" rel="noopener" class="steam-btn steamrep-btn">SteamRep</a>`;
    if (links.backpack_tf) linksHtml += `<a href="${esc(links.backpack_tf)}" target="_blank" rel="noopener" class="steam-btn backpack-btn">backpack.tf</a>`;
    if (links.csfloat) linksHtml += `<a href="${esc(links.csfloat)}" target="_blank" rel="noopener" class="steam-btn csfloat-btn">CSFloat</a>`;
    if (links.steamid_finder) linksHtml += `<a href="${esc(links.steamid_finder)}" target="_blank" rel="noopener" class="steam-btn finder-btn">SteamID Finder</a>`;
    if (links.steamhistory) linksHtml += `<a href="${esc(links.steamhistory)}" target="_blank" rel="noopener" class="steam-btn history-btn">Steam History</a>`;
    if (links.bansearch) linksHtml += `<a href="${esc(links.bansearch)}" target="_blank" rel="noopener" class="steam-btn bansearch-btn">BanSearch</a>`;
    if (links.vaclist) linksHtml += `<a href="${esc(links.vaclist)}" target="_blank" rel="noopener" class="steam-btn vaclist-btn">VacList</a>`;

    card.innerHTML = `
      <div class="steam-profile-header">
        <div class="steam-avatar-wrapper ${stateClass}">
          <img src="${esc(avatarUrl)}" alt="Avatar" class="steam-avatar">
          <div class="steam-state-dot"></div>
        </div>
        <div class="steam-profile-info">
          <div class="steam-username-row">
            <h3 class="steam-username">${esc(username)}</h3>
            ${realName}
          </div>
          <div class="steam-badges">
            <span class="badge state-${stateClass}">${esc(stateLabel)}</span>
            <span class="badge badge-${visClass}">Profile: ${visibility}</span>
            ${bansHtml}
          </div>
        </div>
      </div>

      <div class="steam-dashboard-section">
        <h4 class="section-title">🆔 SteamID Formats</h4>
        <div class="steam-ids-container">
          <div class="steam-id-format-row">
            <span class="id-format-label">SteamID64</span>
            <code class="steam-id-val mono">${esc(steamId)}</code>
            <button class="copy-btn" data-copy="${esc(steamId)}" title="Copy SteamID64">📋</button>
          </div>
          <div class="steam-id-format-row">
            <span class="id-format-label">SteamID2</span>
            <code class="steam-id-val mono">${esc(steamId2)}</code>
            <button class="copy-btn" data-copy="${esc(steamId2)}" title="Copy SteamID2">📋</button>
          </div>
          <div class="steam-id-format-row">
            <span class="id-format-label">SteamID3</span>
            <code class="steam-id-val mono">${esc(steamId3)}</code>
            <button class="copy-btn" data-copy="${esc(steamId3)}" title="Copy SteamID3">📋</button>
          </div>
        </div>
      </div>

      <div class="steam-profile-details">
        <div class="detail-item">
          <span class="detail-label">Member Since</span>
          <span class="detail-value">${esc(createdAt)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Last Logoff</span>
          <span class="detail-value">${esc(lastLogoff)}</span>
        </div>
        ${location ? `
        <div class="detail-item">
          <span class="detail-label">Location</span>
          <span class="detail-value">${esc(location)}</span>
        </div>` : ''}
      </div>

      ${libraryHtml}

      ${thirdPartyHtml}

      <div class="steam-dashboard-section">
        <h4 class="section-title">🔗 External Platforms & Scanners</h4>
        <div class="steam-links-grid">
          ${linksHtml}
        </div>
      </div>
    `;

    // Modern multi-copy events
    card.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const textToCopy = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(textToCopy);
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.classList.remove('copied');
        }, 2000);
      });
    });

    return card;
  }

  function createSteamInventoriesCard(res) {
    if (!res.inventories || res.inventories.length === 0) return null;
    
    const card = document.createElement('div');
    card.className = 'steam-inventory-card';
    card.style.gridColumn = '1 / -1';
    
    let html = `
      <div class="card-label">Game Inventories</div>
      <div class="steam-inventories-grid">
    `;
    
    for (const inv of res.inventories) {
      const isPublic = inv.status === 'Public';
      const statusBadge = isPublic 
        ? `<span class="badge badge-success">🔓 Public</span>` 
        : `<span class="badge badge-danger">🔒 ${esc(inv.status)}</span>`;
      
      let samplesHtml = '';
      if (inv.sample_items && inv.sample_items.length > 0) {
        samplesHtml = `
          <div class="inventory-samples">
            <span class="samples-title">Item Preview:</span>
            <ul class="samples-list">
              ${inv.sample_items.map(item => `<li>${esc(item)}</li>`).join('')}
            </ul>
          </div>
        `;
      } else if (isPublic && inv.item_count === 0) {
        samplesHtml = `<div class="inventory-empty">No items found (Empty inventory).</div>`;
      }
      
      html += `
        <div class="inventory-item-card">
          <div class="inventory-item-header">
            <span class="inventory-game-name">${esc(inv.game)}</span>
            <span class="inventory-item-count badge">${inv.item_count} items</span>
          </div>
          <div class="inventory-status-row">
            ${statusBadge}
          </div>
          ${samplesHtml}
        </div>
      `;
    }
    
    html += `</div>`;
    card.innerHTML = html;
    return card;
  }

  function createUrlMetadataCard(res) {
    const card = document.createElement('div');
    card.className = 'url-metadata-card';
    card.style.gridColumn = '1 / -1';
    
    const meta = res.meta || {};
    const title = meta.title || res.query || 'Scanned URL';
    const description = meta.description || 'No description available for this page.';
    const faviconUrl = meta.favicon || `https://www.google.com/s2/favicons?domain=${new URL(res.landing_url || res.query).hostname}&sz=32`;
    const httpStatus = res.http_status || 200;
    
    let statusClass = 'success';
    if (httpStatus >= 300 && httpStatus < 400) statusClass = 'warning';
    if (httpStatus >= 400) statusClass = 'danger';
    
    let techHtml = '';
    if (res.server) techHtml += `<span class="badge tech-badge">Server: ${esc(res.server)}</span>`;
    if (res.powered_by) techHtml += `<span class="badge tech-badge">Powered by: ${esc(res.powered_by)}</span>`;
    if (res.content_type) techHtml += `<span class="badge tech-badge">Type: ${esc(res.content_type)}</span>`;
    if (res.content_length) techHtml += `<span class="badge tech-badge">Size: ${(res.content_length / 1024).toFixed(2)} KB</span>`;

    let ogCardHtml = '';
    const og = meta.open_graph || {};
    const twitter = meta.twitter || {};
    const ogTitle = og.title || twitter.title;
    const ogDesc = og.description || twitter.description;
    const ogImg = og.image || twitter.image;
    const siteName = og.site_name || siteNameFromUrl(res.landing_url);
    
    if (ogTitle || ogDesc || ogImg) {
      ogCardHtml = `
        <div class="og-embed-preview">
          <div class="og-embed-site">${esc(siteName)}</div>
          ${ogTitle ? `<div class="og-embed-title"><a href="${esc(res.landing_url)}" target="_blank" rel="noopener">${esc(ogTitle)}</a></div>` : ''}
          ${ogDesc ? `<div class="og-embed-description">${esc(ogDesc)}</div>` : ''}
          ${ogImg ? `
            <div class="og-embed-image-wrapper">
              <img src="${esc(ogImg)}" alt="Open Graph Preview" class="og-embed-image" onerror="this.style.display='none'">
            </div>
          ` : ''}
        </div>
      `;
    }
    
    card.innerHTML = `
      <div class="url-meta-header">
        <div class="url-favicon-wrapper">
          <img src="${esc(faviconUrl)}" alt="Favicon" class="url-favicon" onerror="this.src='data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.5 11.5a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 1 0v4zm0-6a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z'/%3E%3C/svg%3E'">
        </div>
        <div class="url-title-wrapper">
          <h3 class="url-page-title">${esc(title)}</h3>
          <a href="${esc(res.landing_url || res.query)}" target="_blank" rel="noopener" class="url-landing-link">${esc(res.landing_url || res.query)}</a>
        </div>
        <div class="url-status-badge">
          <span class="badge badge-${statusClass}">HTTP ${httpStatus}</span>
        </div>
      </div>
      
      <p class="url-page-description">${esc(description)}</p>
      
      <div class="url-tech-info">
        ${techHtml}
      </div>
      
      ${ogCardHtml}
    `;
    
    return card;
  }
  
  function siteNameFromUrl(urlStr) {
    try {
      return new URL(urlStr).hostname;
    } catch {
      return '';
    }
  }

  function createUrlRedirectChainCard(res) {
    if (!res.redirect_chain || res.redirect_chain.length === 0) return null;
    
    const card = document.createElement('div');
    card.className = 'url-redirect-card';
    card.style.gridColumn = '1 / -1';
    
    let html = `
      <div class="card-label">Redirect Flow (${res.redirect_chain.length} redirect${res.redirect_chain.length > 1 ? 's' : ''})</div>
      <div class="redirect-flow-container">
    `;
    
    res.redirect_chain.forEach((step, index) => {
      const stepUrl = step.url;
      const status = step.status;
      
      html += `
        <div class="redirect-step">
          <div class="redirect-node">
            <span class="redirect-index">${index + 1}</span>
            <div class="redirect-url-info">
              <span class="redirect-url-text">${esc(stepUrl)}</span>
              <span class="badge badge-warning">HTTP ${status}</span>
            </div>
          </div>
          <div class="redirect-arrow">↓</div>
        </div>
      `;
    });
    
    html += `
      <div class="redirect-step final-step">
        <div class="redirect-node">
          <span class="redirect-index">✔</span>
          <div class="redirect-url-info">
            <span class="redirect-url-text final">${esc(res.landing_url)}</span>
            <span class="badge badge-success">HTTP ${res.http_status || 200}</span>
          </div>
        </div>
      </div>
    `;
    
    html += `</div>`;
    card.innerHTML = html;
    return card;
  }

  function createUrlSslCard(res) {
    if (!res.ssl) return null;
    
    const card = document.createElement('div');
    card.className = 'url-ssl-card';
    card.style.gridColumn = '1 / -1';
    
    const ssl = res.ssl;
    const isExpired = !!ssl.is_expired;
    const days = ssl.days_remaining;
    
    let daysClass = 'badge-success';
    let daysText = `${days} days remaining`;
    if (days < 30) daysClass = 'badge-warning';
    if (days <= 0 || isExpired) {
      daysClass = 'badge-danger blink';
      daysText = 'Expired!';
    }
    
    card.innerHTML = `
      <div class="ssl-header-row">
        <div class="ssl-title">
          <span class="ssl-icon">🔒</span>
          <strong>SSL Certificate Details</strong>
        </div>
        <span class="badge ${daysClass}">${daysText}</span>
      </div>
      <div class="ssl-details-grid">
        <div class="ssl-detail-item">
          <span class="ssl-label">Subject CN:</span>
          <span class="ssl-value font-bold">${esc(ssl.subject)}</span>
        </div>
        ${ssl.subject_org ? `
        <div class="ssl-detail-item">
          <span class="ssl-label">Organization:</span>
          <span class="ssl-value">${esc(ssl.subject_org)}</span>
        </div>` : ''}
        <div class="ssl-detail-item">
          <span class="ssl-label">Issuer:</span>
          <span class="ssl-value">${esc(ssl.issuer)}</span>
        </div>
        ${ssl.issuer_org ? `
        <div class="ssl-detail-item">
          <span class="ssl-label">Issuer Org:</span>
          <span class="ssl-value">${esc(ssl.issuer_org)}</span>
        </div>` : ''}
        <div class="ssl-detail-item">
          <span class="ssl-label">Validity Period:</span>
          <span class="ssl-value">${new Date(ssl.valid_from).toLocaleDateString()} to ${new Date(ssl.valid_to).toLocaleDateString()}</span>
        </div>
        <div class="ssl-detail-item full-width">
          <span class="ssl-label">Serial Number:</span>
          <code class="ssl-code">${esc(ssl.serial_number)}</code>
        </div>
        <div class="ssl-detail-item full-width">
          <span class="ssl-label">SHA-256 Fingerprint:</span>
          <code class="ssl-code">${esc(ssl.fingerprint)}</code>
        </div>
      </div>
    `;
    
    return card;
  }

  function createUrlSecurityHeadersCard(res) {
    if (!res.security_headers) return null;
    
    const card = document.createElement('div');
    card.className = 'url-headers-card';
    card.style.gridColumn = '1 / -1';
    
    const headers = res.security_headers;
    const headerKeys = {
      content_security_policy: 'Content-Security-Policy',
      strict_transport_security: 'Strict-Transport-Security',
      x_frame_options: 'X-Frame-Options',
      x_content_type_options: 'X-Content-Type-Options',
      x_xss_protection: 'X-XSS-Protection',
      referrer_policy: 'Referrer-Policy'
    };
    
    let checklistHtml = '';
    let secureCount = 0;
    
    for (const [key, label] of Object.entries(headerKeys)) {
      const val = headers[key];
      const isSecured = val !== null && val !== undefined;
      if (isSecured) secureCount++;
      
      checklistHtml += `
        <div class="header-check-item ${isSecured ? 'secured' : 'missing'}">
          <div class="header-check-info">
            <span class="header-check-bullet">${isSecured ? '✓' : '✗'}</span>
            <strong class="header-name">${esc(label)}</strong>
          </div>
          <div class="header-value-box">
            ${isSecured ? `<code class="header-val">${esc(val)}</code>` : `<span class="header-missing-msg">Missing (High Risk)</span>`}
          </div>
        </div>
      `;
    }
    
    const scorePct = Math.round((secureCount / 6) * 100);
    let scoreClass = 'badge-danger';
    if (scorePct >= 50) scoreClass = 'badge-warning';
    if (scorePct >= 80) scoreClass = 'badge-success';
    
    card.innerHTML = `
      <div class="headers-header-row">
        <div>
          <span class="ssl-icon">🛡</span>
          <strong>Security Headers Check</strong>
        </div>
        <span class="badge ${scoreClass}">${secureCount} / 6 Secured (${scorePct}%)</span>
      </div>
      <div class="headers-checklist">
        ${checklistHtml}
      </div>
    `;
    
    return card;
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
})();
