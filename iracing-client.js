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
  // Also push to the sidebar console in the iRacing window
  if (_loginWin && !_loginWin.isDestroyed()) {
    const escaped = line.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    _loginWin.webContents.executeJavaScript(
      `window.__k10_log && window.__k10_log('${escaped}');`
    ).catch(() => {});
  }
}

// Push status to the sidebar when auth state changes
function updateSidebarStatus(connected, displayName, custId, lastSync) {
  if (_loginWin && !_loginWin.isDestroyed()) {
    const name = (displayName || '').replace(/'/g, "\\'");
    _loginWin.webContents.executeJavaScript(
      `window.__k10_status && window.__k10_status(${connected}, '${name}', '${custId || ''}', '${lastSync || ''}');`
    ).catch(() => {});
  }
}

emitter.on('auth-success', (info) => {
  updateSidebarStatus(true, info.displayName, info.custId, new Date().toISOString());
});

emitter.on('sync-complete', (data) => {
  updateSidebarStatus(true, data.displayName, data.custId, data.exportedAt);
});


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


// ── Full race history search ─────────────────────────────────

/**
 * Search ALL race results for a member via /results/search_series.
 * Paginates through chunk URLs to get the full history.
 * @param {Function} fetchFn - fetch function (takes a single path string)
 * @param {number} custId
 * @returns {Promise<Array>} All race result objects
 */
async function searchAllRaces(fetchFn, custId) {
  const startBegin = '2008-01-01T00:00:00Z';
  const startEnd = new Date().toISOString();
  const path = `/results/search_series?cust_id=${custId}`
    + `&start_range_begin=${startBegin}&start_range_end=${startEnd}`
    + '&official_only=false&event_types=2,3,4,5';

  try {
    const result = await fetchFn(path);
    const data = result.data || result;

    if (data && data.chunk_info) {
      // Paginated — fetch each chunk
      const baseUrl = data.chunk_info.base_download_url || '';
      const chunks = data.chunk_info.chunk_file_names || [];
      const allRaces = [];

      for (const chunkFile of chunks) {
        try {
          const chunkUrl = baseUrl + chunkFile;
          const res = await fetch(chunkUrl);
          if (res.ok) {
            const chunkData = await res.json();
            if (Array.isArray(chunkData)) {
              allRaces.push(...chunkData);
            }
          }
        } catch (e) {
          log(`Chunk fetch error: ${e.message}`);
        }
      }

      log(`SearchAllRaces: ${allRaces.length} results from ${chunks.length} chunks`);
      return allRaces;
    }

    // Non-paginated response
    if (Array.isArray(data)) return data;
    if (data.results_page) return data.results_page;
    return [];
  } catch (e) {
    log(`SearchAllRaces failed: ${e.message}`);
    return [];
  }
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

  // 2. Fetch ALL race results (paginated search), fall back to recent 25
  let allRaces = await searchAllRaces((p) => fetchIRacingEndpoint(token, p), custId);
  let recentRaces;
  if (allRaces.length > 0) {
    log(`Full history: ${allRaces.length} races found`);
    recentRaces = allRaces;
  } else {
    log('Full search empty, falling back to member_recent_races');
    const recent = await fetchIRacingEndpoint(
      token,
      `/stats/member_recent_races?cust_id=${custId}`
    );
    recentRaces = recent.races || recent;
  }

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
 * Fetch from the /data/ API directly via the page context (same-origin cookies).
 * The iRacing data API returns { link: "signed-s3-url" } envelopes that must be followed.
 */
async function fetchDirectData(wc, endpoint) {
  const path = '/data' + endpoint;
  log(`Fetching ${path} (direct data API)...`);

  const envelope = await wc.executeJavaScript(`
    (async () => {
      try {
        const res = await fetch('${path}', { credentials: 'same-origin' });
        if (!res.ok) return { _error: res.status + ' ' + res.statusText };
        return await res.json();
      } catch (e) {
        return { _error: e.message };
      }
    })()
  `);

  if (envelope._error) throw new Error(endpoint + ': ' + envelope._error);
  if (!envelope.link) return envelope;

  // Follow the signed S3 link
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

/**
 * Sync all data using direct /data/ API calls via webContents.
 */
async function syncAllDataViaDirectData(wc) {
  log('Starting full data sync (direct /data/ API)...');

  const memberInfo = await fetchDirectData(wc, '/member/info');
  const custId = memberInfo.cust_id;
  const displayName = memberInfo.display_name;
  log(`Member: ${displayName} (${custId})`);

  // Fetch ALL race results (paginated search), fall back to recent 25
  let allRacesDirect = await searchAllRaces((p) => fetchDirectData(wc, p), custId);
  let recentRaces;
  if (allRacesDirect.length > 0) {
    log(`Full history (direct): ${allRacesDirect.length} races found`);
    recentRaces = allRacesDirect;
  } else {
    log('Full search empty (direct), falling back to member_recent_races');
    recentRaces = await fetchDirectData(wc, `/stats/member_recent_races?cust_id=${custId}`);
  }
  const careerSummary = await fetchDirectData(wc, `/stats/member_summary?cust_id=${custId}`);

  const chartData = {};
  for (const catId of CATEGORIES) {
    const catName = CATEGORY_NAMES[catId];
    try {
      const irating = await fetchDirectData(wc, `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=1`);
      const sr = await fetchDirectData(wc, `/member/chart_data?cust_id=${custId}&category_id=${catId}&chart_type=3`);
      chartData[catName] = { irating, sr };
    } catch (e) {
      log(`No chart data for ${catName}: ${e.message}`);
      chartData[catName] = { irating: [], sr: [] };
    }
  }

  let yearlyStats = null;
  try {
    yearlyStats = await fetchDirectData(wc, `/stats/member_yearly?cust_id=${custId}`);
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
    source: 'electron-iracing-client-direct',
  };

  saveData(payload);
  saveStatus({ connected: true, lastSync: payload.exportedAt, custId, displayName });
  log(`Sync complete: ${(payload.recentRaces || []).length} recent races`);
  emitter.emit('sync-complete', payload);
  return { success: true, ...payload };
}

/**
 * Same as syncAllData but uses webContents cookie-based fetch via BFF proxy.
 */
async function syncAllDataViaWebContents(wc) {
  log('Starting full data sync (cookie-based)...');

  const memberInfo = await fetchViaWebContents(wc, '/member/info');
  const custId = memberInfo.cust_id;
  const displayName = memberInfo.display_name;
  log(`Member: ${displayName} (${custId})`);

  // Fetch ALL race results (paginated search), fall back to recent 25
  let allRacesWC = await searchAllRaces((p) => fetchViaWebContents(wc, p), custId);
  let recentRaces;
  if (allRacesWC.length > 0) {
    log(`Full history (wc): ${allRacesWC.length} races found`);
    recentRaces = allRacesWC;
  } else {
    log('Full search empty (wc), falling back to member_recent_races');
    recentRaces = await fetchViaWebContents(wc, `/stats/member_recent_races?cust_id=${custId}`);
  }
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

      // Log ALL iRacing API requests (any subdomain) to discover data flow
      const headerNames = Object.keys(details.requestHeaders).join(', ');
      const logKey = details.method + ' ' + host + pathname;
      // Skip static assets
      if (!/\.(js|css|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|map)(\?|$)/i.test(pathname)
          && !pathname.includes('/chunk-') && !pathname.includes('/polyfills.')) {
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

  // Log ALL completed requests to members-ng.iracing.com so we can discover
  // how the Angular app fetches race data (not just BFF calls).
  _bffCalls = [];  // reset on each new login window
  iracingSession.webRequest.onCompleted(
    { urls: ['*://members-ng.iracing.com/*'] },
    (details) => {
      const urlObj = new URL(details.url);
      const pathname = urlObj.pathname;
      // Skip static assets (JS, CSS, images, fonts, sourcemaps)
      if (/\.(js|css|ico|png|jpg|svg|woff2?|ttf|map)(\?|$)/i.test(pathname)) return;
      // Skip webpack/Angular chunks
      if (pathname.includes('/chunk-') || pathname.includes('/main.') || pathname.includes('/polyfills.')) return;

      const isBff = pathname.startsWith('/bff/');
      const tag = isBff ? '[BFF]' : '[API]';
      log(`${tag} ${details.method} ${pathname} → ${details.statusCode}`);

      if (isBff) {
        _bffCalls.push({ method: details.method, path: pathname, status: details.statusCode, ts: Date.now() });
      }
    }
  );

  const isWin = process.platform === 'win32';

  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    // Windows: use a normal framed window — frameless + show:false + alwaysOnTop
    // can cause the window to never appear on win32.
    frame: isWin,
    autoHideMenuBar: true,
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
      // Reduce GPU pressure from this window — it's only used for OAuth
      // login and token capture, not performance-critical rendering.
      // On Windows + NVIDIA 4090, the overlay's WebGL renderer and this
      // Angular SPA competing for the shared GPU process causes crashes.
      webgl: false,
      backgroundThrottling: true,
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

  // Inject title bar + K10 sidebar panel after page loads
  win.webContents.on('did-finish-load', () => {
    const currentUrl = win.webContents.getURL();
    log(`[NAV] Page loaded: ${currentUrl}`);

    // Build sidebar injection as a plain string to avoid escaping nightmares
    const sidebarJS = `
      (function() {
        if (document.getElementById('k10-iracing-bar')) return;

        // ── Title bar ──
        var bar = document.createElement('div');
        bar.id = 'k10-iracing-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;background:#111;'
          + 'display:flex;align-items:center;justify-content:space-between;padding:0 12px;'
          + 'z-index:999999;-webkit-app-region:drag;font-family:system-ui,sans-serif;'
          + 'border-bottom:1px solid #333;';

        var title = document.createElement('span');
        title.id = 'k10-title';
        title.textContent = 'iRacing \\u2014 K10 Motorsports';
        title.style.cssText = 'color:#aaa;font-size:12px;font-weight:500;letter-spacing:0.5px;';

        var rightBtns = document.createElement('div');
        rightBtns.style.cssText = 'display:flex;align-items:center;gap:4px;-webkit-app-region:no-drag;';

        var panelBtn = document.createElement('button');
        panelBtn.textContent = '\\u25A8';
        panelBtn.title = 'Toggle K10 panel';
        panelBtn.style.cssText = 'background:none;border:none;color:#d4a843;font-size:16px;'
          + 'cursor:pointer;padding:4px 8px;border-radius:4px;';
        panelBtn.onmouseenter = function() { this.style.background = '#333'; };
        panelBtn.onmouseleave = function() { this.style.background = 'none'; };
        panelBtn.onclick = function() {
          var panel = document.getElementById('k10-bottom-panel');
          var isOpen = panel.style.bottom === '0px';
          panel.style.bottom = isOpen ? '-250px' : '0px';
        };

        var closeBtn = document.createElement('button');
        closeBtn.textContent = '\\u2715';
        closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:14px;'
          + 'cursor:pointer;padding:4px 8px;border-radius:4px;';
        closeBtn.onmouseenter = function() { this.style.background = '#333'; this.style.color = '#fff'; };
        closeBtn.onmouseleave = function() { this.style.background = 'none'; this.style.color = '#888'; };
        closeBtn.onclick = function() { window.close(); };

        rightBtns.appendChild(panelBtn);
        rightBtns.appendChild(closeBtn);
        bar.appendChild(title);
        bar.appendChild(rightBtns);
        document.body.prepend(bar);
        document.body.style.paddingTop = '32px';

        // ── Bottom panel (like Chrome DevTools) ──
        var bpanel = document.createElement('div');
        bpanel.id = 'k10-bottom-panel';
        bpanel.style.cssText = 'position:fixed;left:0;right:0;bottom:0px;height:220px;'
          + 'background:#111;border-top:2px solid #333;z-index:999998;'
          + 'font-family:system-ui,sans-serif;display:flex;flex-direction:column;'
          + 'transition:bottom 0.2s ease;';

        // Header row: status on left, console controls on right
        var bHeader = document.createElement('div');
        bHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;'
          + 'padding:5px 12px;border-bottom:1px solid #222;flex-shrink:0;';

        var statusLeft = document.createElement('div');
        statusLeft.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var dot = document.createElement('div');
        dot.id = 'k10-status-dot';
        dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#555;flex-shrink:0;';

        var statusText = document.createElement('span');
        statusText.id = 'k10-status-text';
        statusText.style.cssText = 'color:#aaa;font-size:11px;';
        statusText.textContent = 'Connecting...';

        var memberInfoEl = document.createElement('span');
        memberInfoEl.id = 'k10-member-info';
        memberInfoEl.style.cssText = 'color:#555;font-size:10px;';

        statusLeft.appendChild(dot);
        statusLeft.appendChild(statusText);
        statusLeft.appendChild(memberInfoEl);

        var ctrlRight = document.createElement('div');
        ctrlRight.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var consoleLabel = document.createElement('span');
        consoleLabel.style.cssText = 'color:#444;font-size:9px;text-transform:uppercase;letter-spacing:1px;';
        consoleLabel.textContent = 'Sync Console';

        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.style.cssText = 'background:none;border:none;color:#555;font-size:10px;cursor:pointer;padding:2px 6px;';
        copyBtn.onclick = function() {
          var c = document.getElementById('k10-console');
          if (c) {
            navigator.clipboard.writeText(c.innerText);
            copyBtn.textContent = '\\u2713';
            copyBtn.style.color = '#4ade80';
            setTimeout(function() { copyBtn.textContent = 'Copy'; copyBtn.style.color = '#555'; }, 1500);
          }
        };

        var clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.style.cssText = 'background:none;border:none;color:#555;font-size:10px;cursor:pointer;padding:2px 6px;';
        clearBtn.onclick = function() {
          var c = document.getElementById('k10-console');
          if (c) c.innerHTML = '';
        };

        ctrlRight.appendChild(consoleLabel);
        ctrlRight.appendChild(copyBtn);
        ctrlRight.appendChild(clearBtn);
        bHeader.appendChild(statusLeft);
        bHeader.appendChild(ctrlRight);

        // Console body
        var consoleBody = document.createElement('div');
        consoleBody.id = 'k10-console';
        consoleBody.style.cssText = 'flex:1;overflow-y:auto;padding:4px 12px;font-size:10px;'
          + 'color:#888;font-family:ui-monospace,Menlo,monospace;line-height:1.4;'
          + 'scrollbar-width:thin;scrollbar-color:#333 transparent;';

        bpanel.appendChild(bHeader);
        bpanel.appendChild(consoleBody);
        document.body.appendChild(bpanel);

        // ── Floating "Sync Now" button (top-right, below title bar) ──
        var syncBtn = document.createElement('button');
        syncBtn.id = 'k10-sync-btn';
        syncBtn.textContent = 'Sync Now';
        syncBtn.style.cssText = 'position:fixed;top:48px;right:12px;'
          + 'padding:8px 16px;background:rgba(0,0,0,0.6);color:#d4a843;'
          + 'border:1px solid rgba(212,168,67,0.4);border-radius:20px;'
          + 'font-size:12px;font-weight:500;cursor:pointer;'
          + 'z-index:999997;transition:all 0.2s ease;font-family:system-ui,sans-serif;';
        syncBtn.onmouseenter = function() {
          if (!this.disabled) {
            this.style.background = 'rgba(0,0,0,0.8)';
            this.style.borderColor = 'rgba(212,168,67,0.7)';
          }
        };
        syncBtn.onmouseleave = function() {
          if (!this.disabled) {
            this.style.background = 'rgba(0,0,0,0.6)';
            this.style.borderColor = 'rgba(212,168,67,0.4)';
          }
        };
        syncBtn.onclick = function() {
          console.log('__k10_cmd:sync');
        };
        document.body.appendChild(syncBtn);

        // ── Sync overlay (dark shim + spinner) ──
        var overlay = document.createElement('div');
        overlay.id = 'k10-sync-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:250px;'
          + 'background:rgba(0,0,0,0.7);z-index:999996;display:none;'
          + 'align-items:center;justify-content:center;';

        var spinnerContainer = document.createElement('div');
        spinnerContainer.style.cssText = 'text-align:center;';

        var spinner = document.createElement('div');
        spinner.id = 'k10-spinner';
        spinner.style.cssText = 'width:40px;height:40px;border:4px solid rgba(212,168,67,0.3);'
          + 'border-top-color:#d4a843;border-radius:50%;margin:0 auto 16px;'
          + 'animation:k10_spin 1s linear infinite;';

        var spinnerText = document.createElement('div');
        spinnerText.style.cssText = 'color:#d4a843;font-size:14px;font-family:system-ui,sans-serif;';
        spinnerText.textContent = 'Syncing iRacing data...';

        spinnerContainer.appendChild(spinner);
        spinnerContainer.appendChild(spinnerText);
        overlay.appendChild(spinnerContainer);
        document.body.appendChild(overlay);

        // Add spinner animation
        var style = document.createElement('style');
        style.textContent = '@keyframes k10_spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);

        // ── Toast notification ──
        var toastContainer = document.createElement('div');
        toastContainer.id = 'k10-toast';
        toastContainer.style.cssText = 'position:fixed;bottom:280px;right:20px;'
          + 'padding:12px 16px;border-radius:6px;font-size:13px;'
          + 'font-family:system-ui,sans-serif;z-index:999999;display:none;'
          + 'animation:k10_toast_in 0.3s ease;max-width:300px;word-wrap:break-word;';

        style = document.createElement('style');
        style.textContent = '@keyframes k10_toast_in { from { opacity:0;transform:translateY(20px); } to { opacity:1;transform:translateY(0); } }';
        document.head.appendChild(style);

        document.body.appendChild(toastContainer);

        // ── Window helper functions ──
        window.__k10_showSyncOverlay = function() {
          var ov = document.getElementById('k10-sync-overlay');
          if (ov) {
            ov.style.display = 'flex';
          }
          var btn = document.getElementById('k10-sync-btn');
          if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
          }
        };

        window.__k10_hideSyncOverlay = function() {
          var ov = document.getElementById('k10-sync-overlay');
          if (ov) {
            ov.style.display = 'none';
          }
          var btn = document.getElementById('k10-sync-btn');
          if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
          }
        };

        window.__k10_showToast = function(type, message) {
          var toast = document.getElementById('k10-toast');
          if (!toast) return;

          if (type === 'success') {
            toast.style.background = 'rgba(74,222,128,0.95)';
            toast.style.color = '#000';
            toast.innerHTML = '<span style="margin-right:8px;">\\u2713</span>' + message;
          } else if (type === 'error') {
            toast.style.background = 'rgba(239,68,68,0.95)';
            toast.style.color = '#fff';
            toast.innerHTML = '<span style="margin-right:8px;">!</span>' + message;
          }

          toast.style.display = 'block';

          if (type === 'success') {
            setTimeout(function() {
              toast.style.display = 'none';
            }, 4000);
          }
        };

        window.__k10_hideConsole = function() {
          var panel = document.getElementById('k10-bottom-panel');
          if (panel) {
            panel.style.bottom = '-250px';
          }
        };

        window.__k10_showConsole = function() {
          var panel = document.getElementById('k10-bottom-panel');
          if (panel) {
            panel.style.bottom = '0px';
          }
        };

        // Log helper — called by main process via executeJavaScript
        window.__k10_log = function(line) {
          var c = document.getElementById('k10-console');
          if (!c) return;
          var entry = document.createElement('div');
          entry.style.cssText = 'padding:1px 0;border-bottom:1px solid #1a1a1a;word-break:break-all;';
          entry.textContent = line;
          c.appendChild(entry);
          c.scrollTop = c.scrollHeight;
        };

        // Status update helper
        window.__k10_status = function(connected, name, custId, lastSync) {
          var d = document.getElementById('k10-status-dot');
          var t = document.getElementById('k10-status-text');
          var i = document.getElementById('k10-member-info');
          if (d) d.style.background = connected ? '#4ade80' : '#555';
          if (t) t.textContent = connected ? 'Connected' : 'Disconnected';
          if (i) i.textContent = connected
            ? (name + ' (#' + custId + ')' + (lastSync ? ' \\u2014 ' + new Date(lastSync).toLocaleTimeString() : ''))
            : '';
        };
      })();
    `;
    win.webContents.executeJavaScript(sidebarJS).catch((err) => {
      log('Sidebar injection failed: ' + err.message);
    });
  });

  // Listen for sync requests from the floating button
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message === '__k10_cmd:sync') {
      log('Sync request received from UI');
      runSync(win.webContents);
    }
  });

  return win;
}


/**
 * Manual sync triggered from the UI's floating "Sync Now" button
 * or called during initial authentication. Runs DOM scraping
 * to extract iRacing data from the dashboard and profile pages.
 */
async function runSync(wc) {
  try {
    // Show overlay + spinner
    await wc.executeJavaScript(`window.__k10_showSyncOverlay && window.__k10_showSyncOverlay();`).catch(() => {});

    // Save current URL so we can navigate back
    const savedUrl = wc.getURL();
    log(`[SYNC] Saved URL: ${savedUrl}`);

    // Helper: fetch a BFF endpoint from page context with cookies
    async function fetchBff(path) {
      const raw = await wc.executeJavaScript(`
        (async () => {
          try {
            var res = await fetch('${path}', { credentials: 'same-origin' });
            var text = await res.text();
            return JSON.stringify({ status: res.status, body: text });
          } catch (e) {
            return JSON.stringify({ status: 0, error: e.message });
          }
        })()
      `);
      const result = JSON.parse(raw || '{}');
      if (result.status !== 200) {
        throw new Error(path + ' → ' + result.status + ': ' + (result.error || result.body?.slice(0, 200)));
      }
      // Log raw response for debugging
      const bodyPreview = (result.body || '').slice(0, 300);
      log(path + ' raw response (' + (result.body || '').length + ' chars): ' + bodyPreview);

      // iRacing data API returns a signed S3 link envelope for large payloads
      let data;
      try { data = JSON.parse(result.body); } catch (e) { throw new Error(path + ' returned non-JSON: ' + bodyPreview); }

      // If the response has a "link" field, it's an S3 redirect envelope
      if (data && data.link) {
        log('Following S3 link for ' + path + '...');
        const s3Raw = await wc.executeJavaScript(`
          (async () => {
            try {
              var res = await fetch('${data.link.replace(/'/g, "\\'")}');
              var text = await res.text();
              return text;
            } catch (e) {
              return JSON.stringify({ _error: e.message });
            }
          })()
        `);
        try { data = JSON.parse(s3Raw); } catch (e) { throw new Error(path + ' S3 link returned non-JSON'); }
      }

      return data;
    }

    // ── DOM Scraping: the data is rendered by Angular SSR ──
    // The /data/ API requires separate auth we can't get from OAuth.
    // But ALL the data we need is rendered in the page DOM.

    // Step 1: Scrape the dashboard
    log('Scraping dashboard data...');
    const dashData = await wc.executeJavaScript(`
      (function() {
        var r = {};
        var body = document.body.innerText;

        // User name from greeting
        var m = body.match(/Good (?:Morning|Afternoon|Evening),\\s*([^\\n]+)/);
        if (m) r.displayName = m[1].trim();

        // Season info
        m = body.match(/(\\d{4}) Season (\\d+).*Week (\\d+) of (\\d+)/);
        if (m) r.season = { year: m[1], season: m[2], week: m[3], totalWeeks: m[4] };

        // Recent Results — scrape all visible result cards
        r.recentResults = [];
        // Find all elements that look like result entries
        var allText = body;
        var resultPattern = /(\\w{3} \\d{2}, \\d{4}, \\d+:\\d+ [AP]M).*?(?:RACE|QUAL|PRACTICE|TIME TRIAL).*?Car\\s*([^\\n]+?)\\s*Track\\s*([^\\n]+?)\\s*Finish\\s*(\\d+\\w+)\\s*Start\\s*(\\d+\\w+)/g;
        var rm;
        while ((rm = resultPattern.exec(allText)) !== null) {
          r.recentResults.push({
            date: rm[1], car: rm[2].trim(), track: rm[3].trim(),
            finish: rm[4], start: rm[5]
          });
        }

        // 30 Day Activity
        m = body.match(/30 Day Activity.*?Days\\s*Active\\s*(\\d+).*?VS\\.\\s*LAST 30[^\\n]*?([^\\n]*Days)/s);
        if (m) r.activity30d = { daysActive: m[1], vsLast30: m[2].trim() };

        // Licenses — look for license badges (R 2.50, B 1.63, D 3.59, etc.)
        r.licenses = [];
        var licPattern = /([RABCD])\\s*(\\d+\\.\\d+)/g;
        var licSection = body.match(/Licenses[\\s\\S]{0,500}/);
        if (licSection) {
          var lm;
          while ((lm = licPattern.exec(licSection[0])) !== null) {
            r.licenses.push({ class: lm[1], rating: parseFloat(lm[2]) });
          }
        }

        // Also try to grab iRating from the dashboard itself
        // Modern iRacing dashboard may show iRating values directly
        r.dashboardIRatings = [];
        var irPat = /(?:iRating|iR)[:\\s]*(\\d[\\d,]*)/gi;
        var irm;
        while ((irm = irPat.exec(body)) !== null) {
          r.dashboardIRatings.push(irm[1].replace(/,/g, ''));
        }

        // Grab page text for debugging
        r.dashboardText = body.slice(0, 2000);

        return JSON.stringify(r);
      })()
    `);
    log('Dashboard scrape: ' + dashData);
    const dashboard = JSON.parse(dashData || '{}');
    log('Dashboard displayName: ' + (dashboard.displayName || 'none'));
    log('Dashboard iRatings: ' + JSON.stringify(dashboard.dashboardIRatings || []));
    log('Dashboard licenses: ' + JSON.stringify(dashboard.licenses || []));
    if (dashboard.dashboardText) {
      log('Dashboard text (first 500): ' + dashboard.dashboardText.slice(0, 500));
    }

    // Step 2: Deep-scrape the SAME dashboard page for all data
    // DO NOT navigate away — iRacing SPA loses auth on navigation.
    // DO NOT call /data/ API — requires separate auth we don't have.
    // Everything we need must come from the current page DOM.
    log('Deep-scraping dashboard page for iRating data...');

    const deepScrape = await wc.executeJavaScript(`
      (function() {
        var r = { ratings: {}, careerStats: {} };
        var body = document.body.innerText;
        r.url = location.href;
        r.bodyLen = body.length;

        // ══ DUMP PAGE TEXT FOR DEBUGGING ══
        // Log first 3000 chars so we can see exactly what's on the page
        r.pageText = body.slice(0, 3000);

        // ══ iRATING EXTRACTION — multiple strategies ══
        r.ratings.irating_raw = [];
        r.ratings.byCategory = {};

        // Strategy 1: "iRating: 1,234" or "iRating 1234" or "iR: 1234"
        var irPat1 = /(?:iRating|iR)[:\\s]*(\\d[\\d,]*)/gi;
        var im;
        while ((im = irPat1.exec(body)) !== null) {
          var v = im[1].replace(/,/g, '');
          if (+v >= 100 && +v <= 15000) r.ratings.irating_raw.push(v);
        }

        // Strategy 2: Numbers near category labels
        var categories = ['Road', 'Oval', 'Dirt Road', 'Dirt Oval', 'Sports Car', 'Formula'];
        for (var ci = 0; ci < categories.length; ci++) {
          var cat = categories[ci];
          // Look within 200 chars after category name for a 3-5 digit number
          var catPat = new RegExp(cat + '[\\\\s\\\\S]{0,200}?(\\\\d[\\\\d,]{2,5})', 'i');
          var cm = body.match(catPat);
          if (cm) {
            // Skip inactive categories: "---" before the number means no real data
            var textBetween = cm[0].slice(0, cm[0].lastIndexOf(cm[1]));
            if (textBetween.indexOf('---') !== -1) continue;
            var val = parseInt(cm[1].replace(/,/g, ''));
            if (val >= 100 && val <= 15000) {
              r.ratings.byCategory[cat.toLowerCase()] = val;
            }
          }
        }

        // Strategy 3: All standalone 3-5 digit numbers (iRating candidates)
        r.ratings.allNumbers = [];
        var numPat = /\\b(\\d{1,2},\\d{3}|\\d{3,5})\\b/g;
        var nm;
        while ((nm = numPat.exec(body)) !== null) {
          var n = parseInt(nm[1].replace(/,/g, ''));
          if (n >= 500 && n <= 12000) {
            r.ratings.allNumbers.push(n);
          }
        }
        // Deduplicate
        r.ratings.allNumbers = r.ratings.allNumbers.filter(function(v, i, a) { return a.indexOf(v) === i; }).slice(0, 30);

        // ══ SAFETY RATING / LICENSE ══
        r.ratings.sr_raw = [];
        r.ratings.licenseMatches = [];

        // "Safety Rating: A 3.41"
        var srPat = /Safety Rating[:\\s]*([RABCD]?)\\s*(\\d+\\.\\d+)/gi;
        var sm;
        while ((sm = srPat.exec(body)) !== null) {
          r.ratings.sr_raw.push({ class: sm[1], rating: sm[2] });
        }

        // Standalone "A 3.41" or "B 2.99" patterns
        var licPat = /\\b([RABCD])\\s+(\\d\\.\\d{2})\\b/g;
        var lm;
        while ((lm = licPat.exec(body)) !== null) {
          r.ratings.licenseMatches.push({ class: lm[1], rating: lm[2] });
        }

        // ══ CUSTOMER ID ══
        r.custId = '';
        var cidm = body.match(/(?:Customer|Cust\\.?|Member)\\s*(?:ID|#)[:\\s]*(\\d+)/i);
        if (cidm) r.custId = cidm[1];
        if (!r.custId) {
          var urlCid = location.href.match(/(?:cust_id|custid|member)[=/](\\d+)/i);
          if (urlCid) r.custId = urlCid[1];
        }

        // ══ MEMBER SINCE ══
        var msm = body.match(/Member Since[:\\s]*(\\w+ \\d{4}|\\d{4})/i);
        if (msm) r.memberSince = msm[1];

        // ══ CAREER STATS ══
        var statsPat = /(Starts|Wins|Top 5|Podiums|Laps|Inc(?:idents)?|Races|Poles|Top 10)[:\\s]*(\\d[\\d,]*)/gi;
        var stm;
        while ((stm = statsPat.exec(body)) !== null) {
          r.careerStats[stm[1].toLowerCase()] = stm[2].replace(/,/g, '');
        }

        return JSON.stringify(r);
      })()
    `);

    const profile = JSON.parse(deepScrape || '{}');
    log('Page URL: ' + (profile.url || 'unknown'));
    log('Page body length: ' + (profile.bodyLen || 0));
    log('irating_raw: ' + JSON.stringify(profile.ratings?.irating_raw || []));
    log('byCategory: ' + JSON.stringify(profile.ratings?.byCategory || {}));
    log('allNumbers (iR candidates): ' + JSON.stringify(profile.ratings?.allNumbers || []));
    log('licenseMatches: ' + JSON.stringify(profile.ratings?.licenseMatches || []));
    log('sr_raw: ' + JSON.stringify(profile.ratings?.sr_raw || []));
    log('custId: ' + (profile.custId || 'none'));
    log('careerStats: ' + JSON.stringify(profile.careerStats || {}));

    // If custId not found in DOM, try BFF /sessions endpoint
    if (!profile.custId) {
      try {
        const sessionsData = await fetchBff('/bff/pub/proxy/api/sessions');
        if (sessionsData) {
          const sid = sessionsData.cust_id || sessionsData.custId || sessionsData.custid;
          if (sid) {
            profile.custId = String(sid);
            log('custId from /sessions: ' + profile.custId);
          }
        }
      } catch (e) {
        log('Could not get custId from /sessions: ' + e.message);
      }
    }

    // Log page text so we can see what's actually on the page
    if (profile.pageText) {
      // Split into chunks to avoid log truncation
      for (let i = 0; i < profile.pageText.length; i += 500) {
        log('PAGE[' + i + ']: ' + profile.pageText.slice(i, i + 500));
      }
    }

    const displayName = dashboard.displayName || '';
    const custId = profile.custId || '';
    log('Member: ' + displayName + ' (#' + custId + ')');

    // ══ STEP 3: Navigate to Charts page & intercept JSON for iRating history ══
    // We can't call iRacing's data APIs ourselves (auth doesn't work from our
    // context — see CLAUDE.md). But the charts PAGE's Angular code fetches
    // chart_data JSON using the page's own session cookies.
    //
    // Approach: attach Electron's CDP (Chrome DevTools Protocol) debugger to
    // capture all network response bodies at the browser level. This survives
    // page navigations (unlike monkey-patching fetch, which gets wiped by
    // loadURL). After the page loads and Angular fetches the chart data, we
    // read the response bodies from CDP.
    let chartData = {};
    if (custId) {
      const dbg = wc.debugger;
      let debuggerAttached = false;
      // Map of requestId → { url, status } for responses we want bodies of
      const pendingBodies = new Map();
      // Collected raw response bodies keyed by URL
      const capturedBodies = new Map();

      try {
        // ── Attach CDP debugger & enable Network domain ──
        try {
          dbg.attach('1.3');
          debuggerAttached = true;
          log('[CHARTS] CDP debugger attached');
        } catch (attachErr) {
          log('[CHARTS] CDP attach failed (may already be attached): ' + attachErr.message);
          // Try to use it anyway — may already be attached
          debuggerAttached = true;
        }

        await dbg.sendCommand('Network.enable');
        log('[CHARTS] CDP Network.enable sent');

        // Listen for network responses — flag chart_data and S3 URLs for body capture
        const messageHandler = (_event, method, params) => {
          if (method === 'Network.responseReceived') {
            const url = params.response?.url || '';
            const status = params.response?.status || 0;
            // Capture chart_data responses, S3 data responses, and any JSON from the data API
            if (url.includes('chart_data') || url.includes('member/chart') ||
                url.includes('/data/member/') || url.includes('/bff/') ||
                (url.includes('s3') && url.includes('iRacing')) ||
                (url.includes('.amazonaws.com') && status === 200)) {
              pendingBodies.set(params.requestId, { url, status });
            }
          }
          // Also capture loading finished (needed for getResponseBody to work)
          if (method === 'Network.loadingFinished') {
            // Request is fully loaded — we can now getResponseBody
            const pending = pendingBodies.get(params.requestId);
            if (pending) {
              pending.loaded = true;
            }
          }
        };
        dbg.on('message', messageHandler);

        // ── Navigate to charts page ──
        const chartsUrl = `https://members-ng.iracing.com/web/racing/profile?cust_id=${custId}&tab=charts`;
        log('[CHARTS] Navigating to: ' + chartsUrl);
        try {
          await wc.loadURL(chartsUrl);
          log('[CHARTS] Navigation complete, current URL: ' + wc.getURL());
        } catch (navErr) {
          log('[CHARTS] loadURL error: ' + navErr.message);
          // loadURL can throw on redirect errors (-3) which are normal for iRacing OAuth
          log('[CHARTS] Current URL after error: ' + wc.getURL());
        }

        // Wait for Angular to hydrate and fetch chart data
        // (up to 5 categories × 2 chart types = ~10 requests, some via S3 redirects)
        log('[CHARTS] Waiting 12s for Angular data requests...');
        await new Promise(r => setTimeout(r, 12000));
        log('[CHARTS] Captured ' + pendingBodies.size + ' relevant network responses');

        // ── Read response bodies via CDP ──
        for (const [requestId, meta] of pendingBodies) {
          try {
            const bodyResult = await dbg.sendCommand('Network.getResponseBody', { requestId });
            const bodyText = bodyResult.body || '';
            if (bodyText.length > 10) {
              capturedBodies.set(meta.url, bodyText);
              log('[CHARTS] Got body for: ' + meta.url.slice(0, 120) + ' (' + bodyText.length + ' chars)');
            }
          } catch (bodyErr) {
            // Response body may have been evicted or request was a redirect
            log('[CHARTS] Could not get body for ' + meta.url.slice(0, 80) + ': ' + bodyErr.message);
          }
        }

        // Stop listening & detach
        dbg.removeListener('message', messageHandler);
        log('[CHARTS] Captured ' + capturedBodies.size + ' response bodies total');

        // ── Parse captured JSON into chartData ──
        const CAT_ID_MAP = { 1: 'oval', 2: 'road', 3: 'dirt_oval', 4: 'dirt_road', 5: 'sports_car' };

        for (const [url, bodyText] of capturedBodies) {
          try {
            let json = JSON.parse(bodyText);

            // S3 link envelope — follow it via a page-context fetch
            if (json && json.link && typeof json.link === 'string') {
              log('[CHARTS] Following S3 link from ' + url.slice(0, 80));
              try {
                const s3Body = await wc.executeJavaScript(`
                  (async function() {
                    try {
                      var res = await fetch('${json.link.replace(/'/g, "\\'")}');
                      return await res.text();
                    } catch(e) { return ''; }
                  })()
                `);
                if (s3Body && s3Body.length > 10) {
                  json = JSON.parse(s3Body);
                  log('[CHARTS] S3 data: ' + s3Body.length + ' chars');
                }
              } catch (s3Err) {
                log('[CHARTS] S3 follow failed: ' + s3Err.message);
                continue;
              }
            }

            // Extract data points array — handles multiple shapes:
            //   [{ when, value }, ...]
            //   { data: [{ when, value }, ...] }
            //   { chart_data: [...] }
            let points = [];
            if (Array.isArray(json)) {
              points = json;
            } else if (json && typeof json === 'object') {
              points = json.data || json.chart_data || json.points || json.series || [];
              if (!Array.isArray(points)) points = [];
            }

            if (points.length === 0) continue;
            const first = points[0];
            if (!first || (first.when === undefined && first.value === undefined &&
                          first.x === undefined && first.y === undefined)) {
              // Not chart data points
              log('[CHARTS] Skipping non-chart data from ' + url.slice(0, 80) + ' (keys: ' + (first ? Object.keys(first).join(',') : 'null') + ')');
              continue;
            }

            // Normalize to { when, value }
            const normalized = points.map(p => ({
              when: p.when || p.date || p.x || '',
              value: p.value || p.y || p.irating || 0,
            })).filter(p => p.when && p.value > 0);

            if (normalized.length === 0) continue;

            // Determine category and chart type from URL
            const catMatch = url.match(/category_id[=:](\d+)/);
            const typeMatch = url.match(/chart_type[=:](\d+)/);
            const catId = catMatch ? parseInt(catMatch[1]) : 0;
            const chartType = typeMatch ? parseInt(typeMatch[1]) : 0;
            const category = CAT_ID_MAP[catId];

            if (category) {
              if (!chartData[category]) chartData[category] = { irating: [], sr: [] };
              if (chartType === 3) {
                chartData[category].sr = normalized;
                log('[CHARTS] SR: ' + category + ' — ' + normalized.length + ' points');
              } else {
                chartData[category].irating = normalized;
                log('[CHARTS] iRating: ' + category + ' — ' + normalized.length + ' points');
              }
            } else {
              log('[CHARTS] Uncategorized chart data: ' + normalized.length + ' points from ' + url.slice(0, 100));
              log('[CHARTS]   sample: ' + JSON.stringify(normalized.slice(0, 2)));
            }
          } catch (parseErr) {
            // Not JSON — skip
          }
        }

        // ── Fallback: if CDP captured nothing, try direct page-context fetch ──
        // The page's Angular code fetches these successfully — we call from the
        // same page context with the same session cookies.
        if (Object.keys(chartData).length === 0) {
          log('[CHARTS] CDP captured no chart data — trying direct page-context fetch...');

          const directRaw = await wc.executeJavaScript(`
            (async function() {
              var results = { categories: {}, errors: [], s3Follows: 0 };
              var catMap = { 1: 'oval', 2: 'road', 3: 'dirt_oval', 4: 'dirt_road', 5: 'sports_car' };
              var custId = '${custId}';

              for (var catId = 1; catId <= 5; catId++) {
                for (var chartType of [1, 3]) {
                  var label = catMap[catId] + '_' + (chartType === 1 ? 'ir' : 'sr');
                  var paths = [
                    '/bff/pub/proxy/api/member/chart_data?cust_id=' + custId + '&category_id=' + catId + '&chart_type=' + chartType,
                    '/data/member/chart_data?cust_id=' + custId + '&category_id=' + catId + '&chart_type=' + chartType
                  ];
                  for (var pi = 0; pi < paths.length; pi++) {
                    try {
                      var res = await fetch(paths[pi], { credentials: 'same-origin' });
                      if (!res.ok) { results.errors.push(label + ' → ' + res.status); continue; }
                      var json = await res.json();
                      if (json && json.link) {
                        results.s3Follows++;
                        var s3 = await fetch(json.link);
                        json = await s3.json();
                      }
                      var pts = Array.isArray(json) ? json : (json.data || json.chart_data || []);
                      if (pts.length > 0) {
                        var cat = catMap[catId];
                        if (!results.categories[cat]) results.categories[cat] = { irating: [], sr: [] };
                        results.categories[cat][chartType === 1 ? 'irating' : 'sr'] = pts;
                        break;
                      }
                    } catch(e) { results.errors.push(label + ': ' + e.message); }
                  }
                }
              }
              return JSON.stringify(results);
            })()
          `);

          const direct = JSON.parse(directRaw || '{}');
          log('[CHARTS] Direct fetch: ' + Object.keys(direct.categories || {}).length + ' categories, ' + (direct.s3Follows || 0) + ' S3 follows');
          for (const err of (direct.errors || [])) log('[CHARTS] direct err: ' + err);

          for (const [category, data] of Object.entries(direct.categories || {})) {
            const irPts = (data.irating || []).map(p => ({ when: p.when || '', value: p.value || 0 })).filter(p => p.when && p.value > 0);
            const srPts = (data.sr || []).map(p => ({ when: p.when || '', value: p.value || 0 })).filter(p => p.when && p.value > 0);
            if (irPts.length > 0 || srPts.length > 0) {
              chartData[category] = { irating: irPts, sr: srPts };
              log('[CHARTS] Direct: ' + category + ' — ' + irPts.length + ' iR, ' + srPts.length + ' SR');
            }
          }
        }

        // ── Also check Angular TransferState (SSR-embedded JSON) ──
        if (Object.keys(chartData).length === 0) {
          log('[CHARTS] Checking for Angular TransferState...');
          const transferRaw = await wc.executeJavaScript(`
            (function() {
              // Angular Universal embeds SSR data in a script tag
              var el = document.getElementById('serverApp-state') ||
                       document.querySelector('script[type="application/json"][id]');
              if (el) return el.textContent;
              // Also check for inline JSON in script tags
              var scripts = document.querySelectorAll('script:not([src])');
              for (var i = 0; i < scripts.length; i++) {
                var t = scripts[i].textContent || '';
                if (t.includes('chart_data') || t.includes('irating') || t.includes('"when"')) {
                  return t.slice(0, 50000);
                }
              }
              return '';
            })()
          `).catch(() => '');
          if (transferRaw && transferRaw.length > 10) {
            log('[CHARTS] TransferState found: ' + transferRaw.length + ' chars');
            log('[CHARTS] TransferState preview: ' + transferRaw.slice(0, 500));
            // Could parse further here once we see the structure
          } else {
            log('[CHARTS] No TransferState found');
          }
        }

        // ── Summary ──
        const totalChartPoints = Object.values(chartData).reduce(
          (sum, cat) => sum + ((cat && cat.irating) ? cat.irating.length : 0), 0
        );
        log('[CHARTS] Total iRating history: ' + totalChartPoints + ' points across ' + Object.keys(chartData).length + ' categories');
        for (const [cat, data] of Object.entries(chartData)) {
          const irLen = (data.irating || []).length;
          const srLen = (data.sr || []).length;
          if (irLen > 0) {
            const first = data.irating[0];
            const last = data.irating[irLen - 1];
            log('[CHARTS]   ' + cat + ': ' + irLen + ' iR (' + (first.when || '?') + ' → ' + (last.when || '?') + '), ' + srLen + ' SR');
          }
        }

        // Navigate back to the dashboard
        log('[CHARTS] Navigating back...');
        await wc.loadURL(savedUrl).catch(() => {
          return wc.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard');
        });
        await new Promise(r => setTimeout(r, 3000));

      } catch (chartErr) {
        log('[CHARTS] Error: ' + chartErr.message + '\n' + chartErr.stack);
        try {
          await wc.loadURL(savedUrl).catch(() =>
            wc.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard')
          );
          await new Promise(r => setTimeout(r, 2000));
        } catch (navErr) {
          log('[CHARTS] Failed to navigate back: ' + navErr.message);
        }
      } finally {
        // Always detach debugger
        if (debuggerAttached) {
          try { dbg.detach(); log('[CHARTS] CDP debugger detached'); }
          catch (detachErr) { log('[CHARTS] CDP detach: ' + detachErr.message); }
        }
      }
    } else {
      log('[CHARTS] Skipping — no custId available');
    }

    // Build sync payload — everything from DOM scraping, no API calls
    const payload = {
      custId,
      displayName: displayName || '',
      season: dashboard.season,
      recentRaces: dashboard.recentResults || [],
      licenses: dashboard.licenses || [],
      ratings: profile.ratings || {},
      careerStats: profile.careerStats || {},
      chartData: Object.keys(chartData).length > 0 ? chartData : undefined,
      memberSince: profile.memberSince || '',
      exportedAt: new Date().toISOString(),
      source: 'electron-iracing-dom',
    };

    saveData(payload);
    saveStatus({ connected: true, lastSync: payload.exportedAt, custId, displayName });

    const raceCount = (payload.recentRaces || []).length;
    const chartCats = payload.chartData ? Object.keys(payload.chartData).length : 0;
    const chartPoints = Object.values(chartData).reduce(
      (sum, cat) => sum + ((cat && cat.irating) ? cat.irating.length : 0), 0
    );
    log('Sync complete! ' + displayName + ' — ' + raceCount + ' recent races, '
      + payload.licenses.length + ' licenses, ' + chartCats + ' chart categories, '
      + chartPoints + ' history points');

    // Hide overlay
    await wc.executeJavaScript(`window.__k10_hideSyncOverlay && window.__k10_hideSyncOverlay();`).catch(() => {});

    // Show success toast
    const toastMsg = 'Synced! ' + displayName + ' — ' + raceCount + ' races'
      + (chartCats > 0 ? ', ' + chartPoints + ' iRating history points' : '');
    await wc.executeJavaScript(
      `window.__k10_showToast && window.__k10_showToast('success', '${toastMsg.replace(/'/g, "\\'")}');`
    ).catch(() => {});

    // Hide console on success
    await wc.executeJavaScript(`window.__k10_hideConsole && window.__k10_hideConsole();`).catch(() => {});

    updateSidebarStatus(true, displayName, custId, payload.exportedAt);
    log('Emitting sync-complete — irating_raw: ' + JSON.stringify(payload.ratings?.irating_raw?.slice(0, 4) || []) + ', byCategory: ' + JSON.stringify(payload.ratings?.byCategory || {}));
    emitter.emit('sync-complete', payload);
    log('sync-complete emitted — main.js listener should fire now');

  } catch (syncErr) {
    log('Sync error: ' + syncErr.message);

    // Hide overlay
    await wc.executeJavaScript(`window.__k10_hideSyncOverlay && window.__k10_hideSyncOverlay();`).catch(() => {});

    // Show error toast (stays visible)
    const errMsg = 'Sync failed: ' + syncErr.message;
    await wc.executeJavaScript(
      `window.__k10_showToast && window.__k10_showToast('error', '${errMsg.replace(/'/g, "\\'")}');`
    ).catch(() => {});

    // Keep console visible on error
    await wc.executeJavaScript(`window.__k10_showConsole && window.__k10_showConsole();`).catch(() => {});

    emitter.emit('error', syncErr);
  }
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
      // On Windows, focus() alone won't surface a window that's behind an
      // always-on-top overlay. We need show() (in case ready-to-show hasn't
      // fired yet) + moveTop() (win32 z-order) + focus().
      _loginWin.show();
      _loginWin.moveTop();
      _loginWin.focus();
      // Don't resolve immediately — the IPC handler in main.js drops the
      // overlay's always-on-top while awaiting this promise. If we resolve
      // now, the overlay snaps back on top and buries the login window.
      // Instead, wait for the window to close so the overlay stays lowered
      // while the user interacts with the iRacing login.
      _loginWin.once('closed', () => {
        resolve({ success: false, error: 'Login window closed' });
      });
      return;
    }

    _bearerToken = null;  // reset any previous token
    _loginWin = createLoginWindow();

    // ── Register ALL event handlers BEFORE loadURL ──
    // On Windows (especially with NVIDIA 4090 / fast GPUs), ready-to-show
    // can fire synchronously during loadURL. Attaching after = missed event
    // = window never shows = app appears frozen.

    _loginWin.once('ready-to-show', () => {
      if (_loginWin && !_loginWin.isDestroyed()) _loginWin.show();
    });

    _loginWin.on('closed', () => {
      clearAuthPolling();
      _loginWin = null;
      // Always resolve so the IPC reply is sent (never leave the promise hanging)
      resolve({ success: false, error: 'Login window closed' });
    });

    // ── Crash / error recovery for the iRacing window ──
    // Without these, a renderer or GPU crash leaves a zombie window that
    // blocks auth polling and can cascade-crash the overlay on Windows.
    _loginWin.webContents.on('render-process-gone', (_event, details) => {
      log(`iRacing renderer crashed: ${details.reason} (exit ${details.exitCode})`);
      clearAuthPolling();
      if (_loginWin && !_loginWin.isDestroyed()) { _loginWin.close(); _loginWin = null; }
      resolve({ success: false, error: `iRacing renderer crashed: ${details.reason}` });
    });

    _loginWin.webContents.on('unresponsive', () => {
      log('iRacing window unresponsive');
    });

    _loginWin.webContents.on('responsive', () => {
      log('iRacing window responsive again');
    });

    _loginWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;  // ignore subframe failures
      log(`iRacing failed to load: ${errorDescription} (code ${errorCode}) — ${validatedURL}`);
      // Don't close on redirects (errorCode -3) — iRacing OAuth redirects trigger this
      if (errorCode === -3) return;
      clearAuthPolling();
      if (_loginWin && !_loginWin.isDestroyed()) { _loginWin.close(); _loginWin = null; }
      resolve({ success: false, error: `Failed to load iRacing: ${errorDescription}` });
    });

    // Poll for auth: detect when we're on members-ng.iracing.com
    // and cookies allow data API access
    startAuthPolling(resolve);

    // Load the iRacing web client directly on members-ng.iracing.com.
    // This is the modern racing dashboard — it talks to the data API
    // using session cookies, which our interceptor captures.
    // If not logged in, iRacing will redirect to their OAuth login page,
    // then back here after auth. The persist:iracing session remembers
    // cookies across app restarts so re-login is rarely needed.
    // IMPORTANT: loadURL must come AFTER all event handlers are attached.
    _loginWin.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard').catch((err) => {
      log('Failed to load iRacing: ' + err.message);
    });
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

      // Auth confirmed — don't auto-sync (it's jarring).
      // Just mark connected and let the user click Sync Now when ready.
      log('Cookie-based auth confirmed! Ready to sync (click Sync Now).');
      clearAuthPolling();
      resolved = true;

      emitter.emit('auth-success', { custId: 'pending', displayName: 'Connected' });
      updateSidebarStatus(true, 'Connected', '', null);
      resolve({ success: true });
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

  // Cookie-based: open a hidden window on the dashboard
  // Use a reasonable viewport so Angular renders the full dashboard DOM
  const hiddenWin = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:iracing',
    },
  });

  try {
    await hiddenWin.loadURL('https://members-ng.iracing.com/web/racing/home/dashboard');

    // Give the SPA time to fully render the dashboard (Angular SSR + hydration)
    await new Promise(r => setTimeout(r, 6000));

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

    // Auth confirmed — run DOM scraping on this window to get iRating data
    log('Auth confirmed, running DOM scrape on hidden window...');
    await runSync(hiddenWin.webContents);

    hiddenWin.close();
    return { success: true };
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
  log,
});
