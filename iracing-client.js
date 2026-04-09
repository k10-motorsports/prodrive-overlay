// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — iRacing Data Client
// Opens an embedded browser for iRacing OAuth login, intercepts
// the bearer token, then fetches career data from the Data API
// using Node.js https directly.
// ═══════════════════════════════════════════════════════════════

const { BrowserWindow, session, app } = require('electron');
const EventEmitter = require('events');
const https = require('https');
const path  = require('path');
const fs    = require('fs');

const TAG = '[K10 iRacing]';

// iRacing endpoints
const IRACING_DATA_BASE  = 'https://members-ng.iracing.com/data';
const IRACING_DATA_HOST  = 'members-ng.iracing.com';
const AUTH_CHECK_INTERVAL = 2000;  // poll every 2s to detect token
const AUTH_TIMEOUT        = 300000; // 5 min max for user to log in

// Category IDs: 1=oval, 2=road, 3=dirt_oval, 4=dirt_road, 5=sports_car
const CATEGORIES = [1, 2, 3, 4, 5];
const CATEGORY_NAMES = { 1: 'oval', 2: 'road', 3: 'dirt_oval', 4: 'dirt_road', 5: 'sports_car' };

// ── Persistence ──────────────────────────────────────────────

function getDataPath() {
  return path.join(app.getPath('userData'), 'iracing-data.json');
}

function getStatusPath() {
  return path.join(app.getPath('userData'), 'iracing-status.json');
}

function getTokenPath() {
  return path.join(app.getPath('userData'), 'iracing-token.json');
}

function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync(getStatusPath(), 'utf8'));
  } catch (e) {
    return { connected: false, lastSync: null, custId: null, displayName: null };
  }
}

