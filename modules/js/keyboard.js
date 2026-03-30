// Global keyboard shortcuts — dispatched via Electron globalShortcut → IPC

  // ═══ Ctrl+Shift+D — restart demo ═══
  if (window.k10 && window.k10.onRestartDemo) {
    window.k10.onRestartDemo(function() {
      var baseUrl = window._simhubUrlOverride || SIMHUB_URL;
      var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
      fetch(baseUrl + sep + 'action=restartdemo')
        .then(function(r) { if (r.ok) console.log('[K10] Demo restarted'); else console.warn('[K10] Demo restart failed:', r.status); })
        .catch(function(err) { console.warn('[K10] Demo restart error:', err); });
    });
  }

  // ═══ Ctrl+Shift+M — reset track map ═══
  if (window.k10 && window.k10.onResetTrackmap) {
    window.k10.onResetTrackmap(function() {
      if (typeof resetTrackMap === 'function') resetTrackMap();
    });
  }
