// Settings system
  // _defaultSettings, _settings, _forceFlagState declared in config.js

  // Section class/id → element finder
  function _findSectionEls(sectionKey) {
    // Try as ID first, then as class
    let el = document.getElementById(sectionKey);
    if (el) return [el];
    return Array.from(document.querySelectorAll('.' + sectionKey));
  }

  function applySettings() {
    const toggles = document.querySelectorAll('.settings-toggle[data-key]');
    toggles.forEach(t => {
      const key = t.dataset.key;
      const on = _settings[key] !== false;
      t.classList.toggle('on', on);

      const els = _findSectionEls(t.dataset.section);
      els.forEach(el => el.classList.toggle('section-hidden', !on));
    });

    // Parent column collapse: hide wrappers when all children hidden
    _collapseParentColumns();

    // SimHub URL
    const urlInput = document.getElementById('settingsSimhubUrl');
    if (urlInput) urlInput.value = _settings.simhubUrl || 'http://localhost:8889/k10mediabroadcaster/';
    // Restore saved URL override so polling uses the persisted URL
    if (_settings.simhubUrl && _settings.simhubUrl !== SIMHUB_URL) {
      window._simhubUrlOverride = _settings.simhubUrl;
    }

    // Green screen toggle — reflect saved state
    const gsToggle = document.getElementById('greenScreenToggle');
    if (gsToggle) gsToggle.classList.toggle('on', _settings.greenScreen === true);
    // Body class for CSS targeting
    document.body.classList.toggle('green-screen-mode', _settings.greenScreen === true);

    // WebGL effects toggle
    const webglOn = _settings.showWebGL !== false;
    document.querySelectorAll('.gl-overlay').forEach(c => {
      c.style.display = webglOn ? '' : 'none';
    });

    // Ambient light mode — migrate legacy boolean to 3-way string
    if (typeof _settings.showAmbientLight === 'boolean') {
      _settings.ambientMode = _settings.showAmbientLight ? 'reflective' : 'off';
      delete _settings.showAmbientLight;
    }
    const ambMode = _settings.ambientMode || 'reflective';
    if (typeof applyAmbientMode === 'function') applyAmbientMode(ambMode);
    const ambSel = document.getElementById('settingsAmbientMode');
    if (ambSel) ambSel.value = ambMode;
    // Restore saved capture region — only send to main process if ambient is ON
    // (Sending the rect when ambient is off used to auto-start capture via IPC race condition)
    if (ambMode !== 'off' && typeof window.restoreAmbientCapture === 'function') window.restoreAmbientCapture();

    // Bonkers pit limiter toggle
    document.body.classList.toggle('bonkers-off', _settings.showBonkers === false);

    // Layout — all behavior is deterministic from position choice
    applyLayout();

    // Zoom
    const zoomVal = _settings.zoom || 100;
    const zoomSlider = document.getElementById('settingsZoom');
    const zoomLabel = document.getElementById('zoomVal');
    if (zoomSlider) zoomSlider.value = zoomVal;
    if (zoomLabel) zoomLabel.textContent = zoomVal + '%';
    applyZoom(zoomVal);

    // Force flag
    _forceFlagState = _settings.forceFlag || '';
    const flagSelect = document.getElementById('settingsForceFlag');
    if (flagSelect) flagSelect.value = _forceFlagState;

    // Rally mode
    _rallyModeEnabled = _settings.rallyMode || false;
    _isRally = isRallyGame() || _rallyModeEnabled;

    // Sync layout rally toggle (will be updated again when K10 state loads)
    const layoutRallyToggle = document.getElementById('layoutRallyToggle');
    if (layoutRallyToggle) layoutRallyToggle.classList.toggle('on', _rallyModeEnabled);

    // Drive mode toggle sync
    const dmToggle = document.getElementById('driveModeToggle');
    if (dmToggle) dmToggle.classList.toggle('on', _settings.driveMode === true);
    if (_settings.driveMode && typeof setDriveMode === 'function') setDriveMode(true);

    // Leaderboard settings
    const lbFocusSelect = document.getElementById('settingsLbFocus');
    if (lbFocusSelect) lbFocusSelect.value = _settings.lbFocus || 'me';
    const lbMaxSelect = document.getElementById('settingsLbMaxRows');
    if (lbMaxSelect) lbMaxSelect.value = String(_settings.lbMaxRows || 5);
    const lbExpandToggle = document.getElementById('lbExpandToggle');
    if (lbExpandToggle) lbExpandToggle.classList.toggle('on', _settings.lbExpandToFill === true);

    // Datastream field toggles
    applyDsFieldToggles();

    // Logo-only startup: apply body class so CSS hides everything except logos
    if (_settings.logoOnlyStart !== false) {
      document.body.classList.add('logo-only');
    }
  }

  // Called by poll-engine when session goes active (game running + session state > 0).
  // Removes logo-only mode with a reveal transition.
  let _logoOnlyRevealed = false;
  function revealFromLogoOnly() {
    if (_logoOnlyRevealed) return;
    _logoOnlyRevealed = true;
    document.body.classList.add('logo-only-reveal');
    document.body.classList.remove('logo-only');
    // Clean up the reveal class after transition completes
    setTimeout(() => document.body.classList.remove('logo-only-reveal'), 1200);
  }

  function _collapseParentColumns() {
    // Controls + Pedals share controls-pedals-block
    const cpBlock = document.querySelector('.controls-pedals-block');
    if (cpBlock) {
      const ctrlHidden = _settings.showControls === false;
      const pedalsHidden = _settings.showPedals === false;
      cpBlock.classList.toggle('section-hidden', ctrlHidden && pedalsHidden);
    }
    // Logo column: hide if both logos hidden
    const logoCol = document.querySelector('.logo-col');
    if (logoCol) {
      const k10Hidden = _settings.showK10Logo === false;
      const carHidden = _settings.showCarLogo === false;
      logoCol.classList.toggle('section-hidden', k10Hidden && carHidden);
    }
  }

  function switchSettingsTab(tab) {
    const tabName = tab.dataset.tab;
    // Check if this tab requires pro and is disabled
    if (tab.classList.contains('disabled') && tab.dataset.proTab) {
      navigateToConnections();
      return;
    }
    // Update both sidebar items and legacy tab bar
    document.querySelectorAll('.settings-sidebar-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.toggle('active', c.id === 'settingsTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)));
    // Refresh connection status when switching to Connections tab
    if (tabName === 'connections') updateConnectionsTab();
  }

  // Subtab switching within a settings tab (e.g. Dashboard → Main HUD / Leaderboard / etc.)
  function switchSectionSubtab(el) {
    const subtab = el.dataset.subtab;
    const container = el.closest('.settings-tab-content');
    if (!container) return;
    container.querySelectorAll('.settings-subtab').forEach(t => t.classList.toggle('active', t.dataset.subtab === subtab));
    container.querySelectorAll('.settings-subtab-page').forEach(p => p.classList.toggle('active', p.dataset.subtabPage === subtab));
  }

  // ── Leaderboard settings ──

  function updateLbFocus(value) {
    _settings.lbFocus = value;
    window._lbLastJson = ''; // force re-render
    saveSettings();
  }

  function updateLbMaxRows(value) {
    _settings.lbMaxRows = Math.max(1, Math.min(40, +value || 5));
    window._lbLastJson = '';
    saveSettings();
  }

  function toggleLbExpand(el) {
    const isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    _settings.lbExpandToFill = !isOn;
    window._lbLastJson = '';
    saveSettings();
  }

  // ── Datastream field toggles ──

  function toggleDsSetting(el) {
    const key = el.dataset.key;
    if (!key) return;
    const isOn = el.classList.contains('on');
    _settings[key] = !isOn;
    el.classList.toggle('on', !isOn);
    applyDsFieldToggles();
    saveSettings();
  }

  function applyDsFieldToggles() {
    document.querySelectorAll('[data-ds-field]').forEach(el => {
      const key = el.dataset.dsField;
      const show = _settings[key] !== false;
      el.style.display = show ? '' : 'none';
    });
  }

  // ── Draggable settings panel ──
  (function initSettingsDrag() {
    let _isDragging = false, _dragOffX = 0, _dragOffY = 0;
    document.addEventListener('DOMContentLoaded', function() {
      const bar = document.getElementById('settingsTitlebar');
      const panel = document.getElementById('settingsPanel');
      if (!bar || !panel) return;
      bar.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        _isDragging = true;
        const rect = panel.getBoundingClientRect();
        _dragOffX = e.clientX - rect.left;
        _dragOffY = e.clientY - rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!_isDragging) return;
        var rawLeft = e.clientX - _dragOffX;
        var rawTop  = e.clientY - _dragOffY;
        // Clamp aggressively: keep at least half the panel width and the
        // full titlebar height visible on-screen at all times. The previous
        // 40px margin was too loose — the panel could be dragged almost
        // entirely off-screen in all directions.
        var minVisible = Math.max(200, Math.round(panel.offsetWidth * 0.5));
        var maxLeft = window.innerWidth  - minVisible;
        var minLeft = -(panel.offsetWidth - minVisible);
        var maxTop  = window.innerHeight - 60; // keep titlebar reachable
        panel.style.position = 'fixed';
        panel.style.left = Math.max(minLeft, Math.min(maxLeft, rawLeft)) + 'px';
        panel.style.top  = Math.max(0, Math.min(maxTop, rawTop)) + 'px';
        panel.style.margin = '0';
      });
      document.addEventListener('mouseup', function() { _isDragging = false; });
    });
  })();

  // ── Commentary settings (migrated from SimHub plugin) ──
  // These settings are sent to the plugin via the HTTP bridge.
  function updateCommentarySetting(key, value) {
    var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=setSetting&key=' + encodeURIComponent(key) + '&value=' + encodeURIComponent(value);
    fetch(url).catch(function() {});
  }
  function toggleCommentarySetting(el, key) {
    var isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    updateCommentarySetting(key, !isOn ? '1' : '0');
  }
  function toggleCommentaryCategory(el, category) {
    var isOn = el.classList.contains('on');
    el.classList.toggle('on', !isOn);
    updateCommentarySetting('category_' + category, !isOn ? '1' : '0');
  }

  // Load K10 logo into settings titlebar + populate version from package.json
  document.addEventListener('DOMContentLoaded', function() {
    var logoEl = document.getElementById('settingsTitlebarLogo');
    if (logoEl) {
      var img = document.createElement('img');
      img.src = 'images/branding/logomark.png';
      img.alt = 'K10';
      logoEl.appendChild(img);
    }
    // Version label — read from Electron app.getVersion() (set by package.json)
    if (window.k10 && window.k10.getVersion) {
      window.k10.getVersion().then(function(ver) {
        var el = document.getElementById('settingsVersionLabel');
        if (el && ver) el.textContent = 'K10 Motorsports v' + ver + ' \u2014 Media Overlay';
      });
    }
  });

  // ── Popout settings to secondary display ──
  function popoutSettings() {
    if (window.k10 && window.k10.openSettingsPopout) {
      window.k10.openSettingsPopout();
      // Close the inline settings panel on the main overlay
      var overlay = document.getElementById('settingsOverlay');
      if (overlay && overlay.classList.contains('open')) {
        toggleSettings();
      }
    }
  }

  // ── Popout window initialisation ──
  // When this page loads with ?settingsPopout=1, switch into popout mode:
  // hide all dashboard panels, auto-open settings, fill the window.
  document.addEventListener('DOMContentLoaded', function() {
    if (window.k10 && window.k10.isSettingsPopout && window.k10.isSettingsPopout()) {
      document.body.classList.add('settings-popout');
      // Force settings open (the overlay CSS rules handle the rest)
      var overlay = document.getElementById('settingsOverlay');
      if (overlay) overlay.classList.add('open');
      document.body.classList.add('settings-active');
    }
  });

  // ── Cross-window settings sync ──
  // When the other window changes settings, apply them here.
  if (window.k10 && window.k10.onSettingsSync) {
    window.k10.onSettingsSync(function(newSettings) {
      if (newSettings && typeof newSettings === 'object') {
        Object.assign(_settings, newSettings);
        applySettings();
      }
    });
  }

  // When the popout window is closed, re-enable the popout button
  if (window.k10 && window.k10.onSettingsPopoutClosed) {
    window.k10.onSettingsPopoutClosed(function() {
      var btn = document.getElementById('settingsPopoutBtn');
      if (btn) btn.disabled = false;
    });
  }

  // ═══════════════════════════════════════════════════════════════
