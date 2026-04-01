// Session Sync — captures start/end snapshots and syncs to RaceCor.io Pro Drive
(function() {
  'use strict';

  // ── State ──
  var _sessionSnapshot = null;    // Start-of-session data
  var _lastSessionId = null;      // Track which session we're in
  var _syncEnabled = false;       // User consent toggle
  var _iracingDataSyncEnabled = false; // iRacing between-session polling consent

  // ── Session Start Snapshot ──
  // Called when a new session is detected (session type changes)
  window.captureSessionStart = function(p, isDemo) {
    var dsPre = isDemo ? 'K10Motorsports.Plugin.Demo.DS.' : 'K10Motorsports.Plugin.DS.';
    var pre = isDemo ? 'K10Motorsports.Plugin.Demo.' : '';

    _sessionSnapshot = {
      capturedAt: new Date().toISOString(),
      iRating: window._manualIRating > 0 ? window._manualIRating
        : (isDemo ? +(p['K10Motorsports.Plugin.Demo.IRating']) || 0
                  : +(p['IRacingExtraProperties.iRacing_DriverInfo_IRating']) || 0),
      safetyRating: window._manualSafetyRating > 0 ? window._manualSafetyRating
        : (isDemo ? +(p['K10Motorsports.Plugin.Demo.SafetyRating']) || 0
                  : +(p['IRacingExtraProperties.iRacing_DriverInfo_SafetyRating']) || 0),
      license: window._manualLicense || '',
      carModel: isDemo ? (p[pre + 'Demo.CarModel'] || '') : (p['DataCorePlugin.GameData.CarModel'] || ''),
      trackName: p['K10Motorsports.Plugin.TrackMap.TrackName'] || p['DataCorePlugin.GameData.TrackName'] || '',
      sessionType: isDemo ? (p[pre + 'Demo.SessionTypeName'] || '') : (p['K10Motorsports.Plugin.SessionTypeName'] || ''),
      gameId: p['K10Motorsports.Plugin.GameId'] || ''
    };

    // Backfill: if we have a previous session pending, update its actual delta
    _backfillPreviousSession();

    console.log('[K10 Sync] Session start captured:', _sessionSnapshot);
  };

  // ── Session End Snapshot ──
  // Called when checkered flag is detected
  window.captureSessionEnd = function(p, isDemo) {
    if (!_sessionSnapshot) {
      console.warn('[K10 Sync] No start snapshot — skipping end capture');
      return;
    }
    if (!_syncEnabled || !window._k10User) {
      console.log('[K10 Sync] Sync not enabled or not connected — skipping');
      return;
    }

    var dsPre = isDemo ? 'K10Motorsports.Plugin.Demo.DS.' : 'K10Motorsports.Plugin.DS.';
    var pos = isDemo ? +(p['K10Motorsports.Plugin.Demo.Position']) || 0 : +(p['DataCorePlugin.GameData.Position']) || 0;
    var incidents = +(p[dsPre + 'IncidentCount']) || 0;
    var completedLaps = +(p[dsPre + 'CompletedLaps']) || 0;
    var totalLaps = isDemo ? +(p['K10Motorsports.Plugin.Demo.TotalLaps']) || 0 : +(p['DataCorePlugin.GameData.TotalLaps']) || 0;
    var bestLap = isDemo ? +(p['K10Motorsports.Plugin.Demo.BestLapTime']) || 0 : +(p['DataCorePlugin.GameData.BestLapTime']) || 0;

    // Estimated iRating delta
    var irDeltaRaw = +(p[dsPre + 'EstimatedIRatingDelta']);
    var IR_NO_DATA = -2147483648;
    var estimatedDelta = (!isNaN(irDeltaRaw) && irDeltaRaw !== IR_NO_DATA) ? irDeltaRaw : null;

    var sessionRecord = {
      // Start snapshot
      preRaceIRating: _sessionSnapshot.iRating,
      preRaceSR: _sessionSnapshot.safetyRating,
      preRaceLicense: _sessionSnapshot.license,
      carModel: _sessionSnapshot.carModel,
      trackName: _sessionSnapshot.trackName,
      sessionType: _sessionSnapshot.sessionType,
      gameId: _sessionSnapshot.gameId,
      startedAt: _sessionSnapshot.capturedAt,
      // End snapshot
      finishPosition: pos,
      incidentCount: incidents,
      completedLaps: completedLaps,
      totalLaps: totalLaps,
      bestLapTime: bestLap > 0 ? bestLap : null,
      estimatedIRatingDelta: estimatedDelta,
      finishedAt: new Date().toISOString()
    };

    _postSessionRecord(sessionRecord);

    // Store for backfill
    try {
      localStorage.setItem('k10_pending_backfill', JSON.stringify({
        finishedAt: sessionRecord.finishedAt,
        preRaceIRating: sessionRecord.preRaceIRating,
        preRaceSR: sessionRecord.preRaceSR
      }));
    } catch(e) {}

    _sessionSnapshot = null;
    console.log('[K10 Sync] Session end captured and posted');
  };

  // ── POST to API ──
  function _postSessionRecord(record) {
    var token = _getToken();
    if (!token) return;

    fetch('https://drive.racecor.io/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(record)
    })
    .then(function(r) {
      if (!r.ok) console.warn('[K10 Sync] POST failed:', r.status);
      else console.log('[K10 Sync] Session synced successfully');
      return r.json();
    })
    .catch(function(e) { console.error('[K10 Sync] POST error:', e); });
  }

  // ── Backfill previous session's actual delta ──
  function _backfillPreviousSession() {
    try {
      var pending = localStorage.getItem('k10_pending_backfill');
      if (!pending) return;
      var data = JSON.parse(pending);
      var token = _getToken();
      if (!token || !_sessionSnapshot) return;

      // Current session start ratings are the post-race ratings from previous session
      var actualIRatingDelta = _sessionSnapshot.iRating - data.preRaceIRating;
      var actualSRDelta = _sessionSnapshot.safetyRating - data.preRaceSR;

      // Only backfill if the deltas are reasonable (not a different account, etc.)
      if (Math.abs(actualIRatingDelta) > 500) {
        localStorage.removeItem('k10_pending_backfill');
        return;
      }

      fetch('https://drive.racecor.io/api/sessions/backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          finishedAt: data.finishedAt,
          actualIRatingDelta: actualIRatingDelta,
          actualSRDelta: actualSRDelta,
          postRaceIRating: _sessionSnapshot.iRating,
          postRaceSR: _sessionSnapshot.safetyRating
        })
      })
      .then(function() { localStorage.removeItem('k10_pending_backfill'); })
      .catch(function() {});
    } catch(e) {}
  }

  // ── Get auth token ──
  function _getToken() {
    if (window._settings && window._settings.k10AccessToken) return window._settings.k10AccessToken;
    if (window.k10 && window.k10.getAccessToken) {
      // Electron IPC sync-ish
      try { return window.k10.getAccessToken(); } catch(e) {}
    }
    return null;
  }

  // ── Settings ──
  window.setSessionSyncEnabled = function(enabled) {
    _syncEnabled = enabled;
  };

  window.setIRacingDataSyncEnabled = function(enabled) {
    _iracingDataSyncEnabled = enabled;
  };

  window.isSessionSyncEnabled = function() { return _syncEnabled; };
  window.isIRacingDataSyncEnabled = function() { return _iracingDataSyncEnabled; };
})();
