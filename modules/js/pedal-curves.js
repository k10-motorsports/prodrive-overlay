// ═══════════════════════════════════════════════════════════════
// PEDAL CURVE VISUALIZATION
// Renders throttle/brake/clutch response curves from the active
// pedal profile onto the full pedal histogram area.
// Curve-following dots show current pedal position on each curve.
// Data flows from C# PedalProfileManager via HTTP bridge
// as K10Motorsports.Plugin.DS.PedalProfile (JSON object).
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var _curveCanvas = null;
  var _curveCtx = null;
  var _profileLabel = null;
  var _lastProfileJson = '';
  var _currentProfile = null;
  var _hasProfile = false;

  // Colors matching the existing pedal histogram
  var THROTTLE_COLOR = '#4CAF50';
  var BRAKE_COLOR    = '#F44336';
  var CLUTCH_COLOR   = '#42A5F5';
  var GRID_COLOR     = 'rgba(255, 255, 255, 0.06)';
  var DIAG_COLOR     = 'rgba(255, 255, 255, 0.04)';

  // ── Init ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    _curveCanvas = document.getElementById('pedalCurveCanvas');
    _profileLabel = document.getElementById('pedalProfileLabel');
    if (_curveCanvas) {
      _curveCtx = _curveCanvas.getContext('2d');
      _resizeCurveCanvas();
    }
  });

  function _resizeCurveCanvas() {
    if (!_curveCanvas || !_curveCtx) return;
    var rect = _curveCanvas.getBoundingClientRect();
    var w = Math.round(rect.width) || 240;
    var h = Math.round(rect.height) || 80;
    if (_curveCanvas.width !== w || _curveCanvas.height !== h) {
      _curveCanvas.width = w;
      _curveCanvas.height = h;
    }
  }

  // ── Called each poll frame from poll-engine.js ────────────────
  // p = full poll data object
  window.updatePedalCurves = function (p) {
    if (!_curveCtx) return;

    var pre = p._demo ? 'K10Motorsports.Plugin.Demo.DS.' : 'K10Motorsports.Plugin.DS.';
    var profileData = p[pre + 'PedalProfile'] || p['K10Motorsports.Plugin.DS.PedalProfile'];
    if (!profileData || typeof profileData !== 'object') {
      // No profile data — hide canvases
      _setProfileVisibility(false);
      return;
    }

    // Check if there are actual curves (not just an empty stub)
    var hasCurves = (profileData.throttleCurve && profileData.throttleCurve.length >= 2)
                 || (profileData.brakeCurve && profileData.brakeCurve.length >= 2);
    if (!hasCurves) {
      _setProfileVisibility(false);
      return;
    }

    _setProfileVisibility(true);

    // Only re-render static curves when the profile data changes
    var json = JSON.stringify(profileData);
    if (json === _lastProfileJson) return;
    _lastProfileJson = json;
    _currentProfile = profileData;

    // Update label
    if (_profileLabel) {
      var name = profileData.profileName || '';
      var source = profileData.source || '';
      if (source === 'moza') name = '⚡ ' + name;
      _profileLabel.textContent = name;
      _profileLabel.title = profileData.carName || '';
    }

    _resizeCurveCanvas();
    renderCurves();
  };

  function _setProfileVisibility(visible) {
    if (visible === _hasProfile) return;
    _hasProfile = visible;
    var curveEl = document.getElementById('pedalCurveCanvas');
    var traceEl = document.getElementById('pedalTraceCanvas');
    if (curveEl) curveEl.classList.toggle('no-profile', !visible);
    if (traceEl) traceEl.classList.toggle('no-profile', !visible);
    if (!visible) {
      _currentProfile = null;
      _lastProfileJson = '';
      if (_profileLabel) _profileLabel.textContent = '';
    }
  }

  // ── Render static curves ────────────────────────────────────
  function renderCurves() {
    if (!_curveCtx || !_currentProfile) return;

    var ctx = _curveCtx;
    var w = _curveCanvas.width;
    var h = _curveCanvas.height;
    var pad = 2;
    var plotW = w - pad * 2;
    var plotH = h - pad * 2;

    ctx.clearRect(0, 0, w, h);

    // ── Background grid ──────────────────────────────────────
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (var i = 1; i <= 3; i++) {
      var gx = pad + (i / 4) * plotW;
      var gy = pad + (1 - i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(gx, pad); ctx.lineTo(gx, pad + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, gy); ctx.lineTo(pad + plotW, gy);
      ctx.stroke();
    }

    // Diagonal reference (linear 1:1)
    ctx.strokeStyle = DIAG_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, pad + plotH);
    ctx.lineTo(pad + plotW, pad);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Draw each curve ──────────────────────────────────────
    // Throttle: left-to-right (matches throttle histogram direction)
    // Brake: RIGHT-to-LEFT (matches brake histogram flex-direction: row-reverse)
    // Clutch: left-to-right
    var throttleCurve = _currentProfile.throttleCurve;
    var brakeCurve = _currentProfile.brakeCurve;
    var clutchCurve = _currentProfile.clutchCurve;

    if (clutchCurve && clutchCurve.length >= 2) {
      drawCurve(ctx, clutchCurve, CLUTCH_COLOR, 0.35, pad, plotW, plotH, false);
    }
    if (brakeCurve && brakeCurve.length >= 2) {
      drawCurve(ctx, brakeCurve, BRAKE_COLOR, 0.7, pad, plotW, plotH, true);
    }
    if (throttleCurve && throttleCurve.length >= 2) {
      drawCurve(ctx, throttleCurve, THROTTLE_COLOR, 0.85, pad, plotW, plotH, false);
    }

    // ── Deadzone indicators ──────────────────────────────────
    var thrDz = _currentProfile.throttleDeadzone || 0;
    var brkDz = _currentProfile.brakeDeadzone || 0;

    if (thrDz > 0.01) {
      var dzX = pad + thrDz * plotW;
      ctx.strokeStyle = THROTTLE_COLOR;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(dzX, pad); ctx.lineTo(dzX, pad + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (brkDz > 0.01) {
      // Brake deadzone: mirrored (from right edge inward)
      var dzX2 = pad + plotW - brkDz * plotW;
      ctx.strokeStyle = BRAKE_COLOR;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(dzX2, pad); ctx.lineTo(dzX2, pad + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Draw a response curve.
   * @param {boolean} mirror - If true, X axis is mirrored (right-to-left) to match brake histogram.
   */
  function drawCurve(ctx, points, color, alpha, pad, plotW, plotH, mirror) {
    if (!points || points.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (var i = 0; i < points.length; i++) {
      var rawX = points[i][0];
      var px = mirror
        ? pad + (1 - rawX) * plotW   // right-to-left for brake
        : pad + rawX * plotW;         // left-to-right for throttle/clutch
      var py = pad + (1 - points[i][1]) * plotH; // Y is inverted (0 at bottom)
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Curve-following dot positions ───────────────────────────
  // Called from webgl-helpers _flushPedalFrame to place dots on curves
  // thr/brk/clt = 0..1 (raw pedal input, not output)
  window.getCurvePositions = function (thr, brk, clt) {
    if (!_currentProfile || !_hasProfile || !_curveCanvas) return null;

    var w = _curveCanvas.width;
    var h = _curveCanvas.height;
    var pad = 2;
    var plotW = w - pad * 2;
    var plotH = h - pad * 2;

    var result = [];

    // Throttle dot
    var thrCurve = _currentProfile.throttleCurve;
    if (thrCurve && thrCurve.length >= 2 && thr > 0.01) {
      var out = interpolateCurve(thrCurve, thr);
      result.push({
        x: pad + thr * plotW,
        y: pad + (1 - out) * plotH,
        color: THROTTLE_COLOR,
        rgb: [76, 175, 80],
        val: thr
      });
    }

    // Brake dot (mirrored X)
    var brkCurve = _currentProfile.brakeCurve;
    if (brkCurve && brkCurve.length >= 2 && brk > 0.01) {
      var bOut = interpolateCurve(brkCurve, brk);
      result.push({
        x: pad + (1 - brk) * plotW,   // mirrored
        y: pad + (1 - bOut) * plotH,
        color: BRAKE_COLOR,
        rgb: [244, 67, 54],
        val: brk
      });
    }

    // Clutch dot
    var cltCurve = _currentProfile.clutchCurve;
    if (cltCurve && cltCurve.length >= 2 && clt > 0.01) {
      var cOut = interpolateCurve(cltCurve, clt);
      result.push({
        x: pad + clt * plotW,
        y: pad + (1 - cOut) * plotH,
        color: CLUTCH_COLOR,
        rgb: [66, 165, 245],
        val: clt
      });
    }

    return result;
  };

  /**
   * Interpolate a value along a curve's control points.
   * points = [[x0,y0], [x1,y1], ...] sorted by x.
   */
  function interpolateCurve(points, input) {
    if (input <= points[0][0]) return points[0][1];
    if (input >= points[points.length - 1][0]) return points[points.length - 1][1];
    for (var i = 1; i < points.length; i++) {
      if (input <= points[i][0]) {
        var t = (input - points[i-1][0]) / (points[i][0] - points[i-1][0]);
        return points[i-1][1] + t * (points[i][1] - points[i-1][1]);
      }
    }
    return points[points.length - 1][1];
  }

  // ── Expose for settings panel ────────────────────────────────
  window.getCurrentPedalProfile = function () {
    return _currentProfile;
  };
  window.hasPedalProfile = function () {
    return _hasProfile;
  };
})();

// ═══════════════════════════════════════════════════════════════
// PEDAL SETTINGS PANEL — profile management + curve preview
// ═══════════════════════════════════════════════════════════════

var _pedalSettingsCanvas = null;
var _pedalSettingsCtx = null;
var _pedalProfilesLoaded = false;

function _initPedalSettingsCanvas() {
  if (_pedalSettingsCanvas) return;
  _pedalSettingsCanvas = document.getElementById('pedalSettingsCurveCanvas');
  if (!_pedalSettingsCanvas) return;
  _pedalSettingsCtx = _pedalSettingsCanvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var w = _pedalSettingsCanvas.offsetWidth || 200;
  var h = _pedalSettingsCanvas.offsetHeight || 200;
  _pedalSettingsCanvas.width = w * dpr;
  _pedalSettingsCanvas.height = h * dpr;
  _pedalSettingsCtx.scale(dpr, dpr);
  _pedalSettingsCanvas.style.width = w + 'px';
  _pedalSettingsCanvas.style.height = h + 'px';
}

function renderPedalSettingsCurve() {
  _initPedalSettingsCanvas();
  var profile = window.getCurrentPedalProfile ? window.getCurrentPedalProfile() : null;
  if (!profile || !_pedalSettingsCtx) return;

  var ctx = _pedalSettingsCtx;
  var w = _pedalSettingsCanvas.offsetWidth || 200;
  var h = _pedalSettingsCanvas.offsetHeight || 200;
  var pad = 20;
  var plotW = w - pad * 2;
  var plotH = h - pad * 2;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 0.5;
  for (var i = 0; i <= 4; i++) {
    var gx = pad + (i / 4) * plotW;
    var gy = pad + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, pad + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(pad + plotW, gy); ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('0%', pad, h - 4);
  ctx.fillText('50%', pad + plotW / 2, h - 4);
  ctx.fillText('100%', pad + plotW, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText('0%', pad - 4, pad + plotH);
  ctx.fillText('100%', pad - 4, pad + 3);

  // Diagonal reference
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, pad + plotH);
  ctx.lineTo(pad + plotW, pad);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw curves
  function drawSettingsCurve(points, color) {
    if (!points || points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var j = 0; j < points.length; j++) {
      var px = pad + points[j][0] * plotW;
      var py = pad + (1 - points[j][1]) * plotH;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  drawSettingsCurve(profile.clutchCurve, '#42A5F5');
  drawSettingsCurve(profile.brakeCurve, '#F44336');
  drawSettingsCurve(profile.throttleCurve, '#4CAF50');

  // Deadzone markers
  if (profile.throttleDeadzone > 0.01) {
    var tdx = pad + profile.throttleDeadzone * plotW;
    ctx.strokeStyle = 'rgba(76, 175, 80, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(tdx, pad); ctx.lineTo(tdx, pad + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(76, 175, 80, 0.4)';
    ctx.fillRect(pad, pad, tdx - pad, plotH);
  }
  if (profile.brakeDeadzone > 0.01) {
    var bdx = pad + profile.brakeDeadzone * plotW;
    ctx.strokeStyle = 'rgba(244, 67, 54, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(bdx, pad); ctx.lineTo(bdx, pad + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function loadPedalProfiles() {
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=listPedalProfiles';
  fetch(url).then(function (r) { return r.json(); }).then(function (profiles) {
    var sel = document.getElementById('settingsPedalProfile');
    if (!sel) return;
    sel.innerHTML = '';
    if (!profiles || profiles.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No profiles available';
      sel.appendChild(opt);
      _pedalProfilesLoaded = true;
      return;
    }
    profiles.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.carName ? ' (' + p.carName + ')' : '');
      if (p.isActive) opt.selected = true;
      sel.appendChild(opt);
    });
    _pedalProfilesLoaded = true;
  }).catch(function (e) {
    // Plugin may not be running yet
    var sel = document.getElementById('settingsPedalProfile');
    if (sel) {
      sel.innerHTML = '<option value="">Plugin not connected</option>';
    }
    _pedalProfilesLoaded = false;
  });
}

function switchPedalProfile(profileId) {
  if (!profileId) return;
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=setPedalProfile&id=' + encodeURIComponent(profileId);
  fetch(url).catch(function () {});
}

function bindPedalProfileToCar() {
  var sel = document.getElementById('settingsPedalProfile');
  if (!sel || !sel.value) return;
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=bindPedalProfile&id=' + encodeURIComponent(sel.value);
  fetch(url).then(function () {
    var btn = document.getElementById('pedalBindCarBtn');
    if (btn) { btn.textContent = 'Bound!'; setTimeout(function () { btn.textContent = 'Bind'; }, 2000); }
  }).catch(function () {});
}

function importMozaPedals() {
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=importMozaPedals';
  var btn = document.getElementById('mozaImportBtn');
  if (btn) btn.textContent = 'Importing...';

  fetch(url).then(function (r) { return r.json(); }).then(function (result) {
    if (result.ok) {
      loadPedalProfiles(); // refresh the dropdown
      if (btn) { btn.textContent = 'Imported!'; setTimeout(function () { btn.textContent = 'Import from Moza'; }, 3000); }
    } else {
      if (btn) { btn.textContent = 'Import failed'; setTimeout(function () { btn.textContent = 'Import from Moza'; }, 3000); }
    }
  }).catch(function () {
    if (btn) { btn.textContent = 'Error'; setTimeout(function () { btn.textContent = 'Import from Moza'; }, 3000); }
  });
}

/**
 * Open a native folder picker dialog so the user can locate their Moza Pithouse folder.
 * Uses Electron's dialog module (available in the overlay's Node context).
 */
function browseMozaFolder() {
  // Use Electron dialog if available (we're running in Electron)
  try {
    var electron = require('electron');
    var remote = electron.remote || (electron.ipcRenderer ? null : null);

    // In newer Electron, use ipcRenderer to ask main process
    if (electron.ipcRenderer) {
      // Send to main process to show dialog
      electron.ipcRenderer.invoke('dialog:openDirectory', {
        title: 'Locate Moza Pithouse Folder',
        message: 'Select the Moza Pithouse installation or data folder',
        properties: ['openDirectory']
      }).then(function (result) {
        if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
          _setMozaPath(result.filePaths[0]);
        }
      });
      return;
    }

    // Legacy: use remote.dialog
    if (remote && remote.dialog) {
      var result = remote.dialog.showOpenDialogSync({
        title: 'Locate Moza Pithouse Folder',
        properties: ['openDirectory']
      });
      if (result && result.length > 0) {
        _setMozaPath(result[0]);
      }
      return;
    }
  } catch (e) {
    // Not in Electron or require unavailable
  }

  // Fallback: prompt for path manually
  var path = prompt(
    'Enter the path to your Moza Pithouse folder:\n\n'
    + 'Common locations:\n'
    + '• C:\\Program Files\\MOZA Pit House\n'
    + '• C:\\Program Files (x86)\\MOZA Pit House\n'
    + '• %LocalAppData%\\MOZA Pit House'
  );
  if (path) {
    _setMozaPath(path.trim());
  }
}

/**
 * Send the user-selected Moza path to the plugin and update the UI.
 */
function _setMozaPath(path) {
  if (!path) return;
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=setMozaPath&path=' + encodeURIComponent(path);
  var locateBtn = document.getElementById('mozaLocateBtn');
  if (locateBtn) locateBtn.textContent = 'Checking...';

  fetch(url).then(function (r) { return r.json(); }).then(function (result) {
    if (result.ok) {
      // Path accepted — Moza is now detected, update UI
      var statusLabel = document.getElementById('mozaStatusLabel');
      var importBtn = document.getElementById('mozaImportBtn');
      if (statusLabel) statusLabel.textContent = 'Moza Pithouse found at: ' + path;
      if (importBtn) importBtn.disabled = false;
      if (locateBtn) locateBtn.style.display = 'none';

      // Auto-import was triggered by the plugin, refresh profiles
      loadPedalProfiles();
    } else {
      var statusLabel = document.getElementById('mozaStatusLabel');
      if (statusLabel) statusLabel.textContent = result.error || 'Not a valid Pithouse folder';
      if (locateBtn) { locateBtn.textContent = 'Locate Folder'; }
    }
  }).catch(function () {
    if (locateBtn) { locateBtn.textContent = 'Locate Folder'; }
  });
}

// Detect Moza status and update UI when the Pedals tab loads
function updatePedalSettingsUI() {
  var profile = window.getCurrentPedalProfile ? window.getCurrentPedalProfile() : null;
  var statusLabel = document.getElementById('mozaStatusLabel');
  var importBtn = document.getElementById('mozaImportBtn');
  var locateBtn = document.getElementById('mozaLocateBtn');

  if (profile) {
    _applyMozaStatus(profile.mozaDetected, statusLabel, importBtn, locateBtn);
  } else {
    // No live profile data yet — query plugin directly for Moza status
    if (statusLabel) statusLabel.textContent = 'Checking Moza status...';
    _fetchMozaInfo();
  }

  // Load profile list if not yet loaded
  if (!_pedalProfilesLoaded) loadPedalProfiles();

  // Render large curve preview
  renderPedalSettingsCurve();

  // Update debug panel
  _updateMozaDebug(profile);
}

function _applyMozaStatus(detected, statusLabel, importBtn, locateBtn) {
  if (detected) {
    if (statusLabel) statusLabel.textContent = 'Moza Pithouse detected';
    if (importBtn) importBtn.disabled = false;
    if (locateBtn) locateBtn.style.display = 'none';
  } else {
    if (statusLabel) statusLabel.textContent = 'Moza not detected — locate your Pithouse folder';
    if (importBtn) importBtn.disabled = true;
    if (locateBtn) locateBtn.style.display = '';
  }
}

/**
 * Query the plugin's mozaInfo endpoint directly so we can show Moza status
 * even when no sim is running (no live poll data).
 */
function _fetchMozaInfo() {
  var url = (window._simhubUrlOverride || SIMHUB_URL) + '?action=mozaInfo';
  fetch(url).then(function (r) { return r.json(); }).then(function (info) {
    var statusLabel = document.getElementById('mozaStatusLabel');
    var importBtn = document.getElementById('mozaImportBtn');
    var locateBtn = document.getElementById('mozaLocateBtn');

    if (info && info.detected) {
      _applyMozaStatus(true, statusLabel, importBtn, locateBtn);
      if (statusLabel && info.path) statusLabel.textContent = 'Moza Pithouse found at: ' + info.path;
    } else {
      _applyMozaStatus(false, statusLabel, importBtn, locateBtn);
    }
  }).catch(function () {
    // Plugin not running
    var statusLabel = document.getElementById('mozaStatusLabel');
    var importBtn = document.getElementById('mozaImportBtn');
    var locateBtn = document.getElementById('mozaLocateBtn');
    if (statusLabel) statusLabel.textContent = 'Plugin not connected';
    if (importBtn) importBtn.disabled = true;
    if (locateBtn) locateBtn.style.display = '';
  });
}

function _updateMozaDebug(profile) {
  var el = function (id) { return document.getElementById(id); };

  if (!profile) {
    var ids = ['dbgMozaDetected', 'dbgProfileSource', 'dbgProfileName',
               'dbgCarName', 'dbgThrottlePts', 'dbgBrakePts', 'dbgClutchPts',
               'dbgThrottleDz', 'dbgBrakeDz'];
    ids.forEach(function (id) { var e = el(id); if (e) e.textContent = '—'; });
    var jsonEl = el('dbgRawJson');
    if (jsonEl) jsonEl.textContent = 'No profile data';
    return;
  }

  var set = function (id, val) { var e = el(id); if (e) e.textContent = val; };

  set('dbgMozaDetected', profile.mozaDetected ? 'YES' : 'NO');
  set('dbgProfileSource', profile.source || '(none)');
  set('dbgProfileName', profile.profileName || '(unnamed)');
  set('dbgCarName', profile.carName || '(none)');
  set('dbgThrottlePts', profile.throttleCurve ? profile.throttleCurve.length + ' pts' : '—');
  set('dbgBrakePts', profile.brakeCurve ? profile.brakeCurve.length + ' pts' : '—');
  set('dbgClutchPts', profile.clutchCurve ? profile.clutchCurve.length + ' pts' : '—');
  set('dbgThrottleDz', profile.throttleDeadzone != null ? (profile.throttleDeadzone * 100).toFixed(1) + '%' : '—');
  set('dbgBrakeDz', profile.brakeDeadzone != null ? (profile.brakeDeadzone * 100).toFixed(1) + '%' : '—');

  var jsonEl = el('dbgRawJson');
  if (jsonEl) {
    try {
      jsonEl.textContent = JSON.stringify(profile, null, 1);
    } catch (e) {
      jsonEl.textContent = '(error)';
    }
  }
}

// Hook into tab switch to refresh pedal settings.
// NOTE: pedal-curves.js loads before settings.js, so switchSettingsTab
// does not exist at script-load time. We must check at DOMContentLoaded
// when all scripts have been parsed.
document.addEventListener('DOMContentLoaded', function () {
  // By now settings.js has loaded and switchSettingsTab is global
  if (typeof switchSettingsTab === 'function') {
    var orig = switchSettingsTab;
    window.switchSettingsTab = function (tab) {
      orig(tab);
      if (tab.dataset && tab.dataset.tab === 'pedals') updatePedalSettingsUI();
    };
  }
});