function saveStatus(status) {
  fs.writeFileSync(getStatusPath(), JSON.stringify(status, null, 2));
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(getDataPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveData(data) {
  fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2));
}

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(getTokenPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveToken(tokenData) {
  fs.writeFileSync(getTokenPath(), JSON.stringify(tokenData, null, 2));
}


// ── Module state ─────────────────────────────────────────────

const emitter  = new EventEmitter();
let _loginWin  = null;
let _authTimer = null;
let _authTimeout = null;
let _bearerToken = null;  // captured OAuth bearer token
let _bffCalls = [];       // BFF requests captured by Electron's webRequest

// ── Logging (emitted so main.js can forward to renderer + log file) ──
function log(msg) {
  const line = `${TAG} ${msg}`;
  console.log(line);  // main process stdout (if available)
  emitter.emit('log', line);
}


// ── Node.js HTTPS helpers ────────────────────────────────────

/**
 * Make an authenticated GET request to iRacing's Data API.
 * Returns parsed JSON.
 */
function httpsGetJson(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error(`Auth failed (${res.statusCode})`));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Fetch a URL that returns raw JSON (for signed S3 links).
 * No auth header needed — the URL itself is pre-signed.
 */
function httpsGetRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects (S3 sometimes returns 302)
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGetRaw(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from link: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}


// ── Data API fetch — two modes ───────────────────────────────

/**
 * Fetch via Node.js with bearer token (if we ever capture one).
 */
async function fetchIRacingEndpoint(token, endpoint) {
  const url = IRACING_DATA_BASE + endpoint;
  log(`Fetching ${endpoint}`);

  const envelope = await httpsGetJson(url, token);
  if (!envelope.link) return envelope;
  return await httpsGetRaw(envelope.link);
}

/**
 * Fetch via executeJavaScript inside an authenticated webContents.
 * The web client uses a BFF (Backend For Frontend) proxy at /bff/pub/proxy/api/
 * which accepts cookie auth and proxies to the underlying data API.
 * Direct /data/* calls require bearer tokens (which we don't have).
 *
 * Path mapping: iRacing data API "/data/member/info" → BFF "/bff/pub/proxy/api/member/info"
 * (the /data/ prefix is stripped; the /api/ segment is part of the BFF route)
 */
async function fetchViaWebContents(wc, endpoint) {
  // Route through the BFF proxy — it accepts cookie auth.
  // We try multiple path patterns because the BFF mapping isn't fully documented:
  //   1. /bff/pub/proxy/api{endpoint}         — observed pattern (e.g. /bff/pub/proxy/api/sessions)
  //   2. /bff/pub/proxy/api/data{endpoint}     — if BFF preserves the /data/ prefix
  //   3. /bff/pub/proxy{endpoint}              — original guess (no /api segment)
  const candidates = [
    '/bff/pub/proxy/api' + endpoint,
    '/bff/pub/proxy/api/data' + endpoint,
    '/bff/pub/proxy' + endpoint,
  ];

  let envelope = null;
  let lastError = null;

  for (const bffPath of candidates) {
    log(`Trying ${bffPath} ...`);

    const result = await wc.executeJavaScript(`
      (async () => {
        try {
          const res = await fetch('${bffPath}', { credentials: 'same-origin' });
          if (!res.ok) return { _error: res.status + ' ' + res.statusText, _status: res.status };
          return await res.json();
        } catch (e) {
          return { _error: e.message };
        }
      })()
    `);

    if (result._error) {
      // 404 = wrong path, try next candidate. Other errors = stop.
      if (result._status === 404) {
        log(`  → 404 on ${bffPath}, trying next pattern...`);
        lastError = result._error;
        continue;
      }
      // Non-404 error — don't keep trying
      throw new Error(endpoint + ': ' + result._error);
    }

    log(`  → Success on ${bffPath}`);
    envelope = result;
    break;
  }

  if (!envelope) throw new Error(endpoint + ': all BFF paths returned 404 (' + lastError + ')');
  if (!envelope.link) return envelope;

  // Follow the signed S3 link (no auth needed, pre-signed URL)
  const data = await wc.executeJavaScript(`
    (async () => {
      try {
        const res = await fetch(${JSON.stringify(envelope.link)});
        if (!res.ok) return { _error: res.status + ' ' + res.statusText };
        return await res.json();
      } catch (e) {
        return { _error: e.message };
      }
    })()
  `);

  if (data._error) throw new Error(endpoint + ' (link): ' + data._error);
  return data;
}


// ── Data sync ────────────────────────────────────────────────

/**
 * Fetch all career data using a bearer token.
 * Returns the assembled payload and saves it locally.
 */
async function syncAllData(token) {
  log(`Starting full data sync...`);

  // 1. Member info (get custId)
  const memberInfo = await fetchIRacingEndpoint(token, '/member/info');
  const custId = memberInfo.cust_id;
  const displayName = memberInfo.display_name;
  log(`Member: ${displayName} (${custId})`);

  // 2. Recent races
  const recentRaces = await fetchIRacingEndpoint(
    token,
    `/stats/member_recent_races?cust_id=${custId}`
  );

  // 3. Career summary
  const careerSummary = await fetchIRacingEndpoint(
    token,
    `/stats/member_summary?cust_id=${custId}`
  );

  // 4. Chart data — iRating + SR for all 5 categories
  const chartData = {};
  for (const catId of CATEGORIES) {
    const catName = CATEGORY_NAMES[catId];
    try {
      const irating = await fetchIRacingEndpoint(
        token,
        `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=1`
      );
      const sr = await fetchIRacingEndpoint(
        token,
        `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=3`
      );
      chartData[catName] = { irating, sr };
    } catch (e) {
      log(`No chart data for ${catName}: ${e.message}`);
      chartData[catName] = { irating: [], sr: [] };
    }
  }

  // 5. Yearly stats
  let yearlyStats = null;
  try {
    yearlyStats = await fetchIRacingEndpoint(
      token,
      `/stats/member_yearly?cust_id=${custId}`
    );
  } catch (e) {
    log(`Yearly stats unavailable: ${e.message}`);
  }

  // Assemble payload (matches the shape our import endpoints expect)
  const payload = {
    custId,
    displayName,
    recentRaces: recentRaces.races || recentRaces,
    careerSummary: careerSummary.stats || careerSummary,
    chartData,
    yearlyStats,
    exportedAt: new Date().toISOString(),
    source: 'electron-iracing-client',
  };

  // Save locally
  saveData(payload);
  saveStatus({
    connected: true,
    lastSync: payload.exportedAt,
    custId,
    displayName,
  });

  log(`Sync complete: ${(payload.recentRaces || []).length} recent races`);
  emitter.emit('sync-complete', payload);

  return { success: true, ...payload };
}

/**
 * Same as syncAllData but uses webContents cookie-based fetch.
 */
async function syncAllDataViaWebContents(wc) {
  log('Starting full data sync (cookie-based)...');

  const memberInfo = await fetchViaWebContents(wc, '/member/info');
  const custId = memberInfo.cust_id;
  const displayName = memberInfo.display_name;
  log(`Member: ${displayName} (${custId})`);

  const recentRaces = await fetchViaWebContents(wc, `/stats/member_recent_races?cust_id=${custId}`);
  const careerSummary = await fetchViaWebContents(wc, `/stats/member_summary?cust_id=${custId}`);

  const chartData = {};
  for (const catId of CATEGORIES) {
    const catName = CATEGORY_NAMES[catId];
    try {
      const irating = await fetchViaWebContents(wc, `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=1`);
      const sr = await fetchViaWebContents(wc, `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=3`);
      chartData[catName] = { irating, sr };
    } catch (e) {
      log(`No chart data for ${catName}: ${e.message}`);
      chartData[catName] = { irating: [], sr: [] };
    }
  }

  let yearlyStats = null;
  try {
    yearlyStats = await fetchViaWebContents(wc, `/stats/member_yearly?cust_id=${custId}`);
  } catch (e) {
    log(`Yearly stats unavailable: ${e.message}`);
  }

  const payload = {
    custId,
    displayName,
    recentRaces: recentRaces.races || recentRaces,
    careerSummary: careerSummary.stats || careerSummary,
    chartData,
    yearlyStats,
    exportedAt: new Date().toISOString(),
    source: 'electron-iracing-client',
  };

  saveData(payload);
  saveStatus({ connected: true, lastSync: payload.exportedAt, custId, displayName });

  log(`Sync complete: ${(payload.recentRaces || []).length} recent races`);
  emitter.emit('sync-complete', payload);

  return { success: true, ...payload };
}


// ── Login window + token interception ────────────────────────

function createLoginWindow() {
  const iracingSession = session.fromPartition('persist:iracing');

  // ── Intercept ALL requests to any iRacing domain ──
  // Log everything so we can see how the web client authenticates.
  // Capture bearer tokens if we see them.
  let _loggedUrls = new Set();  // deduplicate noisy repeated requests
  iracingSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.iracing.com/*', '*://iracing.com/*'] },
    (details, callback) => {
      const urlObj = new URL(details.url);
      const host = urlObj.hostname;
      const pathname = urlObj.pathname;
      const authHeader = details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];

      // Log requests to the data API (members-ng) — these are the ones we care about
      if (host === 'members-ng.iracing.com') {
        const headerNames = Object.keys(details.requestHeaders).join(', ');
        // Only log each unique path once to avoid spam
        const logKey = details.method + ' ' + pathname;
        if (!_loggedUrls.has(logKey)) {
          _loggedUrls.add(logKey);
          log(`[NET] → ${details.method} ${host}${pathname} headers=[${headerNames}]`);
        }
      }

      if (authHeader) {
        log(`[NET] → ${host}${pathname} Auth: ${authHeader.slice(0, 40)}...`);
        if (authHeader.startsWith('Bearer ') && !_bearerToken) {
          _bearerToken = authHeader.replace('Bearer ', '');
          log(`*** BEARER TOKEN CAPTURED! (${_bearerToken.slice(0, 16)}...) ***`);
          saveToken({ token: _bearerToken, capturedAt: new Date().toISOString() });
        }
      }

      callback({ requestHeaders: details.requestHeaders });
    }
  );

  // Also watch response headers for tokens or cookies
  iracingSession.webRequest.onHeadersReceived(
    { urls: ['*://*.iracing.com/*', '*://iracing.com/*'] },
    (details, callback) => {
      const host = new URL(details.url).hostname;

      // Check for auth-related response headers
      if (details.responseHeaders) {
        const setCookie = details.responseHeaders['set-cookie'] || details.responseHeaders['Set-Cookie'];
        if (setCookie) {
          const cookieNames = setCookie.map(c => c.split('=')[0]).join(', ');
          log(`[NET] ← ${host} Set-Cookie: ${cookieNames}`);
        }

        // Some APIs return tokens in custom headers
        const authInfo = details.responseHeaders['x-auth-token'] || details.responseHeaders['X-Auth-Token'];
        if (authInfo) {
          log(`[NET] ← ${host} X-Auth-Token found`);
        }
      }

      callback({ responseHeaders: details.responseHeaders });
    }
  );

  // Log completed BFF requests with status codes (catches requests even if the
  // in-page fetch spy wasn't injected yet). Also collect them into _bffCalls
  // so auth polling can detect when the web client is authenticated.
  _bffCalls = [];  // reset on each new login window
  iracingSession.webRequest.onCompleted(
    { urls: ['*://members-ng.iracing.com/bff/*'] },
    (details) => {
      const pathname = new URL(details.url).pathname;
      log(`[BFF] ${details.method} ${pathname} → ${details.statusCode}`);
      _bffCalls.push({ method: details.method, path: pathname, status: details.statusCode, ts: Date.now() });
    }
  );

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a1a',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: 'persist:iracing',
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  // ── Keep all iRacing navigation inside this window ──
  // "Launch iRacing Web" and other links try to open in the system
  // browser. Intercept them and load in-place so we capture the tokens.
  win.webContents.setWindowOpenHandler(({ url }) => {
    log(`[NAV] Intercepted new-window: ${url}`);
    if (url.includes('iracing.com')) {
      // Load in our window instead of opening system browser
      win.loadURL(url);
      return { action: 'deny' };
    }
    // Allow non-iRacing URLs (e.g. help pages) to open externally
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    log(`[NAV] will-navigate: ${url}`);
  });

  // Inject API spy as early as possible (dom-ready fires before did-finish-load)
  // so we catch the Angular app's initial API calls.
  // Angular's HttpClient uses XMLHttpRequest (not fetch), so we patch BOTH.
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`
      (function() {
        if (window.__k10_fetch_spy) return;
        window.__k10_fetch_spy = true;
        window.__k10_bff_calls = [];

        // ── Patch fetch ──
        var _origFetch = window.fetch;
        window.fetch = function(input, init) {
          var url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
          var method = (init && init.method) ? init.method : 'GET';
          if (url.includes('/bff/')) {
            var entry = { method: method, url: url, ts: Date.now(), via: 'fetch' };
            window.__k10_bff_calls.push(entry);
            return _origFetch.apply(this, arguments).then(function(resp) {
              entry.status = resp.status;
              if (resp.ok) {
                var cloned = resp.clone();
                cloned.text().then(function(body) {
                  try { entry.body = JSON.parse(body); } catch(e) { entry.body = body.slice(0, 500); }
                }).catch(function() {});
              }
              return resp;
            });
          }
          return _origFetch.apply(this, arguments);
        };

        // ── Patch XMLHttpRequest ──
        var _origXHROpen = XMLHttpRequest.prototype.open;
        var _origXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url) {
          this.__k10_method = method;
          this.__k10_url = url;
          return _origXHROpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
          var xhr = this;
          var url = xhr.__k10_url || '';
          var method = xhr.__k10_method || 'GET';

          if (url.includes('/bff/')) {
            var entry = { method: method, url: url, ts: Date.now(), via: 'xhr' };
            window.__k10_bff_calls.push(entry);

            xhr.addEventListener('load', function() {
              entry.status = xhr.status;
              if (xhr.status >= 200 && xhr.status < 300) {
                try { entry.body = JSON.parse(xhr.responseText); } catch(e) { entry.body = (xhr.responseText || '').slice(0, 500); }
              }
            });
          }

          return _origXHRSend.apply(this, arguments);
        };

        console.log('[K10-SPY] API spy installed (fetch + XHR, dom-ready)');
      })();
    `).catch(() => {});
  });

  // Inject a draggable title bar + close button after page loads
  win.webContents.on('did-finish-load', () => {
    const currentUrl = win.webContents.getURL();
    log(`[NAV] Page loaded: ${currentUrl}`);

    win.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('k10-iracing-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'k10-iracing-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;background:#111;'
          + 'display:flex;align-items:center;justify-content:space-between;padding:0 12px;'
          + 'z-index:999999;-webkit-app-region:drag;font-family:system-ui,sans-serif;'
          + 'border-bottom:1px solid #333;';

        const title = document.createElement('span');
        title.textContent = 'iRacing Login — K10 Motorsports';
        title.style.cssText = 'color:#aaa;font-size:12px;font-weight:500;letter-spacing:0.5px;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:14px;'
          + 'cursor:pointer;-webkit-app-region:no-drag;padding:4px 8px;border-radius:4px;';
        closeBtn.onmouseenter = function() { this.style.background = '#333'; this.style.color = '#fff'; };
        closeBtn.onmouseleave = function() { this.style.background = 'none'; this.style.color = '#888'; };
        closeBtn.onclick = function() { window.close(); };

        bar.appendChild(title);
        bar.appendChild(closeBtn);
        document.body.prepend(bar);
        document.body.style.paddingTop = '32px';
      })();
    `).catch(() => { /* non-critical */ });

    // Note: API spy (fetch + XHR) already injected in dom-ready handler above.
  });

  return win;
}


