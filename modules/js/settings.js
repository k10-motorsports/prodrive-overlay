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

    // SimHub URL — restore saved URL override so polling uses the persisted URL
    if (_settings.simhubUrl && _settings.simhubUrl !== SIMHUB_URL) {
      window._simhubUrlOverride = _settings.simhubUrl;
    }

    // Green screen
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
    // Restore saved capture region — only send to main process if ambient is ON
    // (Sending the rect when ambient is off used to auto-start capture via IPC race condition)
    if (ambMode !== 'off' && typeof window.restoreAmbientCapture === 'function') window.restoreAmbientCapture();

    // Bonkers pit limiter toggle
    document.body.classList.toggle('bonkers-off', _settings.showBonkers === false);

    // Layout — all behavior is deterministic from position choice
    applyLayout();

    // Zoom
    const zoomVal = _settings.zoom || 100;
    applyZoom(zoomVal);

    // Logo Subtitle
    if (typeof applyLogoSubtitle === 'function') applyLogoSubtitle();

    // Force flag
    _forceFlagState = _settings.forceFlag || '';

    // Rally mode
    _rallyModeEnabled = _settings.rallyMode || false;
    _isRally = isRallyGame() || _rallyModeEnabled;

    // Drive mode
    if (_settings.driveMode && typeof setDriveMode === 'function') setDriveMode(true);

    // Datastream field toggles
    applyDsFieldToggles();

    // Logo-only startup: apply body class so CSS hides everything except logos.
    // Only add if we haven't already revealed — otherwise applySettings()
    // re-applies logo-only every time a mode or setting changes.
    if (_settings.logoOnlyStart !== false && !_logoOnlyRevealed) {
      document.body.classList.add('logo-only');
    }

    // Theme — sync body attribute for CSS variable theming
    const theme = _settings.theme || 'dark';
    document.body.setAttribute('data-theme', theme);

    // Visual mode classes
    const preset = _settings.visualPreset || 'standard';
    document.body.classList.remove('mode-minimal', 'mode-minimal-plus');
    if (preset === 'minimal') {
      document.body.classList.add('mode-minimal');
    } else if (preset === 'minimal-plus') {
      document.body.classList.add('mode-minimal-plus');
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
    // When a visual preset mode is active, CSS rules in modes.css handle all
    // visibility. Skip the section-hidden collapse logic to avoid interfering.
    if (document.body.classList.contains('mode-minimal') || document.body.classList.contains('mode-minimal-plus')) {
      return;
    }

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

  // ── Datastream field toggles ──

  function applyDsFieldToggles() {
    document.querySelectorAll('[data-ds-field]').forEach(el => {
      const key = el.dataset.dsField;
      const show = _settings[key] !== false;
      el.style.display = show ? '' : 'none';
    });
  }

  // ── Visual mode presets (Minimal, Minimal+, Standard) ──
  function applyVisualPreset(preset) {
    _settings.visualPreset = preset;

    // Remove all mode classes
    document.body.classList.remove('mode-minimal', 'mode-minimal-plus');

    if (preset === 'minimal') {
      document.body.classList.add('mode-minimal');
      // Set all effect toggles to off for Minimal mode
      _settings.showWebGL = false;
      _settings.ambientMode = 'off';
      _settings.showBorders = false;
      _settings.showSentimentHalo = false;
      _settings.showCommentaryGlow = false;
      _settings.showRcAnimation = false;
      _settings.showMapGlow = false;
      _settings.showRedlineFlash = false;
      _settings.showBonkers = false;
      _settings.showK10Logo = false;
      _settings.showCarLogo = false;
      _settings.showGameLogo = false;
    } else if (preset === 'minimal-plus') {
      document.body.classList.add('mode-minimal-plus');
      // Racing-educated Tufte: data-reactive effects on, static decoration off
      _settings.showWebGL = true;  // but CSS reduces intensity to 60%
      _settings.ambientMode = 'off';
      _settings.showBorders = false;
      _settings.showSentimentHalo = true;  // but CSS reduces to 40% alpha
      _settings.showCommentaryGlow = false;
      _settings.showRcAnimation = true;    // flag animation settles after 4s
      _settings.showMapGlow = true;
      _settings.showRedlineFlash = true;
      _settings.showBonkers = false;
      _settings.showK10Logo = false;
      _settings.showCarLogo = true;  // contextual data for broadcast
      _settings.showGameLogo = false;
    } else {
      // Standard — restore defaults
      _settings.showWebGL = true;
      _settings.ambientMode = 'reflective';
      _settings.showBorders = true;
      _settings.showSentimentHalo = true;
      _settings.showCommentaryGlow = true;
      _settings.showRcAnimation = true;
      _settings.showMapGlow = true;
      _settings.showRedlineFlash = true;
      _settings.showBonkers = true;
      _settings.showK10Logo = true;
      _settings.showCarLogo = true;
      _settings.showGameLogo = true;
      // When switching back to standard, ensure mode classes are removed
      // so _collapseParentColumns() can properly restore column states
      document.body.classList.remove('mode-minimal', 'mode-minimal-plus');
    }

    // Sync UI toggles and save
    applySettings();
    saveSettings();
  }

  // ── Theme switching ──
  function updateTheme(value) {
    _settings.theme = value || 'dark';
    document.body.setAttribute('data-theme', _settings.theme);
    // Notify token loader to update (if loaded)
    if (window.tokenLoader && typeof window.tokenLoader.setTheme === 'function') {
      window.tokenLoader.setTheme(_settings.theme);
    }
    saveSettings();
  }

  // ── Commentary settings (authoritative copy in _settings; relayed to plugin) ──
  // The web app is the authoritative editor — values live in the overlay settings
  // file under `commentary*` keys. We relay every change to the SimHub plugin via
  // the same setSetting action it already consumes, so the plugin's
  // commentary-filter pipeline keeps working unchanged.
  function updateCommentarySetting(key, value) {
    var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=setSetting&key=' + encodeURIComponent(key) + '&value=' + encodeURIComponent(value);
    fetch(url).catch(function() {});
  }

  // Map from the prefixed OverlaySettings keys (the web UI edits these) to
  // the plugin-facing names the SimHub setSetting endpoint expects. When the
  // commentary keys change in settings, we POST each to the plugin.
  var _COMMENTARY_PLUGIN_MAP = {
    commentaryPromptDuration:   'promptDuration',
    commentaryShowTopicTitle:   'showTopicTitle',
    commentaryEventOnlyMode:    'eventOnlyMode',
    commentaryCatHardware:      'category_hardware',
    commentaryCatGameFeel:      'category_game_feel',
    commentaryCatCarResponse:   'category_car_response',
    commentaryCatRacingExperience: 'category_racing_experience',
    commentaryDriverFirstName:  'driverFirstName',
    commentaryDriverLastName:   'driverLastName',
    commentaryDemoMode:         'demoMode',
  };
  // Booleans get coerced to '1'/'0' to match the plugin's string parser.
  function _relayCommentaryToPlugin(settings) {
    if (!settings) return;
    Object.keys(_COMMENTARY_PLUGIN_MAP).forEach(function(localKey) {
      if (!(localKey in settings)) return;
      var pluginKey = _COMMENTARY_PLUGIN_MAP[localKey];
      var raw = settings[localKey];
      var val = (typeof raw === 'boolean') ? (raw ? '1' : '0') : String(raw);
      updateCommentarySetting(pluginKey, val);
    });
  }

  // ── Cross-window settings sync ──
  // When the other window changes settings, apply them here, and relay any
  // commentary keys to the SimHub plugin so its filtering stays in sync.
  if (window.k10 && window.k10.onSettingsSync) {
    window.k10.onSettingsSync(function(newSettings) {
      if (newSettings && typeof newSettings === 'object') {
        Object.assign(_settings, newSettings);
        applySettings();
        _relayCommentaryToPlugin(newSettings);
      }
    });
  }

  // On cold start we also need to push the current commentary values to the
  // plugin — otherwise a plugin restart would use stale values until the
  // user touched a setting. Fire after a short delay so SIMHUB_URL is ready.
  setTimeout(function() { _relayCommentaryToPlugin(_settings); }, 2000);

  // ═══════════════════════════════════════════════════════════════
