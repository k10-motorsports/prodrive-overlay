// ═══════════════════════════════════════════════════════════════
//  DRIVER PROFILE — Broadcast-ready ratings overlay.
//  Ctrl+Shift+V to toggle.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  let _profileOpen = false;
  let _carSessions = {};

  const overlay = document.getElementById('driverProfileOverlay');

  // ── Toggle ──
  function toggleDriverProfile() {
    if (!overlay) return;
    _profileOpen = !_profileOpen;
    overlay.classList.toggle('open', _profileOpen);
    if (_profileOpen) {
      _refresh();
      if (window.k10 && window.k10.requestInteractive) window.k10.requestInteractive();
    } else {
      if (window.k10 && window.k10.releaseInteractive) window.k10.releaseInteractive();
    }
  }
  window.toggleDriverProfile = toggleDriverProfile;

  function _refresh() {
    _showRatings();
    _showAssessment();
    _drawIRChart();
    _drawSRChart();
    _renderHeatmap();
  }

  function _licColor(lic) {
    var c = { R:'hsl(0,65%,55%)', D:'hsl(24,85%,58%)', C:'hsl(48,80%,58%)', B:'hsl(130,55%,52%)', A:'hsl(210,70%,60%)', P:'hsl(270,60%,58%)' };
    return c[lic] || 'hsla(0,0%,100%,0.5)';
  }

  // ── Ratings display with live deltas ──
  function _showRatings() {
    var ir = window._manualIRating || 0;
    var sr = window._manualSafetyRating || 0;
    var lic = window._manualLicense || '';

    var irEl = document.getElementById('dpIRating');
    var srEl = document.getElementById('dpSR');
    var licEl = document.getElementById('dpLicense');
    if (irEl) irEl.textContent = ir > 0 ? Math.round(ir).toLocaleString() : '—';
    if (srEl) srEl.textContent = sr > 0 ? sr.toFixed(2) : '—';
    if (licEl) {
      var labels = { R:'Rookie', D:'D', C:'C', B:'B', A:'A', P:'Pro' };
      licEl.textContent = labels[lic] || '—';
      licEl.style.color = _licColor(lic);
    }
    // Inline iR bar
    var dpIRBar = document.getElementById('dpIRBarFill');
    if (dpIRBar) dpIRBar.style.width = Math.min(100, (ir / 5000) * 100) + '%';
    // Inline SR pie
    var dpSRPie = document.getElementById('dpSRPieFill');
    if (dpSRPie) {
      var circ = 2 * Math.PI * 15;
      dpSRPie.setAttribute('stroke-dashoffset', String(circ * (1 - Math.min(1, sr / 4.0))));
      dpSRPie.setAttribute('stroke', sr >= 3.0 ? 'var(--green)' : sr >= 2.0 ? 'var(--amber)' : 'var(--red)');
    }

    // Show estimated deltas from current race (pulled from poll engine)
    var irDeltaEl = document.getElementById('dpIRDelta');
    var srDeltaEl = document.getElementById('dpSRDelta');
    // Read the live estimated delta that poll-engine computes
    var irDelta = window._lastIRDelta || 0;
    if (irDeltaEl) {
      if (irDelta !== 0) {
        irDeltaEl.textContent = (irDelta > 0 ? '+' : '') + irDelta;
        irDeltaEl.className = 'dp-rating-delta ' + (irDelta > 0 ? 'positive' : 'negative');
      } else { irDeltaEl.textContent = ''; irDeltaEl.className = 'dp-rating-delta'; }
    }
    // SR change estimate from last history entry
    if (srDeltaEl) {
      var history = [];
      try { history = (JSON.parse(localStorage.getItem('k10-rating-data') || '{}')).history || []; } catch(e) {}
      if (history.length >= 2) {
        var last = history[history.length - 1];
        var prev = history[history.length - 2];
        var d = last.safetyRating - prev.safetyRating;
        if (d !== 0) {
          srDeltaEl.textContent = (d > 0 ? '+' : '') + d.toFixed(2);
          srDeltaEl.className = 'dp-rating-delta ' + (d > 0 ? 'positive' : 'negative');
        } else { srDeltaEl.textContent = ''; srDeltaEl.className = 'dp-rating-delta'; }
      } else { srDeltaEl.textContent = ''; }
    }
  }

  // ── 3-column broadcast assessment — short, punchy ──
  function _showAssessment() {
    var ir = window._manualIRating || 0;
    var sr = window._manualSafetyRating || 0;
    var lic = window._manualLicense || '';

    var irCol = document.getElementById('dpAssessIR');
    var srCol = document.getElementById('dpAssessSR');
    var licCol = document.getElementById('dpAssessLic');
    if (!irCol || !srCol || !licCol) return;

    if (!ir && !sr && !lic) {
      irCol.innerHTML = '<strong>iRating</strong><br>Not set';
      srCol.innerHTML = '<strong>Safety</strong><br>Not set';
      licCol.innerHTML = '<strong>License</strong><br>Not set';
      return;
    }

    // iRating column
    var irText = '';
    if (ir < 1000) irText = 'Learning the fundamentals. Building pace and consistency.';
    else if (ir < 1500) irText = 'Lower mid-field. Clean racer developing raw speed.';
    else if (ir < 2000) irText = 'Mid-field. Understands strategy, refining corner speed.';
    else if (ir < 2500) irText = 'Upper mid-field. Competitive in most splits.';
    else if (ir < 3500) irText = 'Strong driver. Top-split regular with mature racecraft.';
    else if (ir < 5000) irText = 'Elite. Competes with the fastest sim racers worldwide.';
    else irText = 'World-class. Pro-level pace and consistency.';
    irCol.innerHTML = '<strong>iRating ' + Math.round(ir).toLocaleString() + '</strong><br>' + irText;

    // SR column
    var srText = '';
    if (sr < 1.0) srText = 'Frequent incidents. Focus on survival before pace.';
    else if (sr < 2.0) srText = 'Developing awareness. Patience will close the gap.';
    else if (sr < 3.0) srText = 'Clean racer. Recovers well from mistakes.';
    else if (sr < 4.0) srText = 'Rarely makes contact. Trusted on track.';
    else srText = 'Near-perfect discipline. Incident-free consistency.';
    srCol.innerHTML = '<strong>SR ' + sr.toFixed(2) + '</strong><br>' + srText;

    // License column
    var licLabels = { R:'Rookie', D:'Class D', C:'Class C', B:'Class B', A:'Class A', P:'Pro' };
    var licText = '';
    if (lic === 'R') licText = 'Building the foundation. Every clean race matters.';
    else if (lic === 'D') licText = 'Past the learning curve. Real race awareness developing.';
    else if (lic === 'C') licText = 'Serious content unlocked. Rules of engagement expected.';
    else if (lic === 'B') licText = 'Trusted in endurance and multi-class events.';
    else if (lic === 'A') licText = 'Access to the most demanding series. Few reach this.';
    else if (lic === 'P') licText = 'Elite tier. Pro-series and World Championship eligible.';
    else licText = '';
    licCol.innerHTML = '<strong style="color:' + _licColor(lic) + '">' + (licLabels[lic] || '—') + '</strong><br>' + licText;
  }

  // ── iRating chart ──
  function _drawIRChart() {
    var canvas = document.getElementById('dpIRChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    var history = [];
    try { history = (JSON.parse(localStorage.getItem('k10-rating-data') || '{}')).history || []; } catch(e) {}
    history = history.filter(function(e) { return e.iRating > 0; });

    if (history.length < 2) {
      ctx.fillStyle = 'hsla(0,0%,100%,0.2)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('iRating history builds as you save updates', w/2, h/2);
      return;
    }

    var vals = history.map(function(e) { return e.iRating; });
    var mn = Math.min.apply(null, vals) - 50, mx = Math.max.apply(null, vals) + 50;
    var range = mx - mn || 1, pad = 10;

    ctx.strokeStyle = 'hsla(0,0%,100%,0.06)'; ctx.lineWidth = 0.5;
    for (var i = 0; i <= 4; i++) { var y = pad + (h - pad*2) * (i/4); ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); }

    ctx.beginPath();
    for (var i = 0; i < vals.length; i++) {
      var x = pad + (i/(vals.length-1)) * (w-pad*2);
      var y = pad + (1 - (vals[i]-mn)/range) * (h-pad*2);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = 'hsl(260,60%,55%)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(pad+(w-pad*2), h-pad); ctx.lineTo(pad, h-pad); ctx.closePath();
    var grad = ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,'hsla(260,60%,55%,0.15)'); grad.addColorStop(1,'hsla(260,60%,55%,0.0)');
    ctx.fillStyle = grad; ctx.fill();

    ctx.fillStyle = 'hsla(0,0%,100%,0.6)'; ctx.font = 'bold 12px "JetBrains Mono",monospace'; ctx.textAlign = 'right';
    ctx.fillText('iR ' + Math.round(vals[vals.length-1]).toLocaleString(), w-pad, pad+14);
  }

  // ── SR chart ──
  function _drawSRChart() {
    var canvas = document.getElementById('dpSRChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    var history = [];
    try { history = (JSON.parse(localStorage.getItem('k10-rating-data') || '{}')).history || []; } catch(e) {}
    history = history.filter(function(e) { return e.safetyRating > 0; });

    if (history.length < 2) {
      ctx.fillStyle = 'hsla(0,0%,100%,0.2)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Safety Rating history builds as you save updates', w/2, h/2);
      return;
    }

    var vals = history.map(function(e) { return e.safetyRating; });
    var pad = 10;
    var licColors = ['hsl(24,85%,48%)', 'hsl(48,80%,48%)', 'hsl(130,55%,42%)', 'hsl(210,70%,50%)'];
    ctx.strokeStyle = 'hsla(0,0%,100%,0.06)'; ctx.lineWidth = 0.5;
    for (var i = 1; i <= 4; i++) {
      var y = pad + (1-i/4.99)*(h-pad*2);
      ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
      ctx.fillStyle = licColors[i-1]; ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.3;
      ctx.fillText(i+'.00', pad+2, y-2); ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    for (var i = 0; i < vals.length; i++) {
      var x = pad + (i/(vals.length-1))*(w-pad*2);
      var y = pad + (1-vals[i]/4.99)*(h-pad*2);
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = 'hsl(145,60%,50%)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();

    ctx.fillStyle = 'hsla(0,0%,100%,0.6)'; ctx.font = 'bold 12px "JetBrains Mono",monospace'; ctx.textAlign = 'right';
    ctx.fillText('SR ' + vals[vals.length-1].toFixed(2), w-pad, pad+14);
  }

  // ── Car heatmap ──
  function _renderHeatmap() {
    var el = document.getElementById('dpCarHeatmap');
    if (!el) return;
    if (Object.keys(_carSessions).length === 0) {
      el.innerHTML = '<div style="color:hsla(0,0%,100%,0.25);padding:12px;text-align:center;">No car data yet</div>';
      return;
    }
    var sorted = Object.entries(_carSessions).sort(function(a,b) { return b[1]-a[1]; });
    var maxCount = sorted[0][1] || 1;
    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var car = sorted[i][0], count = sorted[i][1];
      var mfr = (typeof detectMfr === 'function') ? detectMfr(car) : 'generic';
      var brandColor = (typeof _mfrBrandColors !== 'undefined' && _mfrBrandColors[mfr]) ? _mfrBrandColors[mfr] : 'hsla(0,0%,100%,0.1)';
      var intensity = 0.15 + (count/maxCount) * 0.6;
      html += '<div class="dp-hm-cell" style="background:' + brandColor.replace(/[\d.]+\)$/, intensity.toFixed(2)+')') + '">'
        + '<span class="dp-hm-count">' + count + '</span>'
        + '<span class="dp-hm-name">' + car.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span></div>';
    }
    el.innerHTML = html;
  }

  // ── Record car session (called by poll engine) ──
  function recordCarSession(carModel) {
    if (!carModel) return;
    _carSessions[carModel] = (_carSessions[carModel] || 0) + 1;
    _saveProfile();
  }
  window.recordCarSession = recordCarSession;

  function _saveProfile() {
    var data = { carSessions: _carSessions };
    if (window.k10 && window.k10.saveProfileData) window.k10.saveProfileData(data);
    try { localStorage.setItem('k10-driver-profile', JSON.stringify(data)); } catch(e) {}
  }

  // ── Init ──
  async function initDriverProfile() {
    var data = null;
    if (window.k10 && window.k10.getProfileData) {
      try { data = await window.k10.getProfileData(); } catch(e) {}
    }
    if (!data) { try { data = JSON.parse(localStorage.getItem('k10-driver-profile') || 'null'); } catch(e) {} }
    if (data && data.carSessions) _carSessions = data.carSessions;
    if (window.k10 && window.k10.onToggleDriverProfile) window.k10.onToggleDriverProfile(toggleDriverProfile);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDriverProfile);
  else initDriverProfile();
})();
