// Leaderboard renderer

  // ═══════════════════════════════════════════════════════════════
  //  LEADERBOARD RENDERER
  // ═══════════════════════════════════════════════════════════════

  // Sparkline history: keyed by driver name, stores last N lap times
  const _sparkHistory = {};
  const SPARK_MAX = 12;
  // Player position history for sparkline (seeded from grid position)
  const _posHistory = [];
  let _posHistorySeeded = false;
  // Use window-scoped cache key so settings.js can reliably reset it
  window._lbLastJson = '';

  function updateLeaderboard(p) {
    const lbPanel = document.getElementById('leaderboardPanel');
    if (!lbPanel || lbPanel.classList.contains('section-hidden')) return;
    // Leaderboard comes as raw JSON array from the plugin
    let raw = p['K10Motorsports.Plugin.Leaderboard'];
    // If plugin sends leaderboard as a JSON string, parse it
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch(e) { console.warn('[K10 LB] Failed to parse leaderboard string:', e); return; }
    }
    if (_pollFrame > 0 && _pollFrame <= 3) console.log('[K10 LB] raw type:', typeof raw, 'isArray:', Array.isArray(raw), 'length:', raw ? raw.length : 0, 'sample:', raw ? JSON.stringify(raw).slice(0, 200) : 'null');
    if (!raw || !Array.isArray(raw) || raw.length === 0) return;

    // Dedupe: skip render if data hasn't changed (+ settings version)
    const expandToFill = _settings.lbExpandToFill === true; // Ensure boolean with default false
    const settingsKey = (_settings.lbFocus || 'me') + '|' + (_settings.lbMaxRows || 5) + '|' + (expandToFill ? '1' : '0') + '|' + (window.innerHeight || 0);
    const json = JSON.stringify(raw) + '|' + settingsKey;
    if (json === window._lbLastJson) return;
    window._lbLastJson = json;

    const container = document.getElementById('lbRows');
    if (!container) return;

    // ── Focus + row limit logic ──
    const focusMode = _settings.lbFocus || 'me';
    let maxRows = _settings.lbMaxRows || 5;

    // Expand to fill: calculate max rows that fit on screen
    if (expandToFill) {
      const lbPanel = document.getElementById('leaderboardPanel');
      const sec = document.getElementById('secContainer');
      const zoom = parseFloat(sec ? sec.style.zoom : 1) || 1;
      const rowH = 22; // approximate row height in px (in panel coordinates)
      // Measure available height from the sec-container position
      // getBoundingClientRect() returns viewport pixels; divide by zoom to get panel-space pixels
      const vpH = window.innerHeight || 600;
      let availH;
      if (sec && sec.offsetHeight > 0) {
        const secRect = sec.getBoundingClientRect();
        const isTop = sec.classList.contains('sec-top');
        // Available height: from the container's edge toward the opposite viewport edge
        availH = isTop ? (vpH - secRect.top) / zoom : secRect.bottom / zoom;
        // Fallback if getBoundingClientRect returned 0 (not laid out yet)
        if (availH <= 0) {
          availH = vpH / zoom;
        }
      } else if (lbPanel && lbPanel.offsetHeight > 0) {
        // Fallback: use lbPanel's own height if available
        availH = lbPanel.offsetHeight / zoom;
      } else {
        // Last resort: use viewport height
        availH = vpH / zoom;
      }
      // Reserve space for lb-header, timeline strip, padding, and a safety margin
      const headerH = 36; // header + timeline + top/bottom padding
      const marginH = 16; // breathing room at the edge
      const calculatedMaxRows = Math.max(3, Math.min(raw.length, Math.floor((availH - headerH - marginH) / rowH)));
      // Warn if calculated maxRows is suspiciously small when expand-to-fill is enabled
      if (calculatedMaxRows < 6 && raw.length >= 6) {
        if (_pollFrame > 0 && _pollFrame % 20 === 0) {
          console.warn('[K10 LB] expand-to-fill calculated suspiciously small maxRows:', calculatedMaxRows, 'availH:', availH, 'lbPanel.offsetHeight:', lbPanel ? lbPanel.offsetHeight : 'N/A', 'sec.offsetHeight:', sec ? sec.offsetHeight : 'N/A');
        }
      }
      maxRows = calculatedMaxRows;
    }

    // Entry format: [pos, name, irating, bestLap, lastLap, gapToPlayer, inPit, isPlayer]
    // Find player index and session best
    let playerIdx = -1;
    let sessionBest = Infinity;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i][7]) playerIdx = i;
      const b = +raw[i][3];
      if (b > 0 && b < sessionBest) sessionBest = b;
    }
    if (sessionBest === Infinity) sessionBest = 0;
    // Expose session best for other modules (best lap coloring)
    window._sessionBestLap = sessionBest;

    // Slice visible entries based on focus mode
    let visible;
    if (focusMode === 'lead') {
      // Show from P1, up to maxRows
      visible = raw.slice(0, maxRows);
    } else {
      // Center on player
      if (playerIdx < 0) {
        visible = raw.slice(0, maxRows);
      } else {
        const half = Math.floor(maxRows / 2);
        let start = Math.max(0, playerIdx - half);
        let end = start + maxRows;
        if (end > raw.length) { end = raw.length; start = Math.max(0, end - maxRows); }
        visible = raw.slice(start, end);
      }
    }

    let html = '';
    for (const entry of visible) {
      const [pos, name, ir, best, last, gap, pit, isPlayer] = entry;
      const classes = ['lb-row'];
      if (isPlayer) {
        classes.push('lb-player');
        if (pos === 1) classes.push('lb-p1');
        else if (_startPosition > 0 && pos < _startPosition) classes.push('lb-ahead');
        else if (_startPosition > 0 && pos > _startPosition) classes.push('lb-behind');
        else classes.push('lb-same');
      }
      // Mark the starting position row when player has moved away from it
      if (!isPlayer && _startPosition > 0 && pos === _startPosition && _lastPosition !== _startPosition) {
        classes.push('lb-start-pos');
      }
      if (pit) classes.push('lb-pit');

      // Gap display
      let gapStr = '', gapClass = 'gap-player';
      if (isPlayer) {
        gapStr = '';
      } else if (gap < 0) {
        gapStr = '-' + Math.abs(gap).toFixed(1) + 's';
        gapClass = 'gap-ahead';
      } else if (gap > 0) {
        gapStr = '+' + gap.toFixed(1) + 's';
        gapClass = 'gap-behind';
      } else {
        gapStr = '';
      }

      // iRating shorthand
      const irStr = ir > 0 ? (ir >= 1000 ? (ir / 1000).toFixed(1) + 'k' : '' + ir) : '';

      // ── Sparkline data collection ──
      // Non-player: track lap times. Player: track position (seeded from grid).
      if (isPlayer) {
        // Seed position history with grid position on first sight
        if (!_posHistorySeeded && _startPosition > 0) {
          _posHistory.push(_startPosition);
          _posHistorySeeded = true;
        }
        // Record current position (dedupe consecutive same-position entries)
        if (pos > 0 && (_posHistory.length === 0 || _posHistory[_posHistory.length - 1] !== pos)) {
          _posHistory.push(pos);
          if (_posHistory.length > SPARK_MAX) _posHistory.shift();
        }
      } else {
        // Non-player: track lap times as before
        const lastNum = +last;
        if (lastNum > 0) {
          if (!_sparkHistory[name]) _sparkHistory[name] = [];
          const h = _sparkHistory[name];
          if (h.length === 0 || h[h.length - 1] !== lastNum) {
            h.push(lastNum);
            if (h.length > SPARK_MAX) h.shift();
          }
        }
      }

      // ── Build sparkline SVG ──
      let sparkSvg = '';

      if (isPlayer && _posHistory.length >= 2) {
        // Player: position sparkline (lower = better → invert Y axis)
        const mn = Math.min(..._posHistory), mx = Math.max(..._posHistory);
        const range = mx - mn || 1;
        const w = 44, h2 = 14;
        let pts = '';
        for (let i = 0; i < _posHistory.length; i++) {
          const x = (i / (_posHistory.length - 1)) * w;
          // Invert: P1 at top (y=0), higher positions at bottom
          const y = ((_posHistory[i] - mn) / range) * h2;
          if (i === 0) {
            pts += x.toFixed(1) + ',' + y.toFixed(1);
          } else {
            const prevY = ((_posHistory[i - 1] - mn) / range) * h2;
            pts += ' ' + x.toFixed(1) + ',' + prevY.toFixed(1);
            pts += ' ' + x.toFixed(1) + ',' + y.toFixed(1);
          }
        }
        const lastY = ((_posHistory[_posHistory.length - 1] - mn) / range) * h2;
        let col;
        if (pos === 1) col = 'hsla(42,80%,55%,1)';
        else if (_startPosition > 0 && pos < _startPosition) col = 'hsla(145,75%,50%,1)';
        else if (_startPosition > 0 && pos > _startPosition) col = 'hsla(0,75%,50%,1)';
        else col = 'hsla(210,75%,55%,1)';
        sparkSvg = '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h2 + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + (w).toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="1.5" fill="' + col + '"/></svg>';
      } else if (isPlayer && _posHistory.length < 2) {
        // Player waiting for data: flat baseline
        const w = 44, h2 = 14;
        const midY = (h2 / 2).toFixed(1);
        sparkSvg = '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h2 + '" preserveAspectRatio="none">'
          + '<line x1="0" y1="' + midY + '" x2="' + w + '" y2="' + midY + '" stroke="hsla(210,75%,55%,0.5)" stroke-width="1" stroke-dasharray="3,2"/>'
          + '</svg>';
      } else {
        // Non-player: lap-time sparkline
        const hist = _sparkHistory[name] ? _sparkHistory[name].filter(v => v > 0) : null;
        if ((!hist || hist.length < 2) && window._isRollingStart) {
          const w = 44, h2 = 14;
          const midY = (h2 / 2).toFixed(1);
          sparkSvg = '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h2 + '" preserveAspectRatio="none">'
            + '<line x1="0" y1="' + midY + '" x2="' + w + '" y2="' + midY + '" stroke="hsla(0,0%,100%,0.15)" stroke-width="1" stroke-dasharray="3,2"/>'
            + '</svg>';
        } else if (hist && hist.length >= 2) {
          const mn = Math.min(...hist), mx = Math.max(...hist);
          const range = mx - mn || 1;
          const w = 44, h2 = 14;
          let pts = '';
          for (let i = 0; i < hist.length; i++) {
            const x = (i / (hist.length - 1)) * w;
            const y = ((hist[i] - mn) / range) * h2;
            if (i === 0) {
              pts += x.toFixed(1) + ',' + y.toFixed(1);
            } else {
              const prevY = ((hist[i - 1] - mn) / range) * h2;
              pts += ' ' + x.toFixed(1) + ',' + prevY.toFixed(1);
              pts += ' ' + x.toFixed(1) + ',' + y.toFixed(1);
            }
          }
          const lastY = ((hist[hist.length - 1] - mn) / range) * h2;
          sparkSvg = '<svg class="lb-spark" viewBox="0 0 ' + w + ' ' + h2 + '" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="hsla(0,0%,100%,0.3)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + (w).toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="1.5" fill="hsla(0,0%,100%,0.3)"/></svg>';
        }
      }

      // Lap time display with color coding
      // Purple: session best (one only), Green: driver personal best, Yellow: off-pace
      let lapStr = '', lapClass = '';
      if (last > 0) {
        const m = Math.floor(last / 60), s = last - m * 60;
        lapStr = m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
        if (sessionBest > 0 && Math.abs(last - sessionBest) < 0.05) {
          lapClass = 'lap-pb';                             // session best lap
        } else if (best > 0 && Math.abs(last - best) < 0.05) {
          lapClass = 'lap-fast';                           // driver personal best
        } else {
          lapClass = 'lap-slow';                           // off-pace
        }
      }

      html += '<div class="' + classes.join(' ') + '">'
        + '<div class="lb-pos">' + pos + '</div>'
        + '<div class="lb-name">' + escHtml(isPlayer ? _driverDisplayName : name) + '</div>'
        + '<div class="lb-lap ' + lapClass + '">' + lapStr + '</div>'
        + '<div class="lb-ir">' + irStr + '</div>'
        + '<div class="lb-gap ' + gapClass + '">' + gapStr + '</div>'
        + sparkSvg
        + '</div>';
    }
    container.innerHTML = html;
    // Update WebGL highlight position after DOM update
    requestAnimationFrame(function() {
      if (window.updateLBPlayerPos) window.updateLBPlayerPos();
    });
  }

  function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
