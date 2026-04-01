/**
 * ─────────────────────────────────────────────────────────────
 * Session Sync: Pro Drive data pipeline
 * ─────────────────────────────────────────────────────────────
 * Manages telemetry and user state synchronization with Pro Drive.
 */

(function() {
  'use strict';

  // ─── Session Sync State ───
  let _syncEnabled = false;
  let _initialSyncDone = false;

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
      const stored = localStorage.getItem('k10_auth_token');
      return stored || null;
    } catch (e) {
      console.warn('[Session Sync] Could not read auth token:', e);
      return null;
    }
  }

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
      : (isDemo ? +(p['K10Motorsports.Plugin.Demo.IRating']) || 0
                : +(p['IRacingExtraProperties.iRacing_DriverInfo_IRating']) || 0);

    // Extract SafetyRating from either manual entry or telemetry
    var sr = window._manualSafetyRating > 0 ? window._manualSafetyRating
      : (isDemo ? +(p['K10Motorsports.Plugin.Demo.SafetyRating']) || 0
                : +(p['IRacingExtraProperties.iRacing_DriverInfo_SafetyRating']) || 0);

    // Only sync if we actually have rating data
    if (ir <= 0 && sr <= 0) return;

    var license = window._manualLicense || '';
    var token = _getToken();
    if (!token) return;

    _initialSyncDone = true;

    fetch('https://prodrive.racecor.io/api/ratings', {
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
        console.log('[K10 Sync] Initial rating baseline synced:', ir, sr);
      } else {
        console.warn('[K10 Sync] Initial sync failed:', r.status);
      }
    })
    .catch(function(e) {
      _initialSyncDone = false; // Allow retry on error
      console.error('[K10 Sync] Initial sync error:', e);
    });
  };

})();
