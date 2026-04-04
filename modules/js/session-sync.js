/**
 * ─────────────────────────────────────────────────────────────
 * Session Sync: Pro Drive data pipeline
 * ─────────────────────────────────────────────────────────────
 * Manages telemetry and user state synchronization with Pro Drive.
 *
 * Hooks (called by poll-engine.js):
 *   captureSessionStart(p, isDemo)  — snapshot pre-race state
 *   captureSessionEnd(p, isDemo)    — collect finish data and POST to /api/sessions
 *   initialRatingSync(p, isDemo)    — one-time baseline rating push
 */

(function() {
  'use strict';

  var API_BASE = 'https://prodrive.racecor.io';

  // ─── Session Sync State ───
  var _syncEnabled = false;
  var _initialSyncDone = false;

  // Race session tracking
  var _sessionStartSnapshot = null;   // Captured at session start
  var _sessionSubmitted = false;      // Prevent double-submit per race

  /**
   * Enable/disable session sync.
   * When disabled, reset the initial sync flag to allow re-sync if re-enabled.
   */
  window.setSessionSyncEnabled = function(enabled) {
    _syncEnabled = !!enabled;
    if (!enabled) {
      _initialSyncDone = false;
    }
    console.log('[Session Sync]', _syncEnabled ? 'enabled' : 'disabled');
  };

  /**
   * Get bearer token from local storage.
   * @returns {string|null} Bearer token or null if not set.
   */
  function _getToken() {
    try {
      var stored = localStorage.getItem('k10_auth_token');
      return stored || null;
    } catch (e) {
      console.warn('[Session Sync] Could not read auth token:', e);
      return null;
    }
  }

  /**
   * Helper: extract a value from the poll snapshot.
   */
  function _v(p, key) {
    return p[key] != null ? p[key] : 0;
  }
  function _vs(p, key) {
    return p[key] != null ? '' + p[key] : '';
  }

  // ═══════════════════════════════════════════════════════════════
  //  SESSION START — snapshot pre-race state
  // ═══════════════════════════════════════════════════════════════

  window.captureSessionStart = function(p, isDemo) {
    if (!_syncEnabled || !window._k10User) return;

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // iRating / SR — prefer manual entry, then telemetry
    var ir = window._manualIRating > 0 ? window._manualIRating
      : (isDemo ? +_v(p, pre + 'IRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);
    var sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +_v(p, pre + 'SafetyRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);

    var license = window._manualLicense
      || _vs(p, 'IRacingExtraProperties.iRacing_DriverInfo_LicString') || '';

    _sessionStartSnapshot = {
      preRaceIRating: ir,
      preRaceSR: sr,
      preRaceLicense: license || 'R',
      carModel: _vs(p, 'DataCorePlugin.GameData.CarModel') || _vs(p, pre + 'CarModel') || 'Unknown',
      trackName: _vs(p, 'RaceCorProDrive.Plugin.TrackMap.TrackName')
        || _vs(p, 'DataCorePlugin.GameData.TrackName') || 'Unknown',
      sessionType: _vs(p, pre + 'SessionTypeName') || 'road',
      gameId: _vs(p, 'IRacingExtraProperties.iRacing_SessionInfo_SessionID') || '',
      startedAt: new Date().toISOString(),
      startPosition: +_v(p, 'DataCorePlugin.GameData.Position') || 0,
      startIncidents: +_v(p, dsPre + 'IncidentCount') || 0
    };
    _sessionSubmitted = false;

    console.log('[Session Sync] Session start captured:', _sessionStartSnapshot.carModel,
      '@', _sessionStartSnapshot.trackName, '| iR:', _sessionStartSnapshot.preRaceIRating);
  };

  // ═══════════════════════════════════════════════════════════════
  //  SESSION END — collect finish data and POST to /api/sessions
  // ═══════════════════════════════════════════════════════════════

  window.captureSessionEnd = function(p, isDemo) {
    if (!_syncEnabled || !window._k10User) return;
    if (_sessionSubmitted) return;  // Already sent for this race
    if (!_sessionStartSnapshot) {
      console.warn('[Session Sync] No start snapshot — skipping session end');
      return;
    }

    var token = _getToken();
    if (!token) {
      console.warn('[Session Sync] No auth token — cannot submit session');
      return;
    }

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';
    var dsPre = isDemo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';

    // Collect finish data from current telemetry
    var finishPosition = +_v(p, 'DataCorePlugin.GameData.Position') || 0;
    var completedLaps = +_v(p, dsPre + 'CompletedLaps')
      || +_v(p, 'DataCorePlugin.GameData.CompletedLaps') || 0;
    var totalLaps = +_v(p, 'DataCorePlugin.GameData.TotalLaps') || 0;
    var bestLapTime = +_v(p, 'DataCorePlugin.GameData.BestLapTime') || 0;
    var incidentCount = +_v(p, dsPre + 'IncidentCount') || 0;

    // Calculate incident delta from session start
    var incidentDelta = incidentCount - (_sessionStartSnapshot.startIncidents || 0);
    if (incidentDelta < 0) incidentDelta = incidentCount; // Reset protection

    // Post-race iRating for estimated delta
    var postIR = isDemo ? +_v(p, pre + 'IRating') || 0
      : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0;
    var estimatedDelta = postIR > 0 && _sessionStartSnapshot.preRaceIRating > 0
      ? postIR - _sessionStartSnapshot.preRaceIRating : 0;

    var payload = {
      preRaceIRating: _sessionStartSnapshot.preRaceIRating,
      preRaceSR: _sessionStartSnapshot.preRaceSR,
      preRaceLicense: _sessionStartSnapshot.preRaceLicense,
      carModel: _sessionStartSnapshot.carModel,
      trackName: _sessionStartSnapshot.trackName,
      sessionType: _sessionStartSnapshot.sessionType,
      gameId: _sessionStartSnapshot.gameId,
      finishPosition: finishPosition,
      incidentCount: incidentDelta,
      completedLaps: completedLaps,
      totalLaps: totalLaps,
      bestLapTime: bestLapTime,
      estimatedIRatingDelta: estimatedDelta,
      startedAt: _sessionStartSnapshot.startedAt,
      finishedAt: new Date().toISOString()
    };

    _sessionSubmitted = true;

    console.log('[Session Sync] Submitting session:', 'P' + finishPosition,
      completedLaps + '/' + totalLaps + ' laps',
      incidentDelta + 'x', 'ΔiR:', estimatedDelta);

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Session submission: P' + finishPosition + ' - ' + completedLaps + '/' + totalLaps + ' laps, ' + incidentDelta + 'x incidents');
    }

    fetch(API_BASE + '/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (r.ok) {
        return r.json().then(function(data) {
          console.log('[Session Sync] Session submitted successfully:', data.sessionId);
          if (window.debugConsole) {
            window.debugConsole.logIRacingSync('success', 'Session recorded with ID: ' + data.sessionId);
          }
          // Store for backfill when next session starts
          window._lastSubmittedSessionId = data.sessionId;
        });
      } else {
        console.warn('[Session Sync] Session submit failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', 'Session submit failed: ' + r.status, { statusCode: r.status });
        }
        _sessionSubmitted = false; // Allow retry
      }
    })
    .catch(function(e) {
      console.error('[Session Sync] Session submit error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Session submit error: ' + (e.message || String(e)));
      }
      _sessionSubmitted = false; // Allow retry
    });
  };

  // ═══════════════════════════════════════════════════════════════
  //  BACKFILL — update previous session with actual rating deltas
  //  Called from captureSessionStart when we have new ratings
  // ═══════════════════════════════════════════════════════════════

  function _backfillPreviousSession(p, isDemo) {
    if (!window._lastSubmittedSessionId) return;

    var token = _getToken();
    if (!token) return;

    var pre = isDemo ? 'RaceCorProDrive.Plugin.Demo.' : 'RaceCorProDrive.Plugin.';

    // Current ratings are the post-race ratings of the previous session
    var postIR = window._manualIRating > 0 ? window._manualIRating
      : (isDemo ? +_v(p, pre + 'IRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);
    var postSR = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +_v(p, pre + 'SafetyRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);

    if (postIR <= 0 && postSR <= 0) return;

    // Calculate actual deltas from stored start snapshot
    var prevStart = _sessionStartSnapshot;
    var actualIRDelta = prevStart && prevStart.preRaceIRating > 0
      ? postIR - prevStart.preRaceIRating : 0;
    var actualSRDelta = prevStart && prevStart.preRaceSR > 0
      ? postSR - prevStart.preRaceSR : 0;

    console.log('[Session Sync] Backfilling previous session with actual deltas:',
      'ΔiR:', actualIRDelta, 'ΔSR:', actualSRDelta);

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Backfill: ΔiR=' + actualIRDelta + ', ΔSR=' + actualSRDelta);
    }

    fetch(API_BASE + '/api/sessions/backfill', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        actualIRatingDelta: actualIRDelta,
        actualSRDelta: actualSRDelta,
        postRaceIRating: postIR,
        postRaceSR: postSR
      })
    })
    .then(function(r) {
      if (r.ok) {
        console.log('[Session Sync] Backfill successful');
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('success', 'Backfill completed with actual rating deltas');
        }
        window._lastSubmittedSessionId = null; // Clear after backfill
      }
    })
    .catch(function(e) {
      console.error('[Session Sync] Backfill error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Backfill error: ' + (e.message || String(e)));
      }
    });
  }

  // Wrap captureSessionStart to also trigger backfill
  var _origCaptureStart = window.captureSessionStart;
  window.captureSessionStart = function(p, isDemo) {
    // Backfill previous session with actual deltas before starting new one
    _backfillPreviousSession(p, isDemo);
    // Then capture the new session start
    _origCaptureStart(p, isDemo);
  };

  // ═══════════════════════════════════════════════════════════════
  //  INITIAL RATING SYNC — one-time baseline
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initial Rating Backfill
   * ─────────────────────────────────────────────────────────
   * One-time snapshot of current ratings when plugin first connects to Pro Drive.
   * Gives the dashboard a baseline before the first recorded race.
   */
  window.initialRatingSync = function(p, isDemo) {
    // Only run once per session
    if (_initialSyncDone) return;

    // Only if sync is enabled and user is logged in to Pro Drive
    if (!_syncEnabled || !window._k10User) return;

    // Extract iRating from either manual entry or telemetry
    var ir = window._manualIRating > 0 ? window._manualIRating
      : (isDemo ? +_v(p, 'RaceCorProDrive.Plugin.Demo.IRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_IRating') || 0);

    // Extract SafetyRating from either manual entry or telemetry
    var sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +_v(p, 'RaceCorProDrive.Plugin.Demo.SafetyRating') || 0
                : +_v(p, 'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating') || 0);

    // Only sync if we actually have rating data
    if (ir <= 0 && sr <= 0) return;

    var license = window._manualLicense || '';
    var token = _getToken();
    if (!token) return;

    _initialSyncDone = true;

    if (window.debugConsole) {
      window.debugConsole.logIRacingSync('info', 'Initial rating sync - iR: ' + ir + ', SR: ' + sr + ', License: ' + (license || 'R'));
    }

    fetch(API_BASE + '/api/ratings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        category: 'road',  // Default; will be overridden by actual data when available
        iRating: ir,
        safetyRating: sr,
        license: license || 'R'
      })
    })
    .then(function(r) {
      if (r.ok) {
        console.log('[Session Sync] Initial rating baseline synced:', ir, sr);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('success', 'Initial rating baseline recorded');
        }
      } else {
        console.warn('[Session Sync] Initial sync failed:', r.status);
        if (window.debugConsole) {
          window.debugConsole.logIRacingSync('error', 'Initial sync failed: ' + r.status, { statusCode: r.status });
        }
      }
    })
    .catch(function(e) {
      _initialSyncDone = false; // Allow retry on error
      console.error('[Session Sync] Initial sync error:', e);
      if (window.debugConsole) {
        window.debugConsole.logIRacingSync('error', 'Initial sync error: ' + (e.message || String(e)));
      }
    });
  };

  // ═══════════════════════════════════════════════════════════════
  //  iRACING HISTORY IMPORT — reads cookies from local iRacing app
  // ═══════════════════════════════════════════════════════════════

  var PLUGIN_BASE = 'http://localhost:8889/racecor-io-pro-drive/';

  /**
   * Trigger a full iRacing career history import.
   *
   * Flow:
   *   1. Overlay calls the SimHub plugin at localhost:8889 with ?action=iracingImport
   *   2. Plugin reads cookies from the locally running iRacing app
   *   3. Plugin fetches career data from members-ng.iracing.com using those cookies
   *   4. Plugin returns the data to us
   *   5. We POST the data to Pro Drive web API for permanent storage
   *
   * @returns {Promise<object|null>} Import result or null on failure
   */
  window.triggerIRacingImport = function() {
    var token = _getToken();
    if (!token) {
      console.warn('[Session Sync] No auth token — cannot sync to Pro Drive');
      return Promise.resolve(null);
    }

    console.log('[Session Sync] Step 1: Fetching iRacing career data from local plugin...');

    // Step 1: Ask the plugin to fetch career data using local iRacing cookies
    return fetch(PLUGIN_BASE + '?action=iracingImport')
    .then(function(r) { return r.json(); })
    .then(function(pluginResult) {
      if (!pluginResult.ok) {
        console.warn('[Session Sync] Plugin iRacing fetch failed:', pluginResult.error);
        return null;
      }

      var careerData = pluginResult.data;
      console.log('[Session Sync] Step 2: Got career data for',
        careerData.displayName, '(#' + careerData.custId + ')',
        '— sending to Pro Drive...');

      // Step 2: Push the career data to Pro Drive web API
      return fetch(API_BASE + '/api/iracing/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(careerData)
      })
      .then(function(r) {
        if (r.ok) {
          return r.json().then(function(data) {
            console.log('[Session Sync] iRacing import complete:',
              data.imported.sessions + ' sessions,',
              data.imported.historyPoints + ' history points');
            return data;
          });
        } else {
          return r.json().then(function(err) {
            console.warn('[Session Sync] Pro Drive import failed:', err.error);
            return null;
          });
        }
      });
    })
    .catch(function(e) {
      console.error('[Session Sync] iRacing import error:', e);
      return null;
    });
  };

  /**
   * Authenticate with iRacing using email/password (through the local plugin).
   * @param {string} email - iRacing account email
   * @param {string} password - iRacing account password
   * @returns {Promise<boolean>} true if authentication succeeded
   */
  window.authenticateIRacing = function(email, password) {
    return fetch(PLUGIN_BASE + '?action=iracingAuth&email='
      + encodeURIComponent(email) + '&password=' + encodeURIComponent(password))
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.ok) {
        console.log('[Session Sync] iRacing authenticated successfully');
        return true;
      }
      console.warn('[Session Sync] iRacing auth failed:', result.error);
      return false;
    })
    .catch(function(e) {
      console.error('[Session Sync] iRacing auth error:', e);
      return false;
    });
  };

  /**
   * Check iRacing authentication status via the local plugin.
   * @returns {Promise<object|null>} Status object or null
   */
  window.checkIRacingStatus = function() {
    return fetch(PLUGIN_BASE + '?action=iracingStatus')
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
  };

})();