/**
 * Open the iRacing login window.
 * We load the iRacing web app which uses OAuth — the user authenticates
 * through iRacing's own UI. The webRequest interceptor captures the
 * bearer token, and we use it for all subsequent API calls.
 */
function connect() {
  return new Promise((resolve, reject) => {
    if (_loginWin && !_loginWin.isDestroyed()) {
      _loginWin.focus();
      return resolve({ success: true, message: 'Login window already open' });
    }

    _bearerToken = null;  // reset any previous token
    _loginWin = createLoginWindow();

    // Load the iRacing web client directly on members-ng.iracing.com.
    // This is the modern racing dashboard — it talks to the data API
    // using session cookies, which our interceptor captures.
    // If not logged in, iRacing will redirect to their OAuth login page,
    // then back here after auth. The persist:iracing session remembers
    // cookies across app restarts so re-login is rarely needed.
    _loginWin.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard').catch((err) => {
      log('Failed to load iRacing: ' + err.message);
    });

    _loginWin.once('ready-to-show', () => {
      _loginWin.show();
    });

    _loginWin.on('closed', () => {
      clearAuthPolling();
      _loginWin = null;
      // Always resolve so the IPC reply is sent (never leave the promise hanging)
      resolve({ success: false, error: 'Login window closed' });
    });

    // Poll for auth: detect when we're on members-ng.iracing.com
    // and cookies allow data API access
    startAuthPolling(resolve);
  });
}


