// SIMHUB HTTP API POLLING ENGINE
// Depends on: config.js (SIMHUB_URL, POLL_MS, PROP_KEYS)

  // ═══════════════════════════════════════════════════════════════
  // SIMHUB HTTP API POLLING ENGINE
  // Self-contained data bridge — polls SimHub's web server directly.
  // Works as standalone browser overlay or OBS Browser Source.
  // The JavascriptExtensions file is unused in this mode.
  //
  // Config: K10 Motorsports plugin HTTP server (port 8889)
  // The plugin serves all telemetry, demo, commentary and track map data
  // as a flat JSON map from its own HTTP server — no SimHub web API needed.
  // ═══════════════════════════════════════════════════════════════

  // Constants and property keys are defined in config.js
  // Connection status, fetchProps, applyGameMode are in game-detect.js
  // Settings persistence and Discord state are in connections.js

  // ─── Fallback demo track map — Sebring International (80-pt Catmull-Rom→Bezier) ──
  // Generated from bundled CSV: sebring international.csv
  // Normalised to 0-100 viewBox with 5% padding (same algorithm as C# NormaliseAndBuild)
  const _DEMO_FALLBACK_MAP = 'M 58.9,71.8 C 64.2,72.1 62.3,72.0 64.0,72.1 C 65.7,72.1 67.3,72.3 69.0,72.2 C 70.6,72.0 72.5,72.0 73.7,71.2 C 75.0,70.3 75.8,68.6 76.3,67.1 C 76.9,65.6 76.9,63.8 77.0,62.1 C 77.0,60.4 76.7,58.7 76.5,56.9 C 76.2,55.2 75.8,53.6 75.5,51.8 C 75.2,50.1 74.9,48.3 74.8,46.5 C 74.7,44.8 75.0,43.0 74.9,41.3 C 74.7,39.7 74.8,37.6 74.0,36.4 C 73.1,35.3 71.2,35.2 69.7,34.5 C 68.2,33.9 66.6,32.9 65.0,32.4 C 63.5,32.0 61.6,31.2 60.3,31.8 C 59.0,32.3 58.2,34.2 57.3,35.6 C 56.5,37.0 56.0,38.7 55.0,40.1 C 54.0,41.5 52.6,42.9 51.3,44.0 C 50.0,45.1 48.7,45.9 47.3,46.8 C 45.8,47.6 44.1,48.4 42.4,49.0 C 40.6,49.5 38.7,49.9 36.8,50.2 C 34.9,50.4 32.9,50.4 30.9,50.4 C 28.9,50.4 26.8,50.3 24.8,50.3 C 22.7,50.3 20.5,50.4 18.5,50.4 C 16.6,50.4 14.7,50.4 12.9,50.4 C 11.2,50.4 9.3,50.9 8.0,50.4 C 6.7,49.8 5.2,48.6 5.1,47.3 C 5.0,46.1 6.6,44.5 7.4,43.0 C 8.2,41.6 8.8,40.0 9.9,38.7 C 11.0,37.4 12.4,36.0 13.9,35.1 C 15.4,34.1 17.1,33.5 18.8,32.8 C 20.4,32.1 22.3,31.5 23.9,30.9 C 25.6,30.2 27.3,29.7 28.7,28.9 C 30.2,28.1 31.3,27.2 32.5,26.2 C 33.8,25.2 34.9,24.0 36.0,22.9 C 37.2,21.8 38.2,20.7 39.4,19.5 C 40.6,18.3 41.9,16.8 43.1,15.7 C 44.4,14.5 45.7,12.9 47.0,12.7 C 48.3,12.6 49.7,13.9 50.9,14.8 C 52.2,15.7 53.2,17.3 54.6,18.0 C 56.0,18.8 57.7,19.2 59.3,19.2 C 61.0,19.1 62.9,18.4 64.5,17.8 C 66.1,17.3 67.4,16.4 69.0,16.0 C 70.5,15.6 72.2,15.6 73.9,15.5 C 75.6,15.4 77.7,15.0 79.1,15.5 C 80.4,16.1 81.7,17.6 82.2,19.0 C 82.7,20.4 82.1,22.2 82.1,24.0 C 82.0,25.8 82.0,27.8 81.9,29.6 C 81.9,31.3 81.8,32.8 81.8,34.5 C 81.7,36.1 81.7,37.9 81.6,39.5 C 81.6,41.1 81.3,42.6 81.3,44.2 C 81.3,45.8 81.3,47.4 81.6,49.0 C 82.0,50.5 82.7,52.1 83.4,53.7 C 84.2,55.2 85.1,56.9 86.2,58.4 C 87.3,59.8 89.0,61.1 90.2,62.4 C 91.5,63.8 93.0,65.0 93.8,66.5 C 94.6,67.9 95.1,69.6 94.9,71.1 C 94.6,72.6 93.0,73.9 92.4,75.4 C 91.8,77.0 91.7,78.7 91.2,80.4 C 90.8,82.0 90.6,84.3 89.6,85.4 C 88.7,86.6 86.8,87.1 85.3,87.4 C 83.7,87.6 82.1,87.1 80.4,87.0 C 78.7,86.9 76.8,86.8 75.1,86.7 C 73.4,86.7 71.9,86.9 70.2,86.9 C 68.5,86.9 66.7,86.9 64.8,86.9 C 63.0,86.9 61.0,86.9 59.1,86.8 C 57.1,86.8 55.1,86.8 53.1,86.8 C 51.1,86.7 48.9,86.7 46.9,86.7 C 44.8,86.7 42.7,86.8 40.8,86.8 C 38.9,86.8 37.3,86.8 35.6,86.8 C 33.8,86.8 32.1,86.8 30.4,86.7 C 28.7,86.7 27.3,86.8 25.6,86.7 C 23.9,86.7 21.8,86.8 20.1,86.5 C 18.3,86.2 16.8,85.7 15.3,84.8 C 13.9,84.0 12.3,82.9 11.4,81.5 C 10.5,80.2 10.0,78.2 10.1,76.7 C 10.3,75.2 11.1,73.5 12.3,72.5 C 13.4,71.5 15.3,71.2 17.0,70.8 C 18.6,70.4 20.4,70.2 22.1,70.1 C 23.8,70.0 25.3,70.0 27.0,70.0 C 28.7,70.0 27.0,69.9 32.3,70.2 C 37.7,70.5 53.7,71.5 58.9,71.8 Z';

  // ─── Time value parser — handles both numeric seconds and TimeSpan strings ───
  function _parseTimeValue(val) {
    if (val == null || val === '') return 0;
    // Try numeric first (most common case)
    var n = +val;
    if (!isNaN(n)) return n;
    // Try TimeSpan string format "HH:MM:SS.fff" or "MM:SS.fff"
    if (typeof val === 'string') {
      var parts = val.split(':');
      if (parts.length === 3) {
        // HH:MM:SS.fff
        return (+parts[0] || 0) * 3600 + (+parts[1] || 0) * 60 + (parseFloat(parts[2]) || 0);
      } else if (parts.length === 2) {
        // MM:SS.fff
        return (+parts[0] || 0) * 60 + (parseFloat(parts[1]) || 0);
      }
    }
    return 0;
  }

  // ─── Track display name resolver ───
  // Fetches user-customized display names from the K10 API.
  // Falls back to the game-provided name if no custom name is set or API is unreachable.
  const _trackDisplayNameCache = {};    // { gameTrackName → displayName }
  const _trackDisplayNamePending = {};  // { gameTrackName → true } (in-flight requests)
  const K10_DISPLAY_NAME_API = 'https://prodrive.racecor.io/api/tracks';

  function resolveTrackDisplayName(gameTrackName) {
    if (_trackDisplayNameCache[gameTrackName] || _trackDisplayNamePending[gameTrackName]) return;
    _trackDisplayNamePending[gameTrackName] = true;
    fetch(K10_DISPLAY_NAME_API + '?trackName=' + encodeURIComponent(gameTrackName))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        // displayName from API already falls back to trackName server-side
        _trackDisplayNameCache[gameTrackName] = (data && data.displayName) || gameTrackName;
      })
      .catch(function() {
        // API unreachable — use the game name
        _trackDisplayNameCache[gameTrackName] = gameTrackName;
      })
      .finally(function() {
        delete _trackDisplayNamePending[gameTrackName];
      });
  }

  // ─── Data fetch loop (runs on setInterval — decoupled from display) ───
  async function pollUpdate() {
    if (_pollActive) return;
    _pollActive = true;
    try {
      const p = await fetchProps();
      if (p) {
        _latestSnapshot = p;
        _snapshotDirty = true;
      }
    } catch (err) {
      console.error('[K10 poll] Fetch error:', err);
    } finally {
      _pollActive = false;
    }
  }

  // ─── rAF render loop — DOM writes synchronized to display refresh rate ───
  function _rafLoop() {
    requestAnimationFrame(_rafLoop);
    if (!_snapshotDirty || !_latestSnapshot) return;
    _snapshotDirty = false;
    _renderFrame(_latestSnapshot);
  }
  requestAnimationFrame(_rafLoop);

  // ─── Render frame — all DOM reads/writes happen here, once per display frame ───
  function _renderFrame(p) {
    _pollFrame++;
    _cycleFrameCount++;
    try {

    // Diagnostic logging (first 3 frames + every 300 frames ~10s)
    if (_pollFrame <= 3 || _pollFrame % 300 === 0) {
      const keys = Object.keys(p).filter(k => p[k] != null && p[k] !== 0 && p[k] !== '');
      console.log(`[K10 poll #${_pollFrame}] Got ${Object.keys(p).length} keys, ${keys.length} non-empty. DemoMode=${p['K10Motorsports.Plugin.DemoMode']}, GameRunning=${p['DataCorePlugin.GameRunning']}`);
      if (_pollFrame === 1) console.log('[K10 poll] Sample values:', JSON.stringify(Object.fromEntries(keys.slice(0, 10).map(k => [k, p[k]]))));
    }

    // ── Plugin version check — warn if old DLL is serving incomplete data ──
    if (_pollFrame === 1 && !p['DataCorePlugin.GameRunning'] && p['DataCorePlugin.GameRunning'] !== 0) {
      let dbg = document.createElement('div');
      dbg.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(20,20,28,0.95);color:#ff8;font:12px/1.6 system-ui,sans-serif;padding:20px 28px;z-index:99999;border-radius:10px;max-width:420px;text-align:center;border:1px solid rgba(255,255,255,0.12);';
      dbg.innerHTML = '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:8px">Plugin needs rebuild</div>' +
        '<div style="color:#aaa;font-size:11px;line-height:1.6">The SimHub plugin is an older version that doesn\'t serve telemetry data via HTTP.<br><br>' +
        'Rebuild the C# project in Visual Studio and restart SimHub.<br>' +
        `<span style="color:#666;font-size:10px">Got ${Object.keys(p).length} keys, expected 50+</span></div>`;
      document.body.appendChild(dbg);
      setTimeout(() => dbg.remove(), 15000);
    }

    const v = (k) => p[k] != null ? p[k] : 0;
    const vs = (k) => p[k] != null ? '' + p[k] : '';

    // Demo mode: swap data sources when plugin demo mode is active
    const _demo = +v('K10Motorsports.Plugin.DemoMode') || 0;
    const d = (gameKey, demoKey) => _demo ? v('K10Motorsports.Plugin.' + demoKey) : v(gameKey);
    const ds = (gameKey, demoKey) => _demo ? vs('K10Motorsports.Plugin.' + demoKey) : vs(gameKey);

    // ─── Idle State Detection ───
    const gameRunning = +v('DataCorePlugin.GameRunning') || 0;
    const sessionPre = _demo ? 'K10Motorsports.Plugin.Demo.Grid.' : 'K10Motorsports.Plugin.Grid.';
    const dsPre = _demo ? 'K10Motorsports.Plugin.Demo.DS.' : 'K10Motorsports.Plugin.DS.';
    const sessNum = parseInt(vs(sessionPre + 'SessionState')) || 0;
    const _inPitLane = +(p[dsPre + 'IsInPitLane']) > 0;

    // ─── Session change detection — reset per-session state ───
    const _currSessionTypeName = _demo
      ? vs('K10Motorsports.Plugin.Demo.SessionTypeName')
      : vs('K10Motorsports.Plugin.SessionTypeName');
    if (_currSessionTypeName && _currSessionTypeName !== _prevSessionTypeName && _prevSessionTypeName) {
      console.log('[K10] Session changed:', _prevSessionTypeName, '→', _currSessionTypeName);
      if (typeof resetTimeline === 'function') resetTimeline();
      // Capture session start snapshot for sync
      if (typeof window.captureSessionStart === 'function') {
        window.captureSessionStart(p, _demo);
      }
      window._sessionStartCaptured = true;
    }
    if (_currSessionTypeName) _prevSessionTypeName = _currSessionTypeName;

    // First-frame capture: if we haven't captured a start snapshot yet and have session data
    if (typeof window.captureSessionStart === 'function' && !window._sessionStartCaptured && _currSessionTypeName) {
      window.captureSessionStart(p, _demo);
      window._sessionStartCaptured = true;
    }

    // Detect game and apply feature gating
    const rawGameId = v('K10Motorsports.Plugin.GameId') || '';
    const newGameId = detectGameId(rawGameId);
    if (newGameId !== _currentGameId) {
      _currentGameId = newGameId;
      window._currentGameId = _currentGameId;
      _isIRacing = (_currentGameId === 'iracing');
      _isRally = isRallyGame() || _rallyModeEnabled;
      applyGameMode();
    }
    // Game logo overlay
    if (window.updateGameLogo) window.updateGameLogo(_currentGameId, _settings.showGameLogo !== false);

    // Block non-iRacing games unless Discord connected (demo mode always allowed)
    if (!_demo && !isGameAllowed()) {
      // Show "Connect Discord to unlock" message
      return;
    }

    // Expose rolling/formation start state for leaderboard sparklines
    window._isRollingStart = (sessNum === 2 || sessNum === 3); // Warmup or ParadeLaps

    // Idle detection: only idle when no session (sessNum === 0) or game not running
    // Pre-race states (sessNum 1=GetInCar, 2=Warmup, 3=ParadeLaps) should stay active
    const nowIdle = !_demo && (!gameRunning || sessNum === 0);
    const idleLogo = document.getElementById('idleLogo');
    if (nowIdle !== _isIdle) {
      _isIdle = nowIdle;
      if (nowIdle) {
        document.body.classList.add('idle-state');
        if (idleLogo) idleLogo.classList.add('idle-visible');
      } else {
        document.body.classList.remove('idle-state');
        if (idleLogo) idleLogo.classList.remove('idle-visible');
        // Session going active — reveal HUD from logo-only startup
        if (typeof revealFromLogoOnly === 'function') revealFromLogoOnly();
      }
    }
    // Skip rest of update in idle (except settings remain responsive)
    if (_isIdle) { _pollActive = false; return; }

    // ─── Gear / Speed / RPM ───
    const gear = ds('DataCorePlugin.GameData.Gear', 'Demo.Gear') || 'N';
    const rpm = +d('DataCorePlugin.GameData.Rpms', 'Demo.Rpm') || 0;
    const maxRpm = +d('DataCorePlugin.GameData.CarSettings_MaxRPM', 'Demo.MaxRpm') || 1;
    const speed = +d('DataCorePlugin.GameData.SpeedMph', 'Demo.SpeedMph') || 0;

    const gearEl = document.getElementById('gearText');
    const rpmEl = document.getElementById('rpmText');
    const speedEl = document.getElementById('speedText');
    if (gearEl) gearEl.textContent = gear;
    if (rpmEl) rpmEl.textContent = rpm > 0 ? Math.round(rpm) : '0';
    if (speedEl) speedEl.textContent = speed > 0 ? Math.round(speed) : '0';
    // RPM ratio — server-computed (DS.RpmRatio), fallback to client math
    const rpmRatio = +(p[dsPre + 'RpmRatio']) || (maxRpm > 0 ? Math.min(1, rpm / maxRpm) : 0);
    updateTacho(rpmRatio);
    // Redline flash on entire tacho block
    const tachoBlock = document.querySelector('.tacho-block');
    if (tachoBlock) {
      if (rpmRatio >= 0.91) tachoBlock.classList.add('tacho-redline');
      else tachoBlock.classList.remove('tacho-redline');
    }

    // ─── Pedals — server-normalized (DS.ThrottleNorm etc.), fallback to client math ───
    let thr = +(p[dsPre + 'ThrottleNorm']);
    let brk = +(p[dsPre + 'BrakeNorm']);
    let clt = +(p[dsPre + 'ClutchNorm']);
    // Fallback: normalize client-side if server values not available
    if (!(thr >= 0)) {
      thr = +d('DataCorePlugin.GameData.Throttle', 'Demo.Throttle') || 0;
      while (thr > 1.01) thr /= 100;
      thr = Math.min(1, Math.max(0, thr));
    }
    if (!(brk >= 0)) {
      brk = +d('DataCorePlugin.GameData.Brake', 'Demo.Brake') || 0;
      while (brk > 1.01) brk /= 100;
      brk = Math.min(1, Math.max(0, brk));
    }
    if (!(clt >= 0)) {
      clt = +d('DataCorePlugin.GameData.Clutch', 'Demo.Clutch') || 0;
      while (clt > 1.01) clt /= 100;
      clt = Math.min(1, Math.max(0, clt));
    }

    // Auto-hide clutch for cars with autoclutch/DCT/no manual clutch pedal
    if (clt > 0.03) _clutchSeenActive = true;
    if (!_clutchSeenActive && _pollFrame > 60 && speed > 10) {
      if (!_clutchHidden) {
        _clutchHidden = true;
        const cltLabel = document.getElementById('clutchLabelGroup');
        const cltLayer = document.querySelector('.clutch-layer');
        if (cltLabel) cltLabel.style.display = 'none';
        if (cltLayer) cltLayer.style.display = 'none';
      }
    } else if (_clutchSeenActive && _clutchHidden) {
      _clutchHidden = false;
      const cltLabel = document.getElementById('clutchLabelGroup');
      const cltLayer = document.querySelector('.clutch-layer');
      if (cltLabel) cltLabel.style.display = '';
      if (cltLayer) cltLayer.style.display = '';
    }

    // Push every sample — rAF gate in webgl-helpers coalesces to display rate
    renderPedalTrace(thr, brk, _clutchHidden ? 0 : clt);

    // ─── Pedal curve overlay (response curves from active profile) ───
    if (window.updatePedalCurves) window.updatePedalCurves(p);

    // ─── WebGL FX update ───
    if (window.updateGLFX) window.updateGLFX(rpmRatio, thr, brk, clt);
    // Post-processing pipeline — feed smoothed telemetry for screen effects
    if (window.updatePostFX) window.updatePostFX({
      speed: speed,
      rpm: rpmRatio,
      latG: +(p[dsPre + 'LatG']) || 0,
      longG: +(p[dsPre + 'LongG']) || 0,
      yawRate: +(p[dsPre + 'YawRate']) || 0,
      steer: Math.max(-1, Math.min(1, +(p['DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle']) || 0))
    });

    // ─── Fuel — bar shows current fuel vs full tank capacity ───
    const fuel = +d('DataCorePlugin.GameData.Fuel', 'Demo.Fuel') || 0;
    const maxFuel = +d('DataCorePlugin.GameData.MaxFuel', 'Demo.MaxFuel') || 0;
    // Bar percentage: current fuel / full tank capacity (not starting fuel)
    const fuelPct = maxFuel > 0 ? (fuel / maxFuel) * 100 : 0;
    const fuelRem = document.querySelector('.fuel-remaining');
    // Respect DisplayUnits for fuel label (0=imperial/gal, 1=metric/L)
    const _rawFuelUnits = p[dsPre + 'DisplayUnits'];
    const _fuelImperial = _rawFuelUnits !== '' && _rawFuelUnits != null && parseInt(_rawFuelUnits) === 0;
    const fuelDisplay = _fuelImperial ? fuel / 3.78541 : fuel;
    const fuelUnitLabel = _fuelImperial ? 'gal' : 'L';
    if (fuelRem) fuelRem.innerHTML = fuelDisplay > 0 ? fuelDisplay.toFixed(1) + ' <span class="unit">' + fuelUnitLabel + '</span>' : '— <span class="unit">' + fuelUnitLabel + '</span>';
    updateFuelBar(fuelPct, 0);

    const fuelPerLapRaw = _demo ? (+v('K10Motorsports.Plugin.Demo.FuelPerLap') || 0) : (+v('DataCorePlugin.Computed.Fuel_LitersPerLap') || 0);
    const fuelPerLap = _fuelImperial ? fuelPerLapRaw / 3.78541 : fuelPerLapRaw;
    const fuelLapsEst = +(p[dsPre + 'FuelLapsRemaining']) || (fuelPerLapRaw > 0 ? fuel / fuelPerLapRaw : 0);
    const completedLaps = +(p[dsPre + 'CompletedLaps']) || 0;
    const fuelVals = document.querySelectorAll('.fuel-stats .val');
    if (fuelVals.length >= 2) {
      // Show "calculating..." during lap 1 when fuelPerLap hasn't stabilized yet
      if (fuelPerLap > 0) {
        fuelVals[0].textContent = fuelPerLap.toFixed(2);
      } else if (completedLaps < 2 && fuel > 0) {
        fuelVals[0].textContent = 'calc...';
      } else {
        fuelVals[0].textContent = '—';
      }
      // Fix #10: Show "—" instead of "0" when fuelPerLap is 0 (no data yet)
      fuelVals[1].textContent = fuelLapsEst > 0.1 ? fuelLapsEst.toFixed(1) : '—';
    }
    const pitSug = document.querySelector('.fuel-pit-suggest');
    if (pitSug) {
      const remLaps = +d('DataCorePlugin.GameData.RemainingLaps', 'Demo.RemainingLaps') || 0;
      pitSug.textContent = (fuelLapsEst > 0 && remLaps > 0 && fuelLapsEst < remLaps)
        ? 'PIT in ~' + Math.ceil(fuelLapsEst) + ' laps' : '';
    }

    // ─── Tyres ───
    // Backend sends wear as 0=new, 1=gone. Convert to remaining % for display
    // (100 = full life, 0 = destroyed) so bar width + color thresholds are correct.
    if (_demo) {
      updateTyreCell(0, +v('K10Motorsports.Plugin.Demo.TyreTempFL'), (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearFL') || 0)) * 100);
      updateTyreCell(1, +v('K10Motorsports.Plugin.Demo.TyreTempFR'), (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearFR') || 0)) * 100);
      updateTyreCell(2, +v('K10Motorsports.Plugin.Demo.TyreTempRL'), (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearRL') || 0)) * 100);
      updateTyreCell(3, +v('K10Motorsports.Plugin.Demo.TyreTempRR'), (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearRR') || 0)) * 100);
    } else {
      updateTyreCell(0, +v('DataCorePlugin.GameData.TyreTempFrontLeft'), (p['DataCorePlugin.GameData.TyreWearFrontLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontLeft']) * 100 : -1));
      updateTyreCell(1, +v('DataCorePlugin.GameData.TyreTempFrontRight'), (p['DataCorePlugin.GameData.TyreWearFrontRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontRight']) * 100 : -1));
      updateTyreCell(2, +v('DataCorePlugin.GameData.TyreTempRearLeft'), (p['DataCorePlugin.GameData.TyreWearRearLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearLeft']) * 100 : -1));
      updateTyreCell(3, +v('DataCorePlugin.GameData.TyreTempRearRight'), (p['DataCorePlugin.GameData.TyreWearRearRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearRight']) * 100 : -1));
    }

    // ─── Controls (BB / TC / ABS) ───
    const bb = _demo ? +v('K10Motorsports.Plugin.Demo.BrakeBias') : (+v('DataCorePlugin.GameRawData.Telemetry.dcBrakeBias') || 0);
    const tc = _demo ? +v('K10Motorsports.Plugin.Demo.TC') : p['DataCorePlugin.GameRawData.Telemetry.dcTractionControl'];
    const abs = _demo ? +v('K10Motorsports.Plugin.Demo.ABS') : p['DataCorePlugin.GameRawData.Telemetry.dcABS'];
    const absActive = +v(dsPre + 'AbsActive') || 0;
    const tcActive  = +v(dsPre + 'TcActive')  || 0;
    const carModel = ds('DataCorePlugin.GameData.CarModel', 'Demo.CarModel');
    if (carModel !== _lastCarModel) {
      _tcSeen = false; _absSeen = false;
      _lastCarModel = carModel;
      _carAdj = getCarAdjustability(carModel);
      setCarLogo(detectMfr(carModel), carModel);
      // Track car usage for driver profile heatmap
      if (carModel && !_demo && typeof recordCarSession === 'function') recordCarSession(carModel);
    }
    if (_demo) { _tcSeen = true; _absSeen = true; }
    else {
      // Once we see any valid value (even 0), the car has this system
      if (tc != null && +tc >= 0) _tcSeen = true;
      if (abs != null && +abs >= 0) _absSeen = true;
    }
    // If car is in the no-adjust list, hide the module entirely for absent systems
    // tcNoAdjust / absNoAdjust: electronic exists but isn't driver-adjustable → show "Fixed" + flash when active
    // Adjustable car with value 0 → driver turned it off → show "Off"
    const tcOk = _demo || (_carAdj && _carAdj.noTC ? false : (_tcSeen || (_carAdj && _carAdj.tcNoAdjust && tcActive > 0)));
    const absOk = _demo || (_carAdj && _carAdj.noABS ? false : (_absSeen || (_carAdj && _carAdj.absNoAdjust && absActive > 0)));
    const bbOk = _demo || (_carAdj && _carAdj.noBB ? false : (bb > 0));
    setCtrlVisibility(bbOk, tcOk, absOk);

    const bbEl = document.querySelector('#ctrlBB .ctrl-value');
    if (bbEl && bbOk) { bbEl.textContent = bb > 0 ? bb.toFixed(1) : '—'; document.getElementById('ctrlBB').style.setProperty('--ctrl-pct', (bb > 0 ? Math.min(100, ((bb-30)/40)*100) : 0) + '%'); }
    if (tcOk) {
      const el = document.querySelector('#ctrlTC .ctrl-value');
      const tcBox = document.getElementById('ctrlTC');
      if (el) {
        if (_carAdj && _carAdj.tcNoAdjust) {
          // TC exists but not adjustable — show "Fixed", flash when active
          el.textContent = 'Fixed';
          el.classList.add('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', tcActive > 0 ? '100%' : '0%');
        } else if (+tc === 0) {
          el.textContent = 'Off';
          el.classList.remove('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', '0%');
        } else {
          el.textContent = Math.round(+tc);
          el.classList.remove('ctrl-value-fixed');
          tcBox.style.setProperty('--ctrl-pct', Math.min(100, (+tc/12)*100) + '%');
        }
      }
    }
    if (absOk) {
      const el = document.querySelector('#ctrlABS .ctrl-value');
      const absBox = document.getElementById('ctrlABS');
      if (el) {
        if (_carAdj && _carAdj.absNoAdjust) {
          // ABS exists but not adjustable — show "Fixed", flash when active
          el.textContent = 'Fixed';
          el.classList.add('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', absActive > 0 ? '100%' : '0%');
        } else if (+abs === 0) {
          el.textContent = 'Off';
          el.classList.remove('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', '0%');
        } else {
          el.textContent = Math.round(+abs);
          el.classList.remove('ctrl-value-fixed');
          absBox.style.setProperty('--ctrl-pct', Math.min(100, (+abs/12)*100) + '%');
        }
      }
    }
    // TC / ABS active flash — runs on main dashboard, not gated behind datastream visibility
    const tcBoxEl = document.getElementById('ctrlTC');
    const absBoxEl = document.getElementById('ctrlABS');
    if (tcActive > 0) _tcFlashFrames = 8;
    if (absActive > 0) _absFlashFrames = 8;
    if (tcBoxEl) { tcBoxEl.classList.toggle('ctrl-active', _tcFlashFrames > 0); if (_tcFlashFrames > 0) _tcFlashFrames--; }
    if (absBoxEl) { absBoxEl.classList.toggle('ctrl-active', _absFlashFrames > 0); if (_absFlashFrames > 0) _absFlashFrames--; }

    // Flash control bars on value change + announce via spotter
    if (_prevBB >= 0 && bb > 0 && Math.abs(bb - _prevBB) > 0.05) {
      flashCtrlBar('ctrlBB');
      if (window.announceAdjustment) window.announceAdjustment('bb', bb, bb > _prevBB ? 1 : -1);
    }
    if (_prevTC >= 0 && +tc !== _prevTC) {
      flashCtrlBar('ctrlTC');
      if (window.announceAdjustment) window.announceAdjustment('tc', +tc, +tc > _prevTC ? 1 : -1);
    }
    if (_prevABS >= 0 && +abs !== _prevABS) {
      flashCtrlBar('ctrlABS');
      if (window.announceAdjustment) window.announceAdjustment('abs', +abs, +abs > _prevABS ? 1 : -1);
    }
    if (bb > 0) _prevBB = bb;
    if (tcOk) _prevTC = +tc;
    if (absOk) _prevABS = +abs;

    // ─── Manufacturer country flag trigger ───
    // Shows 5-second aurora wisps in manufacturer's country colors on:
    //   Practice: leaving pit lane (entering the car)
    //   Qualifying: first timed lap (completedLaps 0 → 1)
    //   Race: green lights (Grid.SessionState transitions to 4)
    if (window.showMfrFlag && _currentCarLogo && _currentCarLogo !== 'generic' && _currentCarLogo !== 'none') {
      const sessType = (_demo ? (p['K10Motorsports.Plugin.Demo.SessionTypeName'] || '')
                              : (p['K10Motorsports.Plugin.SessionTypeName'] || '')).toLowerCase();
      const isPractice = sessType.includes('practice') || sessType.includes('test') || sessType.includes('warmup');
      const isQuali = sessType.includes('qualify') || sessType.includes('qual');
      const isRace = !isPractice && !isQuali && sessType.length > 0;

      let shouldFire = false;

      // Practice: pit → track transition
      if (isPractice && _mfrFlagPrevInPit && !_inPitLane) {
        shouldFire = true;
      }
      // Qualifying: first completed lap (outlap done, first timed lap begins)
      if (isQuali && _mfrFlagPrevCompletedLaps === 0 && completedLaps === 1) {
        shouldFire = true;
      }
      // Race: green lights — Grid.SessionState transitions from parade (3) to racing (4)
      if (isRace && _mfrFlagPrevSessState === 3 && sessNum === 4) {
        shouldFire = true;
      }

      // Reset flag when session changes (new practice/quali/race)
      if (sessNum !== _mfrFlagPrevSessState && (sessNum === 1 || sessNum === 2 || sessNum === 3)) {
        _mfrFlagShownThisSession = false;
      }

      if (shouldFire && !_mfrFlagShownThisSession) {
        _mfrFlagShownThisSession = true;
        const countryCode = _mfrCountry[_currentCarLogo];
        if (countryCode && _countryFlags[countryCode]) {
          const fc = _countryFlags[countryCode];
          window.showMfrFlag(fc[0], fc[1], fc[2]);
        }
      }

      _mfrFlagPrevSessState = sessNum;
      _mfrFlagPrevInPit = _inPitLane;
      _mfrFlagPrevCompletedLaps = completedLaps;
    }

    // ─── Position / Lap / Current Lap Time ───
    // Snapshot previous position BEFORE it gets overwritten (used by grid viz)
    const _vizSnapPrevPos = _lastPosition;
    const pos = +d('DataCorePlugin.GameData.Position', 'Demo.Position') || 0;
    const lap = +d('DataCorePlugin.GameData.CurrentLap', 'Demo.CurrentLap') || 0;
    const bestLap = +d('DataCorePlugin.GameData.BestLapTime', 'Demo.BestLapTime') || 0;
    // Parse CurrentLapTime robustly — SimHub may send this as a number
    // (seconds), a TimeSpan string ("00:01:23.456"), or null. Fall back
    // to iRacing raw telemetry LapCurrentLapTime if GameData fails.
    const curLapTime = _demo
      ? (+(p['K10Motorsports.Plugin.Demo.CurrentLapTime']) || 0)
      : (_parseTimeValue(p['DataCorePlugin.GameData.CurrentLapTime'])
         || +(p['DataCorePlugin.GameRawData.Telemetry.LapCurrentLapTime']) || 0);
    document.querySelectorAll('.pos-number').forEach(el => {
      const sp = el.querySelector('.skew-accent');
      if (sp) sp.textContent = pos > 0 ? 'P' + pos : 'P—';
    });
    // Use server-computed LapDelta (cumulative sector delta at current track position)
    const lapDelta = +(p[dsPre + 'LapDelta']) || 0;
    document.querySelectorAll('.pos-meta-row .val').forEach(el => {
      const row = el.closest('.pos-meta-row');
      if (row.classList.contains('delta-row')) {
        // Delta row: show cumulative lap delta vs best lap
        if (curLapTime > 0.5 && bestLap > 0) {
          el.textContent = (lapDelta >= 0 ? '+' : '') + lapDelta.toFixed(3);
          el.classList.remove('delta-faster', 'delta-slower', 'delta-pb');
          if (lapDelta <= -0.5) el.classList.add('delta-pb');
          else if (lapDelta < 0) el.classList.add('delta-faster');
          else if (lapDelta > 0) el.classList.add('delta-slower');
        } else {
          el.textContent = '';
          el.classList.remove('delta-faster', 'delta-slower', 'delta-pb');
        }
      } else if (row.classList.contains('current-row')) {
        // Current lap time (no delta appended — that's in the delta row now)
        if (curLapTime > 0.5) {
          el.textContent = fmtLap(curLapTime);
          el.classList.remove('purple', 'green');
          if (bestLap > 0 && lapDelta < 0) el.classList.add('green');
        } else {
          // Between laps: show best lap for reference
          el.textContent = bestLap > 0 ? fmtLap(bestLap) : '—:——.———';
          const sb = window._sessionBestLap || 0;
          const isSessionBest = bestLap > 0 && sb > 0 && Math.abs(bestLap - sb) < 0.05;
          el.classList.remove('purple', 'green');
          if (bestLap > 0) el.classList.add(isSessionBest ? 'purple' : 'green');
        }
        row.style.textAlign = 'left';
      }
      else el.textContent = lap > 0 ? lap : '—';
    });
    if (pos !== _lastPosition && _lastPosition > 0 && pos > 0) {
      document.querySelectorAll('.pos-number').forEach(el => flashElement(el, pos < _lastPosition ? 'ahead-changed' : 'behind-changed'));
      // WebGL leaderboard event animation on position change
      if (window.triggerLBEvent) {
        if (pos === 1 && pos < _lastPosition) {
          window.triggerLBEvent('p1');   // P1 gold celebration
        } else {
          window.triggerLBEvent(pos < _lastPosition ? 'gain' : 'lose');
        }
      }
    }
    // Start position — prefer server-computed, fallback to client-side
    const serverStartPos = +(p[dsPre + 'StartPosition']) || 0;
    if (serverStartPos > 0) _startPosition = serverStartPos;
    else if (_startPosition === 0 && pos > 0) _startPosition = pos;
    _lastPosition = pos;
    // Position delta indicator — prefer server-computed DS.PositionDelta
    document.querySelectorAll('.pos-delta').forEach(el => {
      const delta = +(p[dsPre + 'PositionDelta']) || (_startPosition > 0 && pos > 0 ? _startPosition - pos : 0);
      if (delta > 0) {
        el.textContent = '▲ ' + delta;
        el.className = 'pos-delta visible delta-up';
      } else if (delta < 0) {
        el.textContent = '▼ ' + Math.abs(delta);
        el.className = 'pos-delta visible delta-down';
      } else {
        el.textContent = '';
        el.className = 'pos-delta delta-same';
      }
    });
    // Update player highlight: 0=blue(same), 1=green(ahead), 2=red(behind), 3=gold(P1)
    if (window.setLBHighlightMode) {
      if (pos === 1) {
        window.setLBHighlightMode(3);
      } else if (_startPosition > 0 && pos > 0) {
        if (pos < _startPosition) window.setLBHighlightMode(1);      // ahead of start
        else if (pos > _startPosition) window.setLBHighlightMode(2); // behind start
        else window.setLBHighlightMode(0);                           // same as start
      } else {
        window.setLBHighlightMode(0);
      }
    }

    // ─── Race Timer + Last Lap + End-of-Race Logic ───
    const sessionTime = +d('DataCorePlugin.GameData.SessionTimeSpan', 'Demo.SessionTime') || 0;
    const lastLapTime = +d('DataCorePlugin.GameData.LastLapTime', 'Demo.LastLapTime') || 0;
    const remTime = +d('DataCorePlugin.GameData.RemainingTime', 'Demo.RemainingTime') || 0;
    const totalLaps = +d('DataCorePlugin.GameData.TotalLaps', 'Demo.TotalLaps') || 0;
    const remLaps = +d('DataCorePlugin.GameData.RemainingLaps', 'Demo.RemainingLaps') || 0;
    const timerEl = document.getElementById('raceTimerValue');
    const timerRow = document.querySelector('.timer-row');
    // Determine if this is a lap-limited race (not timed)
    const isLapRace = totalLaps > 0 && totalLaps <= 9999 && !(+(p[dsPre + 'IsTimedRace']) > 0);
    if (timerEl) {
      if (isLapRace && remLaps >= 0) {
        // Lap-limited race: show remaining laps instead of time
        if (remLaps === 1) timerEl.textContent = 'Final Lap';
        else if (remLaps === 0) timerEl.textContent = 'Finish';
        else timerEl.textContent = remLaps + (remLaps === 1 ? ' Lap' : ' Laps');
      } else {
        // Timed race: show remaining time
        const serverFmt = p[dsPre + 'RemainingTimeFormatted'] || '';
        if (serverFmt) {
          timerEl.textContent = serverFmt;
        } else {
          const displayTime = remTime > 0 ? remTime : sessionTime;
          if (displayTime > 0) {
            const h = Math.floor(displayTime / 3600);
            const m = Math.floor((displayTime % 3600) / 60);
            const s = Math.floor(displayTime % 60);
            timerEl.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
          } else {
            timerEl.textContent = '0:00:00';
          }
        }
      }
    }
    const lastLapEl = document.getElementById('lastLapTimeValue');
    if (lastLapEl) { lastLapEl.textContent = fmtLap(lastLapTime); }

    // Detect lap change → show timer block + force position page
    if (lap > 0 && lap !== _prevLap && _prevLap > 0 && timerRow) {
      timerRow.classList.add('timer-visible');
      showPositionPage();
      // Clear any pending hide
      if (_timerHideTimeout) clearTimeout(_timerHideTimeout);
      // Auto-hide after 30s unless pinned for end-of-race
      if (!_timerPinned) {
        _timerHideTimeout = setTimeout(() => {
          if (!_timerPinned) timerRow.classList.remove('timer-visible');
        }, 30000);
      }
    }
    // ── Lap validity: detect incidents added during this lap ──
    const _incCount = +(p[dsPre + 'IncidentCount']) || 0;
    if (lap > 0 && lap !== _prevLap) {
      _lapStartIncidents = _incCount;
      _lapInvalid = false;
    }
    if (_incCount > _lapStartIncidents) _lapInvalid = true;

    _prevLap = lap;

    // End-of-race: pin timer visible for final 3 laps or final 5 minutes
    const serverEndOfRace = +(p[dsPre + 'IsEndOfRace']) > 0;  // checkered flag
    const isEndOfRace = serverEndOfRace || (isLapRace
      ? (remLaps > 0 && remLaps <= 3)     // final 3 laps for lap races
      : (remTime > 0 && remTime <= 300)); // final 5 minutes for timed races
    if (isEndOfRace && timerRow) {
      _timerPinned = true;
      showPositionPage();
      if (_timerHideTimeout) { clearTimeout(_timerHideTimeout); _timerHideTimeout = null; }
      timerRow.classList.add('timer-visible');
    } else if (_timerPinned && !isEndOfRace) {
      _timerPinned = false; // race ended or data reset
    }

    // ─── iRating / Safety ───
    // Priority: manual entry (always wins when set) → telemetry
    let ir = window._manualIRating > 0 ? window._manualIRating
      : (_demo ? (+v('K10Motorsports.Plugin.Demo.IRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0));
    let sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (_demo ? (+v('K10Motorsports.Plugin.Demo.SafetyRating') || 0) : (+v('IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0));
    _hasRatingData = (ir > 0 || sr > 0);
    const ratVals = document.querySelectorAll('.rating-value');
    if (ratVals.length >= 2) { ratVals[0].textContent = ir > 0 ? ir : '—'; ratVals[1].textContent = sr > 0 ? sr.toFixed(2) : '—'; }
    updateIRBar(ir);
    updateSRPie(sr);

    // ─── Estimated iRating Delta ───
    // Fix #3: Server sends int.MinValue (-2147483648) as sentinel for "no data".
    // Distinguish that from an actual delta of 0 (perfectly average finish).
    const irDeltaRaw = +(p[dsPre + 'EstimatedIRatingDelta']);
    const IR_NO_DATA = -2147483648;
    const irDeltaHasData = !isNaN(irDeltaRaw) && irDeltaRaw !== IR_NO_DATA;
    const irDelta = irDeltaHasData ? irDeltaRaw : 0;
    window._lastIRDelta = irDelta; // expose for driver profile modal
    const ratDeltas = document.querySelectorAll('.rating-delta');
    if (ratDeltas.length >= 1) {
      const el = ratDeltas[0];
      if (irDeltaHasData && ir > 0) {
        el.textContent = (irDelta > 0 ? '+' : '') + irDelta;
        el.className = 'rating-delta ' + (irDelta > 0 ? 'positive' : irDelta < 0 ? 'negative' : 'neutral');
      } else {
        el.textContent = '—';
        el.className = 'rating-delta';
      }
    }
    // SR delta: show manual license letter if set, otherwise derive from SR value
    if (ratDeltas.length >= 2) {
      const srEl = ratDeltas[1];
      const lic = window._manualLicense || '';
      if (lic) {
        srEl.textContent = lic === 'R' ? 'R' : lic === 'P' ? 'Pro' : lic;
        srEl.className = 'rating-delta';
      } else if (sr > 0) {
        srEl.textContent = sr >= 3.0 ? 'A' : sr >= 2.0 ? 'B' : sr >= 1.0 ? 'C' : 'D';
        srEl.className = 'rating-delta';
      } else {
        srEl.textContent = '—';
        srEl.className = 'rating-delta';
      }
    }

    // ─── Gaps / Lap Timing ───
    // Prefer server-computed DS.IsNonRaceSession, fallback to client-side string check
    const nonRace = +(p[dsPre + 'IsNonRaceSession']) > 0 || _isNonRaceSession(
      _demo ? (p['K10Motorsports.Plugin.Demo.SessionTypeName'] || '')
            : (p['K10Motorsports.Plugin.SessionTypeName'] || ''));

    const gapLabels = document.querySelectorAll('.gaps-block .panel-label');
    const gapTimes = document.querySelectorAll('.gap-time');
    const gapDrivers = document.querySelectorAll('.gap-driver');
    const gapIRs = document.querySelectorAll('.gap-ir');
    const gapItems = document.querySelectorAll('.gap-item');

    if (nonRace) {
      // ── Non-race: show F1-style sector indicator (data from plugin SectorTracker) ──
      const sectorEl = document.getElementById('sectorIndicator');
      const gapAhead = document.getElementById('gapAheadItem');
      const gapBehind = document.getElementById('gapBehindItem');
      if (sectorEl) sectorEl.style.display = '';
      if (gapAhead) gapAhead.style.display = 'none';
      if (gapBehind) gapBehind.style.display = 'none';

      const curSector = +(p[dsPre + 'CurrentSector']) || 1;
      const lapDelta = +(p[dsPre + 'LapDelta']) || 0;
      const sectorCount = 3; // Always 3 sectors, equal thirds — matches CrewChief

      // Build sector arrays from plugin data
      const splits = [+(p[dsPre + 'SectorSplitS1']) || 0, +(p[dsPre + 'SectorSplitS2']) || 0, +(p[dsPre + 'SectorSplitS3']) || 0];
      const deltas = [+(p[dsPre + 'SectorDeltaS1']) || 0, +(p[dsPre + 'SectorDeltaS2']) || 0, +(p[dsPre + 'SectorDeltaS3']) || 0];
      const states = [+(p[dsPre + 'SectorStateS1']) || 0, +(p[dsPre + 'SectorStateS2']) || 0, +(p[dsPre + 'SectorStateS3']) || 0];
      // state: 0=none, 1=pb (session best / purple), 2=faster (green), 3=slower (yellow)
      const stateClass = ['', 'sector-pb', 'sector-faster', 'sector-slower'];

      // Store for track map sector coloring + boundaries for path splitting
      window._sectorData = { curSector, splits, deltas, states, sectorCount };
      // Equal thirds boundaries for track map
      window._sectorBoundaries = [1/3, 2/3];

      // Read current lap time for live sector elapsed
      const currentLapTime = _demo
        ? (+(p['K10Motorsports.Plugin.Demo.CurrentLapTime']) || 0)
        : (+(p['DataCorePlugin.GameData.CurrentLapTime']) || 0);

      // ── Dynamic sector cell management ──
      // Ensure sectorIndicator has the right number of cells
      if (sectorEl) {
        const existing = sectorEl.querySelectorAll('.sector-cell');
        if (existing.length !== sectorCount) {
          sectorEl.innerHTML = '';
          for (let i = 1; i <= sectorCount; i++) {
            const cell = document.createElement('div');
            cell.className = 'sector-cell';
            cell.id = 'sector' + i;
            cell.innerHTML = '<div class="sector-label">S' + i + '</div>' +
              '<div class="sector-time" id="sector' + i + 'Time">—</div>' +
              '<div class="sector-delta" id="sector' + i + 'Delta"></div>';
            sectorEl.appendChild(cell);
          }
        }
      }

      for (let si = 1; si <= sectorCount; si++) {
        const cell = document.getElementById('sector' + si);
        const timeEl = document.getElementById('sector' + si + 'Time');
        const deltaEl = document.getElementById('sector' + si + 'Delta');
        if (!cell || !timeEl) continue;

        cell.classList.remove('sector-pb', 'sector-faster', 'sector-slower', 'sector-invalid', 'sector-active');

        // If lap is invalid (incident occurred), mark all sectors red
        if (_lapInvalid) {
          cell.classList.add('sector-invalid');
        }

        if (si === curSector) {
          // Active sector: show running sector elapsed time, delta below
          cell.classList.add('sector-active');
          // Calculate sector entry time from completed previous sectors
          let entryTime = 0;
          let hasPrevSplits = true;
          for (let k = 0; k < si - 1; k++) {
            if (!splits[k] || splits[k] <= 0) { hasPrevSplits = false; break; }
            entryTime += splits[k];
          }
          // Only show sector elapsed if we have valid entry time data
          // Otherwise show dash to avoid displaying the full lap time
          if (hasPrevSplits && currentLapTime > entryTime) {
            const elapsed = currentLapTime - entryTime;
            const em = Math.floor(elapsed / 60);
            const es = elapsed % 60;
            timeEl.textContent = (em > 0 ? em + ':' : '') + (em > 0 && es < 10 ? '0' : '') + es.toFixed(1);
          } else if (si === 1 && currentLapTime > 0 && currentLapTime < 120) {
            // S1 is always valid since entry = lap start (time 0)
            const em = Math.floor(currentLapTime / 60);
            const es = currentLapTime % 60;
            timeEl.textContent = (em > 0 ? em + ':' : '') + (em > 0 && es < 10 ? '0' : '') + es.toFixed(1);
          } else {
            timeEl.textContent = '—';
          }
          if (deltaEl) {
            if (lapDelta !== 0) {
              deltaEl.textContent = (lapDelta >= 0 ? '+' : '') + lapDelta.toFixed(2);
              if (!_lapInvalid) cell.classList.add(lapDelta < 0 ? 'sector-faster' : 'sector-slower');
            } else {
              deltaEl.textContent = '';
            }
          }
        } else if (splits[si - 1] > 0) {
          // Completed sector: show sector time + delta to my best.
          // Multi-layered sanity check: iRacing sometimes sends the
          // cumulative lap time as the final sector split. We must
          // never display a full lap time inside a sector cell.
          const split = splits[si - 1];
          let sumOtherSplits = 0;
          let otherSplitCount = 0;
          for (let k = 0; k < sectorCount; k++) {
            if (k !== si - 1 && splits[k] > 0) {
              sumOtherSplits += splits[k];
              otherSplitCount++;
            }
          }
          // Check 1: split >= sum of all other known sectors (original check)
          const exceedsOthers = sumOtherSplits > 0 && split >= sumOtherSplits;
          // Check 2: split >= 85% of best lap — no single sector should be
          // that large relative to the full lap
          const exceedsBestLap = bestLap > 0 && split >= bestLap * 0.85;
          // Check 3: last sector with no other splits populated yet —
          // this is the classic case where iRacing sends cumulative time
          // before the earlier sectors are filled in.
          // BUT: in qualifying, iRacing clears previous sectors on lap cross
          // right as the final split arrives. Use _prevSectorSplits to avoid
          // false positives — if the previous poll had other sectors filled,
          // this is a real split, not a cumulative time.
          let prevOtherCount = 0;
          for (let k = 0; k < _prevSectorSplits.length; k++) {
            if (k !== si - 1 && _prevSectorSplits[k] > 0) prevOtherCount++;
          }
          const lastSectorNoContext = si === sectorCount && sectorCount >= 2
            && otherSplitCount === 0 && prevOtherCount === 0;
          const looksLikeFullLap = exceedsOthers || exceedsBestLap || lastSectorNoContext;
          if (looksLikeFullLap) {
            // Suppress — never show a full lap time inside a sector cell
            timeEl.textContent = '—';
            if (deltaEl) deltaEl.textContent = '';
          } else {
            const m = Math.floor(split / 60);
            const s = (split % 60);
            timeEl.textContent = (m > 0 ? m + ':' : '') + (m > 0 && s < 10 ? '0' : '') + s.toFixed(1);
            if (!_lapInvalid && stateClass[states[si - 1]]) cell.classList.add(stateClass[states[si - 1]]);
            if (deltaEl) {
              const d = deltas[si - 1];
              if (d !== 0) deltaEl.textContent = (d >= 0 ? '+' : '') + d.toFixed(2);
              else if (states[si - 1] === 1) deltaEl.textContent = 'PB';
              else deltaEl.textContent = '';
            }
          }
        } else {
          timeEl.textContent = '—';
          if (deltaEl) deltaEl.textContent = '';
        }
      }

      // Cache this poll's splits so next poll can distinguish a real final
      // sector from a bogus cumulative time (iRacing clears splits on lap cross)
      _prevSectorSplits = splits.slice();

      _gapsNonRaceMode = true;
    } else {
      // ── Race: show ahead / behind gaps ──
      if (_gapsNonRaceMode) {
        // Restore gaps, hide sectors
        if (gapLabels.length >= 2) { gapLabels[0].textContent = 'Ahead'; gapLabels[1].textContent = 'Behind'; }
        const sectorEl = document.getElementById('sectorIndicator');
        const gapAhead = document.getElementById('gapAheadItem');
        const gapBehind = document.getElementById('gapBehindItem');
        if (sectorEl) sectorEl.style.display = 'none';
        if (gapAhead) gapAhead.style.display = '';
        if (gapBehind) gapBehind.style.display = '';
        // Clear sector map highlights (dynamic N-sector support)
        window._sectorData = null;
        const mapSectorEls = document.querySelectorAll('.map-sector');
        mapSectorEls.forEach(el => el.setAttribute('stroke', 'transparent'));
        _gapsNonRaceMode = false;
        _gapsWorstLap = 0;
        _gapsLastLap = 0;
      }
      const gAhead  = _demo ? (+v('K10Motorsports.Plugin.Demo.GapAhead') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0);
      const gBehind = _demo ? (+v('K10Motorsports.Plugin.Demo.GapBehind') || 0) : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_Gap') || 0);
      const dAhead  = _demo ? vs('K10Motorsports.Plugin.Demo.DriverAhead')  : vs('IRacingExtraProperties.iRacing_Opponent_Ahead_Name');
      const dBehind = _demo ? vs('K10Motorsports.Plugin.Demo.DriverBehind') : vs('IRacingExtraProperties.iRacing_Opponent_Behind_Name');
      const irA     = _demo ? (+v('K10Motorsports.Plugin.Demo.IRAhead') || 0)   : (+v('IRacingExtraProperties.iRacing_Opponent_Ahead_IRating') || 0);
      const irB     = _demo ? (+v('K10Motorsports.Plugin.Demo.IRBehind') || 0)  : (+v('IRacingExtraProperties.iRacing_Opponent_Behind_IRating') || 0);
      if (gapTimes.length >= 2) { gapTimes[0].textContent = (gAhead && Math.abs(gAhead) >= 0.05) ? fmtGap(-Math.abs(gAhead)) : '—'; gapTimes[1].textContent = (gBehind && Math.abs(gBehind) >= 0.05) ? fmtGap(Math.abs(gBehind)) : '—'; }
      if (gapDrivers.length >= 2) { gapDrivers[0].textContent = dAhead || '—'; gapDrivers[1].textContent = dBehind || '—'; }
      if (gapIRs.length >= 2) { gapIRs[0].textContent = irA > 0 ? irA + ' iR' : ''; gapIRs[1].textContent = irB > 0 ? irB + ' iR' : ''; }
      if (gapItems.length >= 2) {
        if (dAhead !== _lastDriverAhead && _lastDriverAhead) flashElement(gapItems[0], 'ahead-changed');
        if (dBehind !== _lastDriverBehind && _lastDriverBehind) flashElement(gapItems[1], 'behind-changed');
      }
      _lastDriverAhead = dAhead; _lastDriverBehind = dBehind;
    }

    // ─── Flag Status → Gaps Block ───
    const rawFlag = (_forceFlagState && _demo) ? _forceFlagState : (vs('currentFlagState') || 'none');
    const flagState = (!rawFlag || rawFlag === '0' || rawFlag === 0) ? 'none' : rawFlag;
    const gapsBlock = document.getElementById('gapsBlock');
    if (gapsBlock) {
      const flagLabels = { yellow: 'CAUTION', red: 'RED FLAG', blue: 'BLUE FLAG', white: 'LAST LAP', debris: 'DEBRIS', checkered: 'FINISH', black: 'BLACK FLAG', green: 'GREEN', meatball: 'MEATBALL', orange: 'LAPPED CAR' };
      const flagContexts = { yellow: 'Full course caution — hold position', red: 'Session stopped — return to pits', blue: 'Faster car approaching — yield', white: 'Last lap — push to the line', debris: 'Debris on track — stay alert', checkered: 'Checkered flag — race complete', black: 'Penalty — report to pit lane', green: 'Green flag — racing resumes', meatball: 'Repair required — pit immediately', orange: 'Car ahead must yield — make the pass' };

      // Minimum hold durations per flag type (ms) — prevents flicker from rapid state changes
      const FLAG_HOLD_MS = { yellow: 8000, red: 10000, blue: 4000, white: 6000, debris: 5000, checkered: 10000, black: 8000, green: 5000, meatball: 10000, orange: 4000 };

      let showFlag = flagState;
      const now = Date.now();

      // When a new flag appears, set minimum hold time
      if (flagState !== 'none' && flagState !== _flagHoldState) {
        _flagHoldState = flagState;
        _flagHoldUntil = now + (FLAG_HOLD_MS[flagState] || 5000);
      }

      // Green flag: show briefly when transitioning from caution, then clear
      if (flagState === 'green' && _lastFlagState !== 'green' && _lastFlagState !== 'none') {
        if (_greenFlagTimeout) clearTimeout(_greenFlagTimeout);
        _greenFlagTimeout = setTimeout(() => {
          const gb = document.getElementById('gapsBlock');
          if (gb) gb.className = gb.className.replace(/\bflag-\S+/g, '').trim() + ' panel gaps-block';
          if (window.setFlagGLColors) window.setFlagGLColors(null);
          _greenFlagTimeout = null;
          _flagHoldState = 'none';
        }, FLAG_HOLD_MS.green);
      } else if (flagState === 'green' && !_greenFlagTimeout) {
        showFlag = 'none'; // green with no active timer = steady state, don't show
      } else if (flagState === 'none') {
        // Flag cleared — but hold the overlay if minimum duration hasn't elapsed
        if (now < _flagHoldUntil && _flagHoldState !== 'none') {
          showFlag = _flagHoldState; // keep showing previous flag
        } else {
          if (_greenFlagTimeout) { clearTimeout(_greenFlagTimeout); _greenFlagTimeout = null; }
          showFlag = 'none';
          _flagHoldState = 'none';
        }
      }

      // Remove all flag-* classes
      gapsBlock.className = gapsBlock.className.replace(/\bflag-\S+/g, '').trim();
      if (showFlag !== 'none') {
        gapsBlock.classList.add('flag-active', 'flag-' + showFlag);
        const lbl = flagLabels[showFlag] || showFlag.toUpperCase();
        const ctx = flagContexts[showFlag] || '';
        const fl1 = document.getElementById('flagLabel1');
        const fc1 = document.getElementById('flagCtx1');
        if (fl1) fl1.textContent = lbl;
        if (fc1) fc1.textContent = ctx;
        // Set WebGL flag icon colors
        if (window.setFlagGLColors) window.setFlagGLColors(showFlag);
      } else {
        if (window.setFlagGLColors) window.setFlagGLColors(null);
      }
      // ── Race Control banner — only for critical events ──
      // Minor flags (blue, white, green, debris) are handled by the flag module on the gaps block.
      // Race Control only fires for session-altering events: red, black, yellow (full course), checkered.
      const RC_FLAGS = { red: true, black: true, yellow: true, checkered: true, meatball: true };
      if (flagState !== _lastFlagState) {
        if (RC_FLAGS[flagState]) {
          showRaceControl(flagState);
        }
        // Only hide RC banner when flag hold has also expired — don't yank it early
        else if ((flagState === 'none' || !RC_FLAGS[flagState]) && now >= _flagHoldUntil) {
          hideRaceControl();
        }
      }

      // ── Leaderboard event animations for race start / finish ──
      if (flagState !== _lastFlagState && window.triggerLBEvent) {
        // Green flag transition from non-green = race start (or restart)
        if (flagState === 'green' && _lastFlagState !== 'green' && _lastFlagState !== 'none') {
          window.triggerLBEvent('green');
        }
        // Checkered flag = race finish
        if (flagState === 'checkered' && _lastFlagState !== 'checkered') {
          window.triggerLBEvent('finish');
        }
      }
      _lastFlagState = flagState;
      // Expose for ambient-light.js polled color source
      window._currentFlagState = flagState;
    }

    // ─── Ambient light — feed screen color from C# plugin ───
    {
      const ambHas = +v('K10Motorsports.Plugin.DS.AmbientHasData') || 0;
      if (ambHas && typeof window.updateAmbientFromPoll === 'function') {
        const ambR = +v('K10Motorsports.Plugin.DS.AmbientR') || 0;
        const ambG = +v('K10Motorsports.Plugin.DS.AmbientG') || 0;
        const ambB = +v('K10Motorsports.Plugin.DS.AmbientB') || 0;
        window.updateAmbientFromPoll(ambR, ambG, ambB);
      }
    }

    // ─── Commentary ───
    const cmVis = +v('K10Motorsports.Plugin.CommentaryVisible') || 0;
    if (cmVis && !_commentaryWasVisible) {
      const cmTopicId = vs('K10Motorsports.Plugin.CommentaryTopicId');
      // In pit lane: only allow pit-related commentary through
      const pitAllowedTopics = ['pit_entry', 'low_fuel', 'tyre_wear_high'];
      const suppressInPit = _inPitLane && !pitAllowedTopics.includes(cmTopicId);
      if (!suppressInPit) {
        const hue = colorToHue(vs('K10Motorsports.Plugin.CommentarySentimentColor'));
        const severity = +v('K10Motorsports.Plugin.CommentarySeverity') || 0;
        const trackImg = vs('K10Motorsports.Plugin.CommentaryTrackImage') || '';
        const carImg = vs('K10Motorsports.Plugin.CommentaryCarImage') || '';
        const commentaryImg = trackImg || carImg;  // track image takes priority, car image as fallback
        showCommentary(hue, vs('K10Motorsports.Plugin.CommentaryTopicTitle'), vs('K10Motorsports.Plugin.CommentaryText'), vs('K10Motorsports.Plugin.CommentaryCategory'), cmTopicId, severity, commentaryImg);
      }
    } else if (!cmVis && _commentaryWasVisible) {
      hideCommentary();
    }
    _commentaryWasVisible = !!cmVis;

    // ─── Strategy calls (displayed via commentary panel with amber hue) ───
    var stVis = +v('K10Motorsports.Plugin.Strategy.Visible') || 0;
    if (stVis && !_strategyWasVisible && !cmVis) {
      // Show strategy call through the commentary panel with amber hue (45)
      var stLabel = vs('K10Motorsports.Plugin.Strategy.Label') || 'STRATEGY';
      var stText  = vs('K10Motorsports.Plugin.Strategy.Text') || '';
      var stSev   = +v('K10Motorsports.Plugin.Strategy.Severity') || 1;
      if (stText) {
        showCommentary(45, stLabel, stText, 'strategy', 'strategy_call', stSev);
      }
    } else if (!stVis && _strategyWasVisible && !cmVis) {
      hideCommentary();
    }
    _strategyWasVisible = !!stVis;

    // ─── Commentary visualization data feed ───
    if (cmVis && window.updateCommentaryVizData) {
      window.updateCommentaryVizData({
        brake: brk,
        throttle: thr,
        rpmRatio: rpmRatio,
        speed: speed,
        brakeBias: bb,
        tc: +(tc || 0),
        abs: +(abs || 0),
        fuelPct: fuelPct,
        lapDelta: +(v(dsPre + 'LapDelta') || 0),
        gapAhead: _demo ? +(v('K10Motorsports.Plugin.Demo.GapAhead') || 0) : +(v('IRacingExtraProperties.iRacing_Opponent_Ahead_Gap') || 0),
        latG: +(v(dsPre + 'LatG') || 0),
        longG: +(v(dsPre + 'LongG') || 0),
        steerTorque: +(v(dsPre + 'SteerTorque') || 0),
        position: pos,
        prevPosition: _vizSnapPrevPos || 0,
        startPosition: _startPosition || 0,
        totalCars: +(v(sessionPre + 'TotalCars')) || 0,
        incidents: +(v(dsPre + 'IncidentCount') || 0),
        incidentLimitPenalty: +(v(dsPre + 'IncidentLimitPenalty') || 0),
        incidentLimitDQ: +(v(dsPre + 'IncidentLimitDQ') || 0),
        lap: lap,
        sessionTime: vs('DataCorePlugin.GameData.RemainingTime') || '',
        trackTemp: +(v(dsPre + 'TrackTemp') || 0),
        tyreTemps: _demo
          ? [+v('K10Motorsports.Plugin.Demo.TyreTempFL'), +v('K10Motorsports.Plugin.Demo.TyreTempFR'), +v('K10Motorsports.Plugin.Demo.TyreTempRL'), +v('K10Motorsports.Plugin.Demo.TyreTempRR')]
          : [+v('DataCorePlugin.GameData.TyreTempFrontLeft'), +v('DataCorePlugin.GameData.TyreTempFrontRight'), +v('DataCorePlugin.GameData.TyreTempRearLeft'), +v('DataCorePlugin.GameData.TyreTempRearRight')],
        tyreWears: _demo
          ? [(1 - (+v('K10Motorsports.Plugin.Demo.TyreWearFL') || 0)) * 100, (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearFR') || 0)) * 100, (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearRL') || 0)) * 100, (1 - (+v('K10Motorsports.Plugin.Demo.TyreWearRR') || 0)) * 100]
          : [(p['DataCorePlugin.GameData.TyreWearFrontLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontLeft']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearFrontRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearFrontRight']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearRearLeft'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearLeft']) * 100 : 100), (p['DataCorePlugin.GameData.TyreWearRearRight'] != null ? (1 - +p['DataCorePlugin.GameData.TyreWearRearRight']) * 100 : 100)]
      });
    }

    // ─── Driver display name (for leaderboard) ───
    const dfn = vs('K10Motorsports.Plugin.DriverFirstName') || '';
    const dln = vs('K10Motorsports.Plugin.DriverLastName') || '';
    if (dfn || dln) {
      _driverDisplayName = (dfn && dln) ? dfn.charAt(0) + '. ' + dln : (dfn || dln);
    }
    // Zoom map label: first initial + last name, fallback "Local"
    const _zoomLbl = document.getElementById('zoomMapLabel');
    if (_zoomLbl) {
      _zoomLbl.textContent = (dfn && dln) ? dfn.charAt(0) + '. ' + dln : (dln || 'Local');
    }

    // ─── Track map ───
    const mapReady = +v('K10Motorsports.Plugin.TrackMap.Ready') || 0;
    const mapPath = mapReady ? (vs('K10Motorsports.Plugin.TrackMap.SvgPath') || '') : '';
    const mapPX   = +v('K10Motorsports.Plugin.TrackMap.PlayerX') || 50;
    const mapPY   = +v('K10Motorsports.Plugin.TrackMap.PlayerY') || 50;
    const mapOpp  = vs('K10Motorsports.Plugin.TrackMap.Opponents') || '';
    const mapHeading = +v('K10Motorsports.Plugin.TrackMap.PlayerHeading') || 0;
    // Use plugin path if available; show no track when map isn't ready
    updateTrackMap(mapPath, mapPX, mapPY, mapOpp, speed, mapHeading);
    // Full map label: show display name (from K10 API) or fall back to game name
    const fullMapLbl = document.getElementById('fullMapLabel');
    if (fullMapLbl) {
      const trackName = vs('K10Motorsports.Plugin.TrackMap.TrackName')
                     || vs('DataCorePlugin.GameData.TrackName')
                     || '';
      if (trackName) {
        const resolved = _trackDisplayNameCache[trackName];
        if (resolved) {
          if (resolved !== fullMapLbl.textContent) fullMapLbl.textContent = resolved;
        } else {
          // Show game name immediately, then upgrade if K10 returns a display name
          if (trackName !== fullMapLbl.textContent) fullMapLbl.textContent = trackName;
          resolveTrackDisplayName(trackName);
        }
      }
    }

    // ─── Datastream ───
    try { updateDatastream(p, _demo); } catch(e) { console.error('[K10] Datastream error:', e); }

    // ─── Pit Box ───
    try { updatePitBox(p); } catch(e) { console.error('[K10] PitBox error:', e); }

    // ─── Incidents ───
    try { updateIncidents(p, _demo); } catch(e) { console.error('[K10] Incidents error:', e); }

    // ─── Leaderboard ───
    try { updateLeaderboard(p); } catch(e) { console.error('[K10] Leaderboard error:', e); }

    // ─── Pit Limiter ───
    try { updatePitLimiter(p, _demo); } catch(e) { console.error('[K10] Pit limiter error:', e); }

    // ─── Race End Screen ───
    try {
      const isCheckered = flagState === 'checkered';
      if (isCheckered && !_prevCheckered) {
        showRaceEnd(p, _demo);
        // Capture session end for sync
        if (typeof window.captureSessionEnd === 'function') {
          window.captureSessionEnd(p, _demo);
        }
      } else if (!isCheckered && _prevCheckered && _raceEndVisible) {
        hideRaceEnd();
      }
      _prevCheckered = isCheckered;
    } catch(e) { console.error('[K10] Race end error:', e); }

    // ─── Grid / Formation ───
    try { updateGrid(p, _demo); } catch(e) { console.error('[K10] Grid error:', e); }

    // ─── Spotter (disabled in pit lane — no close racing alerts) ───
    try { if (!_inPitLane) updateSpotter(p, _demo); } catch(e) { console.error('[K10] Spotter error:', e); }

    // ─── Tire / Track Condition Mismatch ───
    try { if (typeof checkTyreMismatch === 'function' && !_inPitLane) checkTyreMismatch(p, _demo); } catch(e) { console.error('[K10] Tire mismatch check error:', e); }

    // ─── Race Timeline ───
    try {
      const rtIncidents = +(v('K10Motorsports.Plugin.DS.IncidentCount')) || 0;
      const rtInPit = +(v('K10Motorsports.Plugin.DS.IsInPitLane')) > 0;
      updateRaceTimeline(pos, lap, flagState, rtIncidents, rtInPit);
    } catch(e) { console.error('[K10] Timeline error:', e); }

    // ─── Cycling timer (wall-clock, independent of render rate) ───
    // Suppress cycling while timer row is visible — keep position page showing
    const _timerShowing = timerRow && timerRow.classList.contains('timer-visible');
    // Asymmetric cycle: 60s on position page, 15s on rating page
    const _now = Date.now();
    if (!_cycleLastSwitch) _cycleLastSwitch = _now;
    const _onRatingPage = window._isRatingPageActive ? window._isRatingPageActive() : false;
    const _cycleTargetMs = _onRatingPage ? 15000 : 60000;
    if (_now - _cycleLastSwitch >= _cycleTargetMs) { _cycleLastSwitch = _now; if (!_timerShowing) cycleRatingPos(); }

    // ─── FPS counter (game API framerate, not browser) ───
    setApiFps(+v('DataCorePlugin.GameRawData.Telemetry.FrameRate') || 0);
    updateFps();

    // ─── Drive HUD ───
    try { if (window.updateDriveHud) window.updateDriveHud(p, !!_demo); } catch(e) { console.error('[K10] Drive HUD error:', e); }

    } catch (err) {
      console.error('[K10 render] Error in frame #' + _pollFrame + ':', err);
    }
  }

  // ─── Start polling ───
  // Always poll the plugin's HTTP API (port 8889) for telemetry data.
  // This works in all contexts: SimHub DashTemplate overlay, standalone browser,
  // OBS Browser Source, or any web view. The plugin's HTTP server serves all
  // telemetry, demo, commentary, and track map data as a single JSON blob.
  // Load external assets before starting the poll loop
  Promise.all([loadCarLogos(), loadCountryFlags()]).then(() => {
    console.log('[K10 Motorsports] Assets loaded, polling SimHub HTTP API at ' + SIMHUB_URL);

    // Initialize logo cycling (before we connect, the logos will cycle to be visible)
    _logoCycleTimer = setInterval(() => {
      if (!_hasEverConnected) cycleCarLogo();
    }, 3000);
    setCarLogo(carLogoOrder[0], _demoModels[carLogoOrder[0]]);

    // Settings and Discord state are loaded by connections.js on script load

    // Start polling
    const _pollIntervalId = setInterval(pollUpdate, POLL_MS);
    window.addEventListener('beforeunload', function() {
      clearInterval(_pollIntervalId);
    });
  });

  // ═══════════════════════════════════════════════════════════════
