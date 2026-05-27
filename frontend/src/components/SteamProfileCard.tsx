import { useCallback } from 'react';

interface SteamProfileCardProps {
  response: Record<string, unknown>;
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);
  return (
    <button className="copy-btn" onClick={handleCopy} title="Copy">
      📋
    </button>
  );
}

export function SteamProfileCard({ response: res }: SteamProfileCardProps) {
  const states: Record<number, { label: string; cls: string }> = {
    0: { label: 'Offline', cls: 'offline' },
    1: { label: 'Online', cls: 'online' },
    2: { label: 'Busy', cls: 'busy' },
    3: { label: 'Away', cls: 'away' },
    4: { label: 'Snooze', cls: 'snooze' },
    5: { label: 'Looking to Trade', cls: 'trade' },
    6: { label: 'Looking to Play', cls: 'play' },
  };

  let stateLabel = 'Offline';
  let stateClass = 'offline';
  const ps = res.persona_state as number | undefined;
  if (ps !== undefined && states[ps]) {
    stateLabel = states[ps].label;
    stateClass = states[ps].cls;
  }
  if (res.game_extrainfo) {
    stateLabel = `In-Game: ${res.game_extrainfo}`;
    stateClass = 'ingame';
  }

  const visibility = (res.community_visibility_state as number) === 3 ? 'Public' : 'Private';
  const visClass = (res.community_visibility_state as number) === 3 ? 'success' : 'danger';
  const isVacBanned = !!res.vac_banned;
  const isCommBanned = !!res.community_banned;
  const isEconBanned = !!(res.economy_ban_state && res.economy_ban_state !== 'none');

  const avatarUrl =
    (res.avatar_url as string) ||
    'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';
  const username = (res.username as string) || 'Steam User';
  const realName = res.real_name as string;
  const steamId = (res.steam_id_64 as string) || '';
  const steamId2 = (res.steam_id_2 as string) || 'Unknown';
  const steamId3 = (res.steam_id_3 as string) || 'Unknown';
  const createdAt = res.created_at
    ? new Date(res.created_at as string).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Unknown';
  const lastLogoff = res.last_logoff
    ? new Date(res.last_logoff as string).toLocaleString()
    : 'Unknown';

  let location = '';
  if (res.country_code) {
    location = res.country_code as string;
    if (res.state_code) location += `, ${res.state_code}`;
  }

  // Games Library
  const gameCount = (res.game_count ?? res.games_owned) as number | undefined;
  const totalPlaytime = (res.total_playtime_hours ?? res.hours_played) as number | undefined;
  const mostPlayed = res.most_played_game as { name: string; playtime_hours: number } | undefined;

  // Third-party
  const hasBp = res.backpack_value_tf2 !== undefined || res.trust_positive !== undefined;
  const hasCsf = res.csfloat_registered !== undefined;
  const hasSdb = res.price_today !== undefined || res.price_lowest !== undefined;

  const links = (res.steam_links || {}) as Record<string, string>;
  const linkEntries: { key: string; label: string; cls: string }[] = [
    { key: 'steam_community', label: 'Steam Community', cls: 'steam-community-btn' },
    { key: 'steam_db', label: 'SteamDB', cls: 'steamdb-btn' },
    { key: 'steam_rep', label: 'SteamRep', cls: 'steamrep-btn' },
    { key: 'backpack_tf', label: 'backpack.tf', cls: 'backpack-btn' },
    { key: 'csfloat', label: 'CSFloat', cls: 'csfloat-btn' },
    { key: 'steamid_finder', label: 'SteamID Finder', cls: 'finder-btn' },
    { key: 'steamhistory', label: 'Steam History', cls: 'history-btn' },
    { key: 'bansearch', label: 'BanSearch', cls: 'bansearch-btn' },
    { key: 'vaclist', label: 'VacList', cls: 'vaclist-btn' },
  ];

  // Inventories
  const inventories = (res.inventories || []) as Array<{
    game: string;
    item_count: number;
    status: string;
    sample_items?: string[];
  }>;

  return (
    <>
      <div className="steam-profile-card full-width">
        {/* Header */}
        <div className="steam-profile-header">
          <div className={`steam-avatar-wrapper ${stateClass}`}>
            <img src={avatarUrl} alt="Avatar" className="steam-avatar" />
            <div className="steam-state-dot" />
          </div>
          <div className="steam-profile-info">
            <div className="steam-username-row">
              <h3 className="steam-username">{username}</h3>
              {realName && <span className="steam-realname">({realName})</span>}
            </div>
            <div className="steam-badges">
              <span className={`badge state-${stateClass}`}>{stateLabel}</span>
              <span className={`badge badge-${visClass}`}>Profile: {visibility}</span>
              {isVacBanned && (
                <span className="badge badge-danger blink">
                  VAC Banned ({(res.vac_bans_count as number) || 1} ban
                  {((res.vac_bans_count as number) || 1) > 1 ? 's' : ''})
                </span>
              )}
              {isCommBanned && <span className="badge badge-danger">Community Banned</span>}
              {isEconBanned && (
                <span className="badge badge-danger">
                  Economy Ban: {String(res.economy_ban_state)}
                </span>
              )}
              {!isVacBanned && !isCommBanned && !isEconBanned && (
                <span className="badge badge-success">No Bans (Clean)</span>
              )}
            </div>
          </div>
        </div>

        {/* SteamID Formats */}
        <div className="steam-dashboard-section">
          <h4 className="section-title">🆔 SteamID Formats</h4>
          <div className="steam-ids-container">
            {[
              { label: 'SteamID64', val: steamId },
              { label: 'SteamID2', val: steamId2 },
              { label: 'SteamID3', val: steamId3 },
            ].map((id) => (
              <div className="steam-id-format-row" key={id.label}>
                <span className="id-format-label">{id.label}</span>
                <code className="steam-id-val mono">{id.val}</code>
                <CopyButton text={id.val} />
              </div>
            ))}
          </div>
        </div>

        {/* Profile details */}
        <div className="steam-profile-details">
          <div className="detail-item">
            <span className="detail-label">Member Since</span>
            <span className="detail-value">{createdAt}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Last Logoff</span>
            <span className="detail-value">{lastLogoff}</span>
          </div>
          {location && (
            <div className="detail-item">
              <span className="detail-label">Location</span>
              <span className="detail-value">{location}</span>
            </div>
          )}
        </div>

        {/* Library Dashboard */}
        {(gameCount != null || totalPlaytime != null || mostPlayed) && (
          <div className="steam-dashboard-section">
            <h4 className="section-title">🎮 Steam Library Dashboard</h4>
            <div className="library-stats-grid">
              <div className="stat-badge-card">
                <span className="stat-badge-label">Games Owned</span>
                <span className="stat-badge-value">
                  {gameCount != null ? gameCount.toLocaleString() : 'Private / Unknown'}
                </span>
              </div>
              <div className="stat-badge-card">
                <span className="stat-badge-label">Total Playtime</span>
                <span className="stat-badge-value">
                  {totalPlaytime != null ? `${totalPlaytime.toLocaleString()} hrs` : 'Private / Unknown'}
                </span>
              </div>
              {mostPlayed && (
                <div className="stat-badge-card wide">
                  <span className="stat-badge-label">Most Played Game</span>
                  <span className="stat-badge-value">
                    <span className="mp-name">{mostPlayed.name}</span>
                    <span className="badge badge-info">{mostPlayed.playtime_hours.toLocaleString()} hrs</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Third-party analytics */}
        {(hasBp || hasCsf || hasSdb) && (
          <div className="steam-dashboard-section">
            <h4 className="section-title">📊 Third-Party Trading & Value Analytics</h4>
            <div className="third-party-grid">
              {hasBp && (
                <div className="third-party-card backpack-card">
                  <div className="tp-card-header">
                    <span className="tp-provider">backpack.tf</span>
                    <div className="tp-badges">
                      {!!res.backpack_tf_premium && <span className="badge badge-gold">Premium</span>}
                      {!!res.backpack_tf_banned && <span className="badge badge-danger">Banned</span>}
                    </div>
                  </div>
                  <div className="tp-details">
                    <div className="tp-row">
                      <span className="tp-label">TF2 Inventory Value:</span>
                      <span className="tp-value highlight-gold">
                        {res.backpack_value_tf2 != null
                          ? `$${(res.backpack_value_tf2 as number).toFixed(2)}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="tp-row">
                      <span className="tp-label">Trust Rating:</span>
                      <div className="trust-pills">
                        <span className="trust-pill trust-positive">+{(res.trust_positive as number) || 0}</span>
                        <span className="trust-pill trust-negative">-{(res.trust_negative as number) || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {hasCsf && (
                <div className={`third-party-card csfloat-card${!res.csfloat_registered ? ' disabled' : ''}`}>
                  <div className="tp-card-header">
                    <span className="tp-provider">CSFloat Market</span>
                    <span className={`badge ${res.csfloat_registered ? 'badge-success' : 'badge-muted'}`}>
                      {res.csfloat_registered ? 'Registered' : 'Not Registered'}
                    </span>
                  </div>
                  {res.csfloat_registered ? (
                    <div className="tp-details">
                      <div className="tp-row">
                        <span className="tp-label">Market Username:</span>
                        <span className="tp-value font-bold">{(res.csfloat_username as string) || 'Registered'}</span>
                      </div>
                      <div className="tp-row">
                        <span className="tp-label">Market Stats:</span>
                        <span className="tp-value">
                          {(res.csfloat_total_sales as number) || 0} sales / {(res.csfloat_total_purchases as number) || 0} buys
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="tp-details">
                      <span className="tp-placeholder-text">
                        This profile has not registered on CSFloat.
                      </span>
                    </div>
                  )}
                </div>
              )}
              {hasSdb && (
                <div className="third-party-card steamdb-worth-card">
                  <div className="tp-card-header">
                    <span className="tp-provider">SteamDB Calculator</span>
                    <span className="badge badge-info">Scraped</span>
                  </div>
                  <div className="tp-details">
                    <div className="tp-row">
                      <span className="tp-label">Estimated Worth (Today):</span>
                      <span className="tp-value highlight-green">{(res.price_today as string) || 'N/A'}</span>
                    </div>
                    <div className="tp-row">
                      <span className="tp-label">All-time Sales Lowest:</span>
                      <span className="tp-value highlight-blue">{(res.price_lowest as string) || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* External links */}
        <div className="steam-dashboard-section">
          <h4 className="section-title">🔗 External Platforms & Scanners</h4>
          <div className="steam-links-grid">
            {linkEntries
              .filter((l) => links[l.key])
              .map((l) => (
                <a
                  key={l.key}
                  href={links[l.key]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`steam-btn ${l.cls}`}
                >
                  {l.label}
                </a>
              ))}
          </div>
        </div>
      </div>

      {/* Inventories card */}
      {inventories.length > 0 && (
        <div className="steam-inventory-card full-width">
          <div className="card-label">Game Inventories</div>
          <div className="steam-inventories-grid">
            {inventories.map((inv, i) => {
              const isPublic = inv.status === 'Public';
              return (
                <div className="inventory-item-card" key={i}>
                  <div className="inventory-item-header">
                    <span className="inventory-game-name">{inv.game}</span>
                    <span className="inventory-item-count badge">{inv.item_count} items</span>
                  </div>
                  <div className="inventory-status-row">
                    <span className={`badge badge-${isPublic ? 'success' : 'danger'}`}>
                      {isPublic ? '🔓 Public' : `🔒 ${inv.status}`}
                    </span>
                  </div>
                  {inv.sample_items && inv.sample_items.length > 0 && (
                    <div className="inventory-samples">
                      <span className="samples-title">Item Preview:</span>
                      <ul className="samples-list">
                        {inv.sample_items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {isPublic && inv.item_count === 0 && (
                    <div className="inventory-empty">No items found (Empty inventory).</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