function startAuthPolling(resolve) {
  clearAuthPolling();

  let resolved = false;

  _authTimer = setInterval(async () => {
    if (resolved) return;
    if (!_loginWin || _loginWin.isDestroyed()) return;

    const wc = _loginWin.webContents;
    if (!wc || wc.isDestroyed()) return;

    const currentUrl = wc.getURL();

    // Option A: If we have a bearer token (from webRequest interceptor), use Node.js
    if (_bearerToken) {
      log('Bearer token available — trying Node.js API call...');
      clearAuthPolling();
      resolved = true;

      try {
        const syncResult = await syncAllData(_bearerToken);
        if (_loginWin && !_loginWin.isDestroyed()) { _loginWin.close(); _loginWin = null; }
        emitter.emit('auth-success', { custId: syncResult.custId, displayName: syncResult.displayName });
        resolve(syncResult);
      } catch (err) {
        log('Bearer token failed: ' + err.message);
        _bearerToken = null;
        resolved = false;
        startAuthPolling(resolve);
      }
      return;
    }

    // Option B: Check _bffCalls (Electron webRequest level — works regardless of
    // JS spy injection timing). If the web client has made successful BFF calls,
    // auth is confirmed and we know the endpoint paths.
    if (currentUrl.includes('members-ng.iracing.com')) {
      const successCalls = _bffCalls.filter(c => c.status >= 200 && c.status < 300);

      if (successCalls.length === 0) {
        // Also check for any BFF calls at all (might all be failing = not authed)
        if (_bffCalls.length > 0) {
          const statuses = _bffCalls.map(c => c.path + '→' + c.status).join(', ');
          log('BFF calls seen but none successful: ' + statuses);
        } else {
          log('Waiting for web client to make BFF calls...');
        }
        return;  // keep polling
      }

      // Auth is confirmed! Log what the web client called.
      log('Auth confirmed via ' + successCalls.length + ' successful BFF calls:');
      for (const c of _bffCalls) {
        log('  [BFF] ' + c.method + ' ' + c.path + ' → ' + c.status);
      }

      // Also try to get captured response bodies from the in-page spy
      try {
        const spyData = await wc.executeJavaScript(`
          (function() {
            var calls = window.__k10_bff_calls || [];
            return JSON.stringify(calls.map(function(c) {
              return { method: c.method, url: c.url, status: c.status, via: c.via,
                       bodyKeys: c.body ? Object.keys(c.body).slice(0, 20) : null,
                       bodySnippet: c.body ? JSON.stringify(c.body).slice(0, 300) : null };
            }));
          })()
        `);
        log('In-page spy data: ' + spyData);
      } catch (e) {
        log('In-page spy not available: ' + e.message);
      }

      // Auth is confirmed. Discover the BFF API surface before trying to sync.
      log('Cookie-based auth confirmed! Discovering BFF API endpoints...');
      clearAuthPolling();
      resolved = true;

      wc.executeJavaScript(`
        (function() {
          var t = document.querySelector('#k10-iracing-bar span');
          if (t) t.textContent = 'Discovering iRacing API...';
        })();
      `).catch(() => {});

      try {
        // Step 1: Fetch the known-good /sessions endpoint and log its structure
        const sessionsData = await wc.executeJavaScript(`
          (async () => {
            try {
              const res = await fetch('/bff/pub/proxy/api/sessions', { credentials: 'same-origin' });
              if (!res.ok) return { _error: res.status + ' ' + res.statusText };
              const json = await res.json();
              return { _keys: Object.keys(json), _snippet: JSON.stringify(json).slice(0, 1000), _full: json };
            } catch (e) {
              return { _error: e.message };
            }
          })()
        `);
        log('/sessions response keys: ' + JSON.stringify(sessionsData._keys));
        log('/sessions snippet: ' + sessionsData._snippet);

        // Step 2: Scan Angular JS bundles for all /bff/ endpoint paths
        const bffPaths = await wc.executeJavaScript(`
          (function() {
            var paths = new Set();
            // Search all script elements for BFF path strings
            var scripts = document.querySelectorAll('script[src]');
            var scriptUrls = [];
            for (var i = 0; i < scripts.length; i++) {
              scriptUrls.push(scripts[i].src);
            }

            // Also search inline scripts and the performance entries for JS bundles
            var perfEntries = performance.getEntriesByType('resource')
              .filter(function(e) { return e.name.includes('.js'); })
              .map(function(e) { return e.name; });

            return JSON.stringify({ scriptTags: scriptUrls.length, perfEntries: perfEntries.length });
          })()
        `);
        log('Page scripts: ' + bffPaths);

        // Step 3: Fetch JS source and grep for /bff/ patterns
        const bffEndpoints = await wc.executeJavaScript(`
          (async () => {
            try {
              // Fetch the main bundle and search for BFF paths
              var scripts = Array.from(document.querySelectorAll('script[src*="main"]'));
              var allPaths = [];
              for (var i = 0; i < scripts.length; i++) {
                var res = await fetch(scripts[i].src);
                var text = await res.text();
                // Look for BFF proxy patterns
                var matches = text.match(/\\/bff\\/[a-zA-Z0-9_/.-]+/g) || [];
                allPaths = allPaths.concat(matches);
                // Also look for API path patterns near "proxy"
                var proxyMatches = text.match(/proxy\\/api\\/[a-zA-Z0-9_/.-]+/g) || [];
                allPaths = allPaths.concat(proxyMatches.map(function(m) { return '/bff/pub/' + m; }));
                // Look for quoted API path segments
                var apiMatches = text.match(/["']\\/api\\/[a-zA-Z0-9_/.?=-]+["']/g) || [];
                allPaths = allPaths.concat(apiMatches.map(function(m) { return m.replace(/["']/g, ''); }));
              }
              // Also check other JS bundles
              var otherScripts = Array.from(document.querySelectorAll('script[src]'))
                .filter(function(s) { return !s.src.includes('main'); });
              for (var i = 0; i < otherScripts.length; i++) {
                try {
                  var res = await fetch(otherScripts[i].src);
                  var text = await res.text();
                  var matches = text.match(/\\/bff\\/[a-zA-Z0-9_/.-]+/g) || [];
                  allPaths = allPaths.concat(matches);
                  var apiMatches = text.match(/["']\\/api\\/[a-zA-Z0-9_/.?=-]+["']/g) || [];
                  allPaths = allPaths.concat(apiMatches.map(function(m) { return m.replace(/["']/g, ''); }));
                } catch(e) {}
              }
              // Deduplicate
              return JSON.stringify([...new Set(allPaths)]);
            } catch (e) {
              return JSON.stringify({ _error: e.message });
            }
          })()
        `);
        log('BFF endpoints found in JS source: ' + bffEndpoints);

        // Step 4: Deep scan — look for ALL API-like URLs in every JS bundle
        // (not just /bff/ — the data API might use a different base path)
        const deepScan = await wc.executeJavaScript(`
          (async () => {
            try {
              var allScripts = Array.from(document.querySelectorAll('script[src]'));
              var findings = {
                apiUrls: [],       // Full URLs containing 'api' or 'data'
                httpUrls: [],      // Any https:// URLs found in code
                wsUrls: [],        // WebSocket URLs
                servicePatterns: [] // Angular service/endpoint patterns
              };

              for (var i = 0; i < allScripts.length; i++) {
                try {
                  var res = await fetch(allScripts[i].src);
                  var text = await res.text();
                  var fname = allScripts[i].src.split('/').pop();

                  // Find all https:// URLs
                  var httpMatches = text.match(/https?:\\/\\/[a-zA-Z0-9._-]+\\.iracing\\.com[a-zA-Z0-9_/.?=&-]*/g) || [];
                  findings.httpUrls = findings.httpUrls.concat(httpMatches);

                  // Find WebSocket URLs
                  var wsMatches = text.match(/wss?:\\/\\/[a-zA-Z0-9._/-]+/g) || [];
                  findings.wsUrls = findings.wsUrls.concat(wsMatches);

                  // Find /data/ endpoint paths (the iRacing API pattern)
                  var dataMatches = text.match(/["']\\/data\\/[a-zA-Z0-9_/.?=&-]+["']/g) || [];
                  findings.apiUrls = findings.apiUrls.concat(dataMatches.map(function(m) { return m.replace(/["']/g, ''); }));

                  // Find Angular service injection patterns and HTTP calls
                  var httpClientMatches = text.match(/\\.(get|post|put|delete)\\s*\\(\\s*["'][^"']+["']/g) || [];
                  findings.servicePatterns = findings.servicePatterns.concat(
                    httpClientMatches.map(function(m) { return fname + ': ' + m; })
                  );

                  // Find environment/config URLs
                  var envMatches = text.match(/apiUrl['"\\s:]+["'][^"']+["']/gi) || [];
                  findings.servicePatterns = findings.servicePatterns.concat(
                    envMatches.map(function(m) { return fname + ': ' + m; })
                  );
                  var baseMatches = text.match(/baseUrl['"\\s:]+["'][^"']+["']/gi) || [];
                  findings.servicePatterns = findings.servicePatterns.concat(
                    baseMatches.map(function(m) { return fname + ': ' + m; })
                  );
                } catch(e) {}
              }

              // Deduplicate
              findings.httpUrls = [...new Set(findings.httpUrls)];
              findings.wsUrls = [...new Set(findings.wsUrls)];
              findings.apiUrls = [...new Set(findings.apiUrls)];
              findings.servicePatterns = [...new Set(findings.servicePatterns)];

              return JSON.stringify(findings);
            } catch (e) {
              return JSON.stringify({ _error: e.message });
            }
          })()
        `);
        log('Deep scan results: ' + deepScan);

        // Step 5: Check for active WebSocket connections
        const wsCheck = await wc.executeJavaScript(`
          (function() {
            // Check performance entries for WebSocket connections
            var wsEntries = performance.getEntriesByType('resource')
              .filter(function(e) { return e.name.includes('ws:') || e.name.includes('wss:'); });
            return JSON.stringify({
              wsEntries: wsEntries.map(function(e) { return e.name; }),
              // Check if any global WebSocket references exist
              hasSignalR: !!window.signalR,
              hasSocketIO: !!window.io,
              hasSockJS: !!window.SockJS
            });
          })()
        `);
        log('WebSocket check: ' + wsCheck);

        // Keep the window open
        wc.executeJavaScript(`
          (function() {
            var t = document.querySelector('#k10-iracing-bar span');
            if (t) t.textContent = 'iRacing — K10 Motorsports (discovery complete)';
          })();
        `).catch(() => {});

        log('Discovery complete. Window kept open for further exploration.');
        emitter.emit('auth-success', { custId: 'discovery', displayName: 'API Discovery' });
        resolve({ success: true, discovery: true });
      } catch (syncErr) {
        log('Discovery failed: ' + syncErr.message);
        emitter.emit('error', syncErr);
        // DON'T close the window — keep it open for debugging
        resolve({ success: false, error: syncErr.message });
      }
    }
  }, AUTH_CHECK_INTERVAL);

  // Timeout after 5 minutes
  _authTimeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      clearAuthPolling();
      log('Auth timed out');
      if (_loginWin && !_loginWin.isDestroyed()) { _loginWin.close(); _loginWin = null; }
      resolve({ success: false, error: 'Login timed out — please try again' });
    }
  }, AUTH_TIMEOUT);
}


