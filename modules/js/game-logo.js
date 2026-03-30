// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Game Logo Overlay
// Shows the current game's logo (iRacing, LMU, etc.) in the
// corner opposite the main dashboard layout position.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  var _logoEl = null;
  var _currentSvg = '';
  var _currentGameId = '';
  var _visible = false;

  // Map game IDs to SVG filenames
  var GAME_LOGO_FILES = {
    'iracing': 'iracing.svg',
    'lmu':     'le-mans-ultimate.svg'
  };

  // Logo-corner mapping: dashboard position → logo position
  // Logo goes on the same vertical edge as the dashboard but on the
  // opposite horizontal side — keeps it aligned with main modules.
  var OPPOSITE_CORNER = {
    'top-right':       'top-left',
    'top-left':        'top-right',
    'bottom-right':    'bottom-left',
    'bottom-left':     'bottom-right',
    'absolute-center': 'bottom-left'
  };

  // CSS class map for positioning
  var POS_STYLES = {
    'top-left':     'top:10px;left:10px;',
    'top-right':    'top:10px;right:10px;',
    'bottom-left':  'bottom:10px;left:10px;',
    'bottom-right': 'bottom:10px;right:10px;'
  };

  function createLogoElement() {
    if (_logoEl) return;
    _logoEl = document.createElement('div');
    _logoEl.id = 'gameLogoOverlay';
    _logoEl.style.cssText =
      'position:fixed;z-index:50;width:250px;pointer-events:none;' +
      'opacity:0;transition:opacity 0.4s ease;' +
      'display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(_logoEl);
  }

  function updatePosition() {
    if (!_logoEl) return;
    var layoutPos = (window._settings && window._settings.layoutPosition) || 'top-right';
    var logoPos = OPPOSITE_CORNER[layoutPos] || 'bottom-left';
    var style = POS_STYLES[logoPos] || POS_STYLES['bottom-left'];
    // Reset all positioning
    _logoEl.style.top = '';
    _logoEl.style.right = '';
    _logoEl.style.bottom = '';
    _logoEl.style.left = '';
    // Apply new position
    var parts = style.split(';').filter(Boolean);
    parts.forEach(function(p) {
      var kv = p.split(':');
      if (kv.length === 2) _logoEl.style[kv[0].trim()] = kv[1].trim();
    });
  }

  function loadSvg(gameId) {
    var file = GAME_LOGO_FILES[gameId];
    if (!file) {
      // No logo for this game
      if (_logoEl) _logoEl.style.opacity = '0';
      _currentGameId = gameId;
      _currentSvg = '';
      return;
    }
    if (gameId === _currentGameId && _currentSvg) {
      // Already loaded
      if (_visible && _logoEl) _logoEl.style.opacity = '0.5';
      return;
    }
    _currentGameId = gameId;

    // Resolve path — works from both file:// and http://
    var basePath = '';
    if (window._simhubUrlOverride) {
      // Remote mode: assets served from root
      basePath = '/';
    }
    var url = basePath + 'images/logos/' + file;

    fetch(url)
      .then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(svg) {
        if (!svg || gameId !== _currentGameId) return;
        _currentSvg = svg;
        if (_logoEl) {
          _logoEl.innerHTML = svg;
          // Style the SVG element
          var svgEl = _logoEl.querySelector('svg');
          if (svgEl) {
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            svgEl.style.maxHeight = '80px';
          }
          if (_visible) _logoEl.style.opacity = '0.5';
        }
      })
      .catch(function() { /* non-critical */ });
  }

  /**
   * Called from poll-engine on each telemetry tick.
   * @param {string} gameId — current game ID (e.g. 'iracing', 'lmu')
   * @param {boolean} show — whether the setting is enabled
   */
  window.updateGameLogo = function(gameId, show) {
    createLogoElement();
    _visible = show;

    if (!show || !gameId || !GAME_LOGO_FILES[gameId]) {
      if (_logoEl) _logoEl.style.opacity = '0';
      return;
    }

    updatePosition();
    loadSvg(gameId);
  };

  // Re-position when layout changes
  var _origApplyLayout = window.applyLayout;
  if (typeof _origApplyLayout === 'function') {
    window.applyLayout = function() {
      _origApplyLayout.apply(this, arguments);
      updatePosition();
    };
  }
  // Also listen for settings changes
  window.addEventListener('k10-layout-changed', updatePosition);
})();
