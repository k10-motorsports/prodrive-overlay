// Connections tab

  // ═══════════════════════════════════════════════════════════════
  //  CONNECTIONS TAB — K10 Pro, SimHub, Discord
  // ═══════════════════════════════════════════════════════════════

  const DISCORD_GUILD_INVITE = 'https://discord.gg/racecor';
  // _discordUser declared in config.js
  let _discordConnecting = false;

  // K10 Pro Drive connection state (_k10User, _k10Features declared in config.js)
  let _k10Connecting = false;

  // Pro features — keys map to setting toggles and sidebar items
  const PRO_FEATURE_KEYS = ['commentary','incidents','spotter','leaderboard','datastream','webgl','reflections','modules','minimal','minimal-plus','branding'];

  function isProFeature(key) {
    // Feature gates removed — all local features are always available
    return null;
  }

  function isProEnabled(featureKey) {
    // Feature gates removed — all local features are always enabled
    return true;
  }

  function updateConnectionsTab() {
    updateSimhubConnectionCard();
    updateDiscordConnectionCard();
    updateK10ConnectionCard();
  }

  // ── K10 Pro Drive connection card ──
  function updateK10ConnectionCard() {
    const notConn = document.getElementById('k10NotConnected');
    const conn = document.getElementById('k10Connected');
    const info = document.getElementById('k10ProInfo');
    if (!notConn || !conn) return;

    if (_k10User) {
      notConn.style.display = 'none';
      conn.style.display = '';
      if (info) info.style.display = 'none';

      const nameEl = document.getElementById('k10DisplayName');
      const idEl = document.getElementById('k10UserId');
      const avatarEl = document.getElementById('k10Avatar');
      if (nameEl) nameEl.textContent = _k10User.discordDisplayName || _k10User.discordUsername || 'Connected';
      if (idEl) idEl.textContent = _k10User.discordId || '';
      if (avatarEl && _k10User.discordAvatar && _k10User.discordId) {
        avatarEl.src = `https://cdn.discordapp.com/avatars/${_k10User.discordId}/${_k10User.discordAvatar}.png?size=64`;
        avatarEl.alt = _k10User.discordDisplayName || '';
      }

      // Show feature list
      const featureList = document.getElementById('k10FeatureList');
      if (featureList) {
        featureList.innerHTML = _k10Features.map(f =>
          '<span class="conn-pro-feature-badge">' + f + '</span>'
        ).join('');
      }
    } else {
      notConn.style.display = '';
      conn.style.display = 'none';
      if (info) info.style.display = '';
    }

    // Populate AI Race Coach settings (key, tone, depth)
    _populateCoachSettings();

    // Update pro feature gating across all settings
    updateProFeatureGating();

    // Remote dashboard — visible when K10 connected (was Discord)
    updateRemoteDashVisibility();

    // iRacing tab — enabled when K10 connected (was Discord)
    if (typeof updateIRacingTabState === 'function') updateIRacingTabState();

    // Apply logo subtitle (updates when K10 connection state changes)
    if (typeof applyLogoSubtitle === 'function') applyLogoSubtitle();
  }

  // ── AI Race Coach settings ──
  window.updateAgentKey = function(key) {
    _settings.agentKey = key || '';
    saveSettings();
  };

  function _populateCoachSettings() {
    var akInput = document.getElementById('agentKeyInput');
    if (akInput) akInput.value = _settings.agentKey || '';

    var toneSelect = document.getElementById('coachToneSelect');
    if (toneSelect) toneSelect.value = _settings.coachTone || 'coach';

    var depthSelect = document.getElementById('coachDepthSelect');
    if (depthSelect) depthSelect.value = _settings.coachDepth || 'standard';
  }

  async function connectK10Pro() {
    if (_k10Connecting) return;
    if (!window.k10 || !window.k10.k10Connect) {
      // Fallback: open website in browser
      if (window.debugConsole) window.debugConsole.logNetwork('info', 'K10 connection not available, opening browser');
      if (window.k10 && window.k10.openExternal) {
        window.k10.openExternal('https://prodrive.racecor.io');
      }
      return;
    }

    _k10Connecting = true;
    const btn = document.getElementById('k10ConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

    if (window.debugConsole) window.debugConsole.logNetwork('request', 'K10 Pro Drive connection attempt');

    try {
      const result = await window.k10.k10Connect();
      if (result && result.success && result.user) {
        _k10User = result.user;
        _k10Features = result.user.features || [];
        _settings.k10User = result.user;
        _settings.k10Features = result.user.features || [];
        saveSettings();

        // Apply custom logo if available
        if (result.user.customLogoUrl && window.setCustomLogoUrl) {
          window.setCustomLogoUrl(result.user.customLogoUrl);
        }

        if (window.debugConsole) window.debugConsole.logNetwork('success', 'K10 Pro Drive connected - ' + (result.user.discordUsername || result.user.discordDisplayName || 'User'));

        updateK10ConnectionCard();

        // Cache auth token for session-sync.js
        if (window.k10 && window.k10.getK10Token) {
          window.k10.getK10Token().then(function(t) {
            _k10Token = t;

            // Trigger full iRacing career import on initial connect
            // (deduplicates server-side, safe to call even if data exists)
            if (_settings.iracingDataSync && window.triggerIRacingImport) {
              console.log('[Connections] K10 connected — triggering iRacing career sync');
              window.triggerIRacingImport();
            }
          }).catch(function() {});
        }
      } else {
        const errMsg = result?.error || 'Connection failed';
        console.warn('[K10] Pro connect failed:', errMsg);
        if (window.debugConsole) window.debugConsole.logNetwork('error', 'K10 connection failed - ' + errMsg);
        const text = document.getElementById('connK10Text');
        if (text) text.innerHTML = '<strong style="color:hsl(0,75%,60%)">Failed</strong> — ' + errMsg;
        setTimeout(() => {
          if (text) text.innerHTML = 'Not connected';
        }, 3000);
      }
    } catch (err) {
      console.error('[K10] Pro connect error:', err);
      if (window.debugConsole) window.debugConsole.logNetwork('error', 'K10 connection error - ' + (err.message || String(err)));
    } finally {
      _k10Connecting = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<img src="images/branding/logomark.png" alt="" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;filter:brightness(10);" /> Connect to K10 Pro Drive';
      }
    }
  }

  async function disconnectK10Pro() {
    if (window.k10 && window.k10.k10Disconnect) {
      await window.k10.k10Disconnect();
    }
    _k10User = null;
    _k10Features = [];
    _k10Token = null;
    delete _settings.k10User;
    delete _settings.k10Features;
    saveSettings();
    updateK10ConnectionCard();
  }

  // ── Pro Feature Gating ──
  // Previously gated local features behind K10 Pro connection.
  // All local features are now always available. Only session-sync
  // and remote dashboard still require a connection.
  function updateProFeatureGating() {
    // Clean up any leftover pro-locked classes and badges from prior sessions
    document.querySelectorAll('.pro-locked').forEach(el => el.classList.remove('pro-locked'));
    document.querySelectorAll('.pro-badge').forEach(el => el.style.display = 'none');
    document.querySelectorAll('[data-pro-tab]').forEach(tab => {
      tab.classList.remove('disabled');
      tab.title = '';
    });

    syncRallyToggles();
  }

  function navigateToConnections() {
    const tab = document.querySelector('.settings-sidebar-item[data-tab="connections"]');
    if (tab) switchSettingsTab(tab);
  }

  // ── SimHub connection card ──
  function updateSimhubConnectionCard() {
    const dot = document.getElementById('connSimhubDot');
    const text = document.getElementById('connSimhubText');
    const urlInput = document.getElementById('settingsSimhubUrl');
    const currentUrl = window._simhubUrlOverride || SIMHUB_URL;

    if (urlInput) urlInput.value = currentUrl;

    // Derive state from the existing connection status
    const connEl = document.getElementById('connStatus');
    const state = connEl ? (connEl.classList.contains('connected') ? 'connected' :
                            connEl.classList.contains('disconnected') ? 'disconnected' : 'connecting') : 'connecting';

    if (dot) {
      dot.className = 'conn-dot ' + (state === 'connected' ? 'green' : state === 'disconnected' ? 'red' : 'orange');
    }
    if (text) {
      if (state === 'connected') text.innerHTML = '<strong>Connected</strong>';
      else if (state === 'disconnected') text.innerHTML = '<strong>Disconnected</strong>';
      else text.innerHTML = 'Connecting...';
    }
  }

  // ── Discord connection card ──
  function updateDiscordConnectionCard() {
    const notConn = document.getElementById('discordNotConnected');
    const conn = document.getElementById('discordConnected');
    if (!notConn || !conn) return;

    if (_discordUser) {
      notConn.style.display = 'none';
      conn.style.display = '';
      const nameEl = document.getElementById('discordDisplayName');
      if (nameEl) nameEl.textContent = _discordUser.globalName || _discordUser.username;
    } else {
      notConn.style.display = '';
      conn.style.display = 'none';
    }

    // Show game features card when Discord is connected (legacy)
    const gameCard = document.getElementById('gameFeatureCard');
    if (gameCard) gameCard.style.display = _discordUser ? '' : 'none';
  }

  async function connectDiscord() {
    if (_discordConnecting) return;
    if (!window.k10 || !window.k10.discordConnect) {
      // Fallback: open invite link directly in browser
      openDiscordInvite();
      return;
    }

    _discordConnecting = true;
    const btn = document.getElementById('discordConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

    try {
      const result = await window.k10.discordConnect();
      if (result && result.success && result.user) {
        _discordUser = result.user;
        _settings.discordUser = result.user;
        saveSettings();
        updateDiscordConnectionCard();
      } else {
        const errMsg = result?.error || 'Connection failed';
        console.warn('[K10] Discord connect failed:', errMsg);
      }
    } catch (err) {
      console.error('[K10] Discord connect error:', err);
    } finally {
      _discordConnecting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
    }
  }

  async function disconnectDiscord() {
    if (window.k10 && window.k10.discordDisconnect) {
      await window.k10.discordDisconnect();
    }
    _discordUser = null;
    delete _settings.discordUser;
    saveSettings();
    updateDiscordConnectionCard();
  }

  function openDiscordInvite() {
    if (window.k10 && window.k10.openExternal) {
      window.k10.openExternal(DISCORD_GUILD_INVITE);
    } else {
      window.open(DISCORD_GUILD_INVITE, '_blank');
    }
  }

  function toggleRallyMode(el) {
    const isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    _rallyModeEnabled = !isOn;
    _settings.rallyMode = _rallyModeEnabled;
    _isRally = isRallyGame() || _rallyModeEnabled;
    applyGameMode();
    saveSettings();
    // Sync the layout section toggle
    syncRallyToggles();
  }

  function toggleLayoutRally(el) {
    const isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    _rallyModeEnabled = !isOn;
    _settings.rallyMode = _rallyModeEnabled;
    _isRally = isRallyGame() || _rallyModeEnabled;
    applyGameMode();
    saveSettings();
    // Sync the connections tab toggle
    syncRallyToggles();
  }

  /** Keep both rally toggles (layout + connections) in sync */
  function syncRallyToggles() {
    const layoutToggle = document.getElementById('layoutRallyToggle');
    const connToggle = document.querySelector('.settings-toggle[data-key="rallyMode"]:not(#layoutRallyToggle)');
    if (layoutToggle) layoutToggle.classList.toggle('on', _rallyModeEnabled);
    if (connToggle) connToggle.classList.toggle('on', _rallyModeEnabled);
  }

  /** Sync layout rally toggle state — always enabled */
  function updateLayoutRallyToggle() {
    const el = document.getElementById('layoutRallyToggle');
    const hint = document.getElementById('layoutRallyHint');
    if (!el) return;
    el.classList.remove('disabled');
    if (hint) hint.style.display = 'none';
  }

  // ── Remote Dashboard (LAN streaming via remote-server.js) ──

  async function toggleRemoteDash(el) {
    if (!window.k10) return;
    const isOn = el.classList.contains('on');
    const newVal = !isOn;
    el.classList.toggle('on', newVal);

    if (newVal) {
      const result = await window.k10.startRemoteServer();
      if (result && result.success) {
        _showRemoteDashDocs(result);
      } else {
        el.classList.remove('on');
        console.error('[K10] Remote server start failed:', result?.error);
      }
    } else {
      await window.k10.stopRemoteServer();
      document.getElementById('remoteDashDocs').style.display = 'none';
    }
  }

  function _showRemoteDashDocs(info) {
    const docs = document.getElementById('remoteDashDocs');
    const urlEl = document.getElementById('remoteServerUrl');
    if (!docs) return;
    docs.style.display = '';
    if (urlEl && info.url) urlEl.textContent = info.url;
    if (info.url) _renderQR('remoteServerQR', info.url);
  }

  function updateRemoteDashVisibility() {
    const section = document.getElementById('remoteDashSection');
    if (!section) return;
    if (window._k10RemoteMode) { section.style.display = 'none'; return; }
    section.style.display = _k10User ? '' : 'none';
  }

  async function initRemoteDashState() {
    if (window._k10RemoteMode) return;
    updateRemoteDashVisibility();
    if (!window.k10 || !window.k10.getRemoteServerInfo) return;
    try {
      const info = await window.k10.getRemoteServerInfo();
      if (info && info.running) {
        const toggle = document.getElementById('remoteDashToggle');
        if (toggle) toggle.classList.add('on');
        _showRemoteDashDocs(info);
      }
    } catch (e) { /* ok */ }
    updateRemoteDashVisibility();
  }

  // QR code rendering — uses the local qr-code.js module (no external API)
  function _renderQR(canvasId, text) {
    if (window.renderQRCode) window.renderQRCode(canvasId, text);
  }

  // Load Discord user on startup
  async function initDiscordState() {
    // Try loading from Electron's persisted file first
    if (window.k10 && window.k10.getDiscordUser) {
      try {
        const user = await window.k10.getDiscordUser();
        if (user && user.id) {
          _discordUser = user;
          updateDiscordConnectionCard();
          return;
        }
      } catch (e) { /* ok */ }
    }
    // Fallback: check settings
    if (_settings.discordUser && _settings.discordUser.id) {
      _discordUser = _settings.discordUser;
      updateDiscordConnectionCard();
    }
  }

  // Load K10 Pro user on startup
  async function initK10State() {
    // Try loading from Electron's persisted file first
    if (window.k10 && window.k10.getK10User) {
      try {
        const user = await window.k10.getK10User();
        if (user && user.id) {
          _k10User = user;
          _k10Features = user.features || [];

          // Apply custom logo if available
          if (user.customLogoUrl && window.setCustomLogoUrl) {
            window.setCustomLogoUrl(user.customLogoUrl);
          }

          updateK10ConnectionCard();

          // Cache auth token for session-sync.js + check iRacing sync on load
          if (window.k10 && window.k10.getK10Token) {
            window.k10.getK10Token().then(function(t) {
              _k10Token = t;

              // Check if iRacing history needs syncing (on overlay load)
              if (_settings.iracingDataSync && window.checkAndSyncIRacingHistory) {
                // Small delay to let the plugin HTTP server start
                setTimeout(function() { window.checkAndSyncIRacingHistory(); }, 3000);
              }
            }).catch(function() {});
          }

          // Verify token in background
          if (window.k10.verifyK10Token) {
            window.k10.verifyK10Token().then(result => {
              if (result && !result.valid) {
                console.warn('[K10] Pro token invalid — clearing session');
                _k10User = null;
                _k10Features = [];
                delete _settings.k10User;
                delete _settings.k10Features;
                saveSettings();
                updateK10ConnectionCard();
              } else if (result && result.features) {
                _k10Features = result.features;
                // Apply custom logo from verify result
                if (result.user && result.user.customLogoUrl && window.setCustomLogoUrl) {
                  window.setCustomLogoUrl(result.user.customLogoUrl);
                }
                updateK10ConnectionCard();
              }
            }).catch(() => {});
          }
          return;
        }
      } catch (e) { /* ok */ }
    }
    // Fallback: check settings
    if (_settings.k10User && _settings.k10User.id) {
      _k10User = _settings.k10User;
      _k10Features = _settings.k10Features || [];

      // Apply custom logo if available
      if (_settings.k10User.customLogoUrl && window.setCustomLogoUrl) {
        window.setCustomLogoUrl(_settings.k10User.customLogoUrl);
      }

      updateK10ConnectionCard();

      // Cache auth token for session-sync.js + check iRacing sync on load
      if (window.k10 && window.k10.getK10Token) {
        window.k10.getK10Token().then(function(t) {
          _k10Token = t;

          // Check if iRacing history needs syncing (on overlay load)
          if (_settings.iracingDataSync && window.checkAndSyncIRacingHistory) {
            // Small delay to let the plugin HTTP server start
            setTimeout(function() { window.checkAndSyncIRacingHistory(); }, 3000);
          }
        }).catch(function() {});
      }
    }
  }

  function toggleSetting(el) {
    const key = el.dataset.key;
    const isOn = el.classList.contains('on');
    _settings[key] = !isOn;
    el.classList.toggle('on', !isOn);

    const els = _findSectionEls(el.dataset.section);
    els.forEach(e => e.classList.toggle('section-hidden', isOn));

    _collapseParentColumns();

    // Re-run layout so dynamically positioned panels (pitbox) reflow
    applyLayout();

    saveSettings();
  }

  function toggleWebGL(el) {
    const isOn = el.classList.contains('on');
    const newVal = !isOn;
    el.classList.toggle('on', newVal);
    _settings.showWebGL = newVal;
    // Show/hide all WebGL overlay canvases
    document.querySelectorAll('.gl-overlay').forEach(c => {
      c.style.display = newVal ? '' : 'none';
    });
    saveSettings();
  }

  function updateAmbientMode(mode) {
    _settings.ambientMode = mode;
    // Migrate legacy boolean → new mode
    delete _settings.showAmbientLight;
    applyAmbientMode(mode);
    saveSettings();
  }

  function applyAmbientMode(mode) {
    const body = document.body;
    body.classList.remove('ambient-off', 'ambient-matte', 'ambient-plastic');
    if (mode === 'off') {
      body.classList.add('ambient-off');
      if (typeof window.stopAmbientLight === 'function') window.stopAmbientLight();
    } else {
      if (mode === 'matte') body.classList.add('ambient-matte');
      if (mode === 'plastic') body.classList.add('ambient-plastic');
      if (typeof window.startAmbientLight === 'function') window.startAmbientLight();
    }
    // Expose mode for WebGL shader: 0=off, 1=matte, 2=reflective
    // Plastic uses CSS-only glow — tell WebGL ambient is OFF so it skips
    // the expensive ambientGlow() + glassReflection() shader passes,
    // freeing GPU time for g-force vignette, RPM redline, and panel glow.
    window._ambientModeInt = (mode === 'off' || mode === 'plastic') ? 0
                           : mode === 'matte' ? 1 : 2;
  }

  function toggleBonkers(el) {
    const isOn = el.classList.contains('on');
    const newVal = !isOn;
    el.classList.toggle('on', newVal);
    _settings.showBonkers = newVal;
    document.body.classList.toggle('bonkers-off', !newVal);
    saveSettings();
  }

  function updateSimhubUrl(url) {
    _settings.simhubUrl = url;
    // Update the polling constant (for standalone mode)
    if (typeof SIMHUB_URL !== 'undefined') {
      // Can't reassign const, but we can update the fetch function
      window._simhubUrlOverride = url;
    }
    // Reset connection failure counter to retry immediately with new URL
    window._connFails = 0;
    window._backoffUntil = 0;
    saveSettings();
  }

  // ─── Game Logo toggle ───
  function toggleGameLogo(el) {
    const isOn = el.classList.contains('on');
    _settings.showGameLogo = !isOn;
    el.classList.toggle('on', !isOn);
    saveSettings();
    // Immediately update the logo visibility
    if (window.updateGameLogo) window.updateGameLogo(window._currentGameId || 'iracing', !isOn);
  }

  // ─── iRacing Data Sync toggle ───
  function toggleIRacingSync(el) {
    var isOn = el.classList.contains('on');
    var newVal = !isOn;
    el.classList.toggle('on', newVal);
    _settings.iracingDataSync = newVal;

    var detail = document.getElementById('iracingSyncDetail');
    var active = document.getElementById('iracingSyncActive');
    if (detail) detail.style.display = newVal ? 'none' : '';
    if (active) active.style.display = newVal ? '' : 'none';

    saveSettings();

    // If just enabled, trigger sync check now
    if (newVal && window.checkAndSyncIRacingHistory) {
      window.checkAndSyncIRacingHistory();
    }
  }
  window.toggleIRacingSync = toggleIRacingSync;

  // ─── iRacing OAuth Notice ───
  // Legacy auth retired Dec 2025. Show notice when sync can't authenticate.
  window.showIRacingOAuthNotice = function() {
    var notice = document.getElementById('iracingOAuthNotice');
    if (notice) notice.style.display = '';
  };

  // ─── Logo subtitle ───
  function updateLogoSubtitle(value) {
    _settings.logoSubtitle = value;
    applyLogoSubtitle();
    saveSettings();
  }
  window.updateLogoSubtitle = updateLogoSubtitle;

  function applyLogoSubtitle() {
    var label = document.getElementById('k10SubtitleLabel');
    var logo = document.getElementById('k10LogoSquare');
    if (!logo) return;

    // Create label element if it doesn't exist
    if (!label) {
      label = document.createElement('span');
      label.id = 'k10SubtitleLabel';
      label.className = 'logo-subtitle';
      logo.appendChild(label);
    }

    var text = _settings.logoSubtitle || '';
    // Show subtitle only when K10 Pro is connected and text is set
    if (text && _k10User) {
      label.textContent = text;
      label.style.display = 'block';
      label.style.opacity = '1';
    } else if (!_k10User && !text) {
      // Teaser: show placeholder for logged-out users
      label.textContent = 'K10 Motorsports';
      label.style.display = 'block';
      label.style.opacity = '0.3';
    } else if (text && !_k10User) {
      label.textContent = text;
      label.style.display = 'block';
      label.style.opacity = '0.3';
    } else {
      label.style.display = 'none';
    }
  }
  window.applyLogoSubtitle = applyLogoSubtitle;

  // ─── Green screen mode ───
  async function toggleGreenScreen(el) {
    const isOn = el.classList.contains('on');
    const newValue = !isOn;
    el.classList.toggle('on', newValue);
    _settings.greenScreen = newValue;
    document.getElementById('greenScreenHint').style.display = 'block';
    await saveSettings();
    // Electron's transparent property can't change at runtime — restart required
    if (window.k10 && window.k10.restartApp) {
      const hint = document.getElementById('greenScreenHint');
      hint.textContent = newValue
        ? 'Restarting into green-screen mode…'
        : 'Restarting into transparent overlay mode…';
      setTimeout(() => window.k10.restartApp(), 400);
    }
  }

  // ─── Layout management ───

  /* ── Layout Position Map ──
     5 positions: 4 user-selectable corners + 1 programmatic (absolute-center).
     All behavior is deterministic from the position:
       Right → RTL flow        Left → LTR flow
       Bottom → column-reverse + vswap (automatic)
       Absolute-center → pre-race/podium, ~500px from top */
  const _layoutPositionMap = {
    'top-right': 'layout-tr', 'top-left': 'layout-tl',
    'bottom-right': 'layout-br', 'bottom-left': 'layout-bl',
    'absolute-center': 'layout-ac'
  };
  const _allLayoutClasses = Object.values(_layoutPositionMap);

  function applyLayout() {
    const dash = document.getElementById('dashboard');
    const pos = _settings.layoutPosition || 'top-right';

    // ── 1. Dashboard position ──
    _allLayoutClasses.forEach(c => dash.classList.remove(c));
    dash.classList.add(_layoutPositionMap[pos] || 'layout-tr');

    // Derived properties — deterministic from corner choice
    const isBottom = pos.includes('bottom');
    const isRight  = pos.includes('right');
    const isLeft   = pos.includes('left');
    const isCenter = (pos === 'absolute-center');

    // ── 2. Commentary: diagonally opposite corner ──
    const cmtCol = document.getElementById('commentaryCol');
    if (cmtCol) {
      cmtCol.classList.remove('cmt-tl', 'cmt-tr', 'cmt-bl', 'cmt-br');
      if (!isCenter) {
        const cmtV = isBottom ? 't' : 'b';
        const cmtH = isRight  ? 'l' : 'r';
        cmtCol.classList.add('cmt-' + cmtV + cmtH);
      } else {
        // Absolute-center: commentary goes bottom-left
        cmtCol.classList.add('cmt-bl');
      }
    }

    // ── 3. Sync settings dropdown ──
    const posSelect = document.getElementById('settingsPosition');
    if (posSelect && posSelect.value !== pos) posSelect.value = pos;

    // ── 4. Secondary panels (leaderboard, datastream, pitbox) ──
    // Opposite vertical edge, same horizontal edge as main HUD.
    // Two rows: main HUD + incidents on one edge, sec panels + commentary on the other.
    const secVert  = isCenter ? 'bottom' : (isBottom ? 'top'    : 'bottom');
    const secHoriz = isCenter ? 'right'  : (isRight  ? 'right'  : 'left');

    const sec = document.getElementById('secContainer');
    if (sec) {
      sec.classList.remove('sec-top', 'sec-bottom', 'sec-left', 'sec-right');
      sec.classList.add('sec-' + secVert);
      sec.classList.add('sec-' + secHoriz);
      sec.style.marginTop = '';
      sec.style.marginBottom = '';
    }

    // Individual panel class bookkeeping (for CSS styling hooks)
    const lb = document.getElementById('leaderboardPanel');
    if (lb) {
      lb.classList.remove('lb-top', 'lb-bottom', 'lb-left', 'lb-right');
      lb.classList.add('lb-' + secVert, 'lb-' + secHoriz);
    }
    const ds = document.getElementById('datastreamPanel');
    if (ds) {
      ds.classList.remove('ds-top', 'ds-bottom', 'ds-left', 'ds-right');
      ds.classList.add('ds-' + secVert, 'ds-' + secHoriz);
    }
    const pb = document.getElementById('pitBoxPanel');
    if (pb) {
      pb.classList.remove('pb-top', 'pb-bottom', 'pb-left', 'pb-right');
      pb.classList.add('pb-' + secVert, 'pb-' + secHoriz);
    }

    // ── 5. Incidents: same vertical edge as sec-container, always opposite
    //       horizontal edge from it (diagonal from main HUD) ──
    const incVert  = secVert;
    const incHoriz = secHoriz === 'right' ? 'left' : 'right';

    const inc = document.getElementById('incidentsPanel');
    if (inc) {
      inc.classList.remove('inc-top', 'inc-bottom', 'inc-left', 'inc-right');
      inc.classList.add('inc-' + incVert);
      inc.classList.add('inc-' + incHoriz);
      // Explicit inline resets — CEF/Electron can hold stale values after
      // class removal; force every position property so nothing lingers.
      inc.style.top    = incVert  === 'top'   ? '' : 'auto';
      inc.style.bottom = incVert  === 'bottom'? '' : 'auto';
      inc.style.left   = incHoriz === 'left'  ? '' : 'auto';
      inc.style.right  = incHoriz === 'right' ? '' : 'auto';
      inc.style.marginTop = '';
      inc.style.marginBottom = '';
      console.log('[layout] incidents → ' + incVert + '-' + incHoriz +
        ' (sec=' + secVert + '-' + secHoriz + ', pos=' + pos + ')');
    }

    // ── 6. Spotter: co-located with race control at top center ──
    // Positioning is handled entirely by CSS (top: 8px, left: 50%, transform).
    // No layout-dependent positioning needed.

    // ── 7. Apply bottom Y-offset ──
    // When layout is bottom-oriented, apply margin-bottom offset to relevant panels
    // Bottom Y-offset: apply margin-bottom to bottom-oriented panels
    var yOff = (_settings.bottomYOffset || 0) + 'px';
    var isBottomLayout = pos.startsWith('bottom');
    var ySecContainer = document.getElementById('secContainer');
    var yIncPanel = document.getElementById('incidentsPanel');
    var yCmtCol = document.getElementById('commentaryCol');
    var yGameLogo = document.getElementById('gameLogoOverlay');
    if (ySecContainer) ySecContainer.style.marginBottom = isBottomLayout ? yOff : '';
    if (yIncPanel) yIncPanel.style.marginBottom = isBottomLayout ? yOff : '';
    if (yCmtCol) yCmtCol.style.marginBottom = isBottomLayout ? yOff : '';
    if (yGameLogo) yGameLogo.style.marginBottom = isBottomLayout ? yOff : '';
  }

  function updateLayoutPosition(value) {
    _settings.layoutPosition = value;
    applyLayout();
    saveSettings();
  }

  // Layout helper functions removed — all behavior is now deterministic
  // from the 4-corner position choice. No flow/vswap/oppose/offset toggles needed.

  function previewZoom(val) {
    // Live preview: apply zoom to all modules while dragging, but NOT the settings panel
    val = Math.max(100, Math.min(200, +val));
    document.getElementById('zoomVal').textContent = val + '%';
    applyZoom(val, true);  // skipSettings = true
  }
  function updateZoom(val) {
    val = Math.max(100, Math.min(200, +val));
    _settings.zoom = val;
    document.getElementById('zoomVal').textContent = val + '%';
    applyZoom(val, false);  // apply to everything including settings
    saveSettings();
  }
  function applyZoom(val, skipSettings) {
    const scale = (val || 100) / 100;
    document.documentElement.style.setProperty('--dash-zoom', scale);

    // Scale --edge so zoomed fixed elements keep consistent visual margins.
    // At zoom 1.65, a 10px edge in CSS gives only ~6px visual gap.
    // Compensate: --edge-z = base-edge / zoom (so CSS 6px * 1.65 zoom = 10px visual).
    const baseEdge = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--edge')) || 10;
    document.documentElement.style.setProperty('--edge-z', (baseEdge / scale) + 'px');

    // Zoomed fixed elements: dashboard, incidents, spotter, commentary, race control
    document.getElementById('dashboard').style.zoom = scale;
    const inc = document.getElementById('incidentsPanel');
    if (inc) inc.style.zoom = scale;
    const sp = document.getElementById('spotterPanel');
    if (sp) sp.style.zoom = scale;
    const cmtCol = document.getElementById('commentaryCol');
    if (cmtCol) cmtCol.style.zoom = scale;
    const rc = document.getElementById('rcBanner');
    if (rc) rc.style.zoom = scale;

    // Secondary container: zoom the container, not individual panels.
    // Container is position:fixed — its --edge offset needs compensating too.
    const sec = document.getElementById('secContainer');
    if (sec) sec.style.zoom = scale;

    // Scale the settings panel itself on release (not during drag)
    if (!skipSettings) {
      const settingsOverlay = document.getElementById('settingsOverlay');
      if (settingsOverlay) settingsOverlay.style.zoom = scale;
    }
  }

  function previewBottomYOffset(val) {
    document.getElementById('bottomYOffsetVal').textContent = val + 'px';
    _settings.bottomYOffset = parseInt(val, 10);
    applyLayout();
    saveSettings();
  }
  window.previewBottomYOffset = previewBottomYOffset;

  function updateForceFlag(val) {
    _forceFlagState = val;
    _settings.forceFlag = val;
    saveSettings();
  }

  function toggleSettings() {
    const overlay = document.getElementById('settingsOverlay');
    const isOpen = overlay.classList.contains('open');
    if (isOpen) {
      // Closing — also exit settings mode via Electron
      overlay.classList.remove('open');
      document.body.classList.remove('settings-active');
      document.body.classList.remove('settings-drag');
      if (window.k10?.releaseInteractive) window.k10.releaseInteractive();
      // Stop ambient preview when settings close
      if (typeof window.stopAmbientPreview === 'function') window.stopAmbientPreview();
    } else {
      // Opening — also enter settings mode
      overlay.classList.add('open');
      document.body.classList.add('settings-active');
      if (window.k10?.requestInteractive) window.k10.requestInteractive();
      // Start ambient preview when settings open
      if (typeof window.startAmbientPreview === 'function') window.startAmbientPreview();
    }
  }

  // ─── Persistence ───
  async function loadSettings() {
    let saved = null;
    // Try Electron IPC first
    if (window.k10 && window.k10.getSettings) {
      saved = await window.k10.getSettings();
    }
    // Fallback to localStorage
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem('k10-broadcast-settings')); } catch(e) {}
    }
    if (saved) _settings = Object.assign({}, _defaultSettings, saved);
    applySettings();
  }

  async function saveSettings() {
    // Try Electron IPC first
    if (window.k10 && window.k10.saveSettings) {
      await window.k10.saveSettings(_settings);
    }
    // Broadcast to the other window (overlay ↔ popout) via main process relay
    if (window.k10 && window.k10.notifySettingsChanged) {
      window.k10.notifySettingsChanged(_settings);
    }
    // Also save to localStorage
    try { localStorage.setItem('k10-broadcast-settings', JSON.stringify(_settings)); } catch(e) {}
  }

  // ─── Electron settings mode listener ───
  // Ctrl+Shift+S directly opens/closes the settings modal.
  // Closing the modal also exits settings mode.
  if (window.k10 && window.k10.onSettingsMode) {
    window.k10.onSettingsMode((active) => {
      const overlay = document.getElementById('settingsOverlay');
      if (active) {
        // Open the settings modal
        overlay.classList.add('open');
        document.body.classList.add('settings-active');
      } else {
        // Close the settings modal
        overlay.classList.remove('open');
        document.body.classList.remove('settings-active');
      }
    });
  }

  // Load settings on startup
  loadSettings();
  initDiscordState();
  initK10State();
  initRemoteDashState();

  // Restore iRacing sync toggle state
  var syncToggle = document.getElementById('iracingSyncToggle');
  if (syncToggle && _settings.iracingDataSync) {
    syncToggle.classList.add('on');
    var detail = document.getElementById('iracingSyncDetail');
    var active = document.getElementById('iracingSyncActive');
    if (detail) detail.style.display = 'none';
    if (active) active.style.display = '';
  }

  // ═══════════════════════════════════════════════════════════════