function clearAuthPolling() {
  if (_authTimer) { clearInterval(_authTimer); _authTimer = null; }
  if (_authTimeout) { clearTimeout(_authTimeout); _authTimeout = null; }
}


// ── Re-sync (hidden window with persisted cookies) ──────────

/**
 * Re-sync using the persisted iRacing session cookies.
 * Opens a hidden window on members-ng.iracing.com, tries the API.
 * Falls back to prompting re-login if the session has expired.
 */
async function syncData() {
  log('Attempting re-sync with persisted session...');

  // If we have a bearer token, try that first
  if (_bearerToken) {
    try {
      await httpsGetJson(IRACING_DATA_BASE + '/member/info', _bearerToken);
      return await syncAllData(_bearerToken);
    } catch (err) {
      log('Bearer token expired, trying cookie-based...');
      _bearerToken = null;
    }
  }

  // Cookie-based: open a hidden window on the data API domain
  const hiddenWin = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:iracing',
    },
  });

  try {
    await hiddenWin.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard');

    // Give the SPA a moment to initialize and make its BFF calls
    await new Promise(r => setTimeout(r, 4000));

    // Auth check: use the known-working /sessions endpoint
    const authCheck = await hiddenWin.webContents.executeJavaScript(`
      (async () => {
        try {
          const res = await fetch('/bff/pub/proxy/api/sessions', { credentials: 'same-origin' });
          if (!res.ok) return { _status: res.status };
          const json = await res.json();
          return { _authenticated: true, _data: json };
        } catch (e) {
          return { _error: e.message };
        }
      })()
    `);

    if (!authCheck._authenticated) {
      hiddenWin.close();
      log('Session expired — need to re-login. Auth result: ' + JSON.stringify(authCheck));
      return { success: false, error: 'Session expired — please connect again', needsLogin: true };
    }

    log('/sessions auth check passed. Response keys: ' + Object.keys(authCheck._data || {}).join(', '));
    log('/sessions data: ' + JSON.stringify(authCheck._data).slice(0, 500));

    // Run BFF endpoint discovery: scan JS bundles for all API paths
    log('Scanning JS bundles for BFF endpoint paths...');
    const bffEndpoints = await hiddenWin.webContents.executeJavaScript(`
      (async () => {
        try {
          var allScripts = Array.from(document.querySelectorAll('script[src]'));
          var allPaths = [];
          for (var i = 0; i < allScripts.length; i++) {
            try {
              var res = await fetch(allScripts[i].src);
              var text = await res.text();
              // Match /bff/ paths
              var bffMatches = text.match(/\\/bff\\/[a-zA-Z0-9_/.-]+/g) || [];
              allPaths = allPaths.concat(bffMatches);
              // Match /api/ paths (these are likely the relative API paths used by the Angular services)
              var apiMatches = text.match(/["']\\/api\\/[a-zA-Z0-9_/.?=&-]+["']/g) || [];
              allPaths = allPaths.concat(apiMatches.map(function(m) { return m.replace(/["']/g, ''); }));
              // Match proxy patterns
              var proxyMatches = text.match(/proxy\\/api\\/[a-zA-Z0-9_/.-]+/g) || [];
              allPaths = allPaths.concat(proxyMatches.map(function(m) { return '/bff/pub/' + m; }));
            } catch(e) {}
          }
          return JSON.stringify([...new Set(allPaths)].sort());
        } catch (e) {
          return JSON.stringify({ _error: e.message });
        }
      })()
    `);
    log('BFF endpoints found in JS bundles: ' + bffEndpoints);

    hiddenWin.close();
    return { success: true, discovery: true, endpoints: bffEndpoints };
  } catch (err) {
    hiddenWin.close();
    log(`Re-sync failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}


// ── Disconnect ───────────────────────────────────────────────

async function disconnect() {
  clearAuthPolling();
  _bearerToken = null;

  if (_loginWin && !_loginWin.isDestroyed()) {
    _loginWin.close();
    _loginWin = null;
  }

  // Clear the persisted iRacing session
  const iracingSession = session.fromPartition('persist:iracing');
  await iracingSession.clearStorageData();
  await iracingSession.clearCache();

  // Remove local files
  try { fs.unlinkSync(getDataPath()); } catch (e) { /* ok */ }
  try { fs.unlinkSync(getStatusPath()); } catch (e) { /* ok */ }
  try { fs.unlinkSync(getTokenPath()); } catch (e) { /* ok */ }

  saveStatus({ connected: false, lastSync: null, custId: null, displayName: null });
  log(`Disconnected and session cleared`);
}


// ── Status ───────────────────────────────────────────────────

function getStatus() {
  return loadStatus();
}

function getData() {
  return loadData();
}


// ── Export ────────────────────────────────────────────────────

module.exports = Object.assign(emitter, {
  connect,
  disconnect,
  syncData,
  getStatus,
  getData,
});
