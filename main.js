// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Electron Overlay
// Transparent, always-on-top, click-through overlay window
// that renders the HTML dashboard over the sim
// ═══════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu, desktopCapturer, session } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const remoteServer = require('./remote-server');
const updater      = require('./modules/js/auto-updater');
const ffmpegEncoder  = require('./modules/js/ffmpeg-encoder');
const replayDirector = require('./modules/js/replay-director');

// ── Crash log ───────────────────────────────────────────────
// Write a log file next to the app so crash info is visible
const LOG_PATH = path.join(__dirname, 'k10-debug.log');
function logToFile(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch (e) { /* non-critical */ }
  console.log(msg);
}

// Catch crashes that would silently kill the process
process.on('uncaughtException', (err) => {
  logToFile(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logToFile(`UNHANDLED REJECTION: ${reason}`);
});

// ── App name ──────────────────────────────────────────────────
app.setName('K10 Motorsports');

// ── GPU / sandbox flags ─────────────────────────────────────
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');

if (process.env.K10_FORCE_SOFTWARE === '1') {
  app.disableHardwareAcceleration();
}

// ── Settings helpers ─────────────────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'overlay-settings.json');
}

function loadSettingsSync() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveSettingsSync(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

// ── iRating / Safety Rating persistence ──────────────────────
function getRatingPath() {
  return path.join(app.getPath('userData'), 'irating-history.json');
}

function loadRatingData() {
  try {
    return JSON.parse(fs.readFileSync(getRatingPath(), 'utf8'));
  } catch (e) {
    return { iRating: 0, safetyRating: 0, history: [] };
  }
}

function saveRatingData(data) {
  fs.writeFileSync(getRatingPath(), JSON.stringify(data, null, 2));
}

// ── Driver profile / car history persistence ─────────────────
function getProfilePath() {
  return path.join(app.getPath('userData'), 'driver-profile.json');
}

function loadProfileData() {
  try {
    return JSON.parse(fs.readFileSync(getProfilePath(), 'utf8'));
  } catch (e) {
    return { carSessions: {} };
  }
}

function saveProfileData(data) {
  fs.writeFileSync(getProfilePath(), JSON.stringify(data, null, 2));
}

// ── Window bounds persistence (green-screen mode only) ───────
function getBoundsPath() {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(getBoundsPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveBounds(bounds) {
  try {
    fs.writeFileSync(getBoundsPath(), JSON.stringify(bounds));
  } catch (e) { /* non-critical */ }
}

// (Local asset server removed — no longer needed. Dashboard is a single inlined HTML file.)

// ── State ────────────────────────────────────────────────────
let overlayWindow = null;
let settingsWindow = null;   // detached settings on secondary display
let mozaWindow = null;       // Moza hardware manager window
let settingsMode = false;
let greenScreenMode = false;
let isIdleMode = false;          // true when driver is not in car (overlay → normal app)
let isInRace = false;            // true when poll-engine reports an active session (drives overlay visibility)
let rendererCrashCount = 0;

// ── Inverted-shell flag ──────────────────────────────────────
// When true, the web-app window opens at startup as the primary surface
// and the overlay window is created hidden, revealed only when isInRace flips
// true. Read from settings so users can fall back to the legacy overlay-first
// behaviour (useful for broadcasters who always want the HUD on screen).
// Default: true — the new architecture is the intended UX.
function shouldInvertShell() {
  try {
    const s = loadSettingsSync();
    return s.invertShell !== false;
  } catch {
    return true;
  }
}
// Single dashboard: vanilla TypeScript build (Vite-bundled, single-file HTML)
const DASHBOARD_FILE = 'dashboard.html';

function getDashboardFile() {
  return DASHBOARD_FILE;
}

async function createOverlay() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.bounds;

  // Check if green screen mode is enabled in saved settings
  const settings = loadSettingsSync();
  greenScreenMode = settings.greenScreen === true;
  // In the inverted shell, the overlay starts hidden and is only revealed
  // when poll-engine reports isInRace=true. Green-screen users (broadcasters)
  // always get a visible overlay — no session gating for that workflow.
  const startHidden = shouldInvertShell() && !greenScreenMode;

  logToFile(`[K10] Dashboard: ${getDashboardFile()}`);

  const mode = greenScreenMode ? 'green-screen' : 'transparent';
  logToFile(`[K10] Window mode: ${mode}`);
  logToFile(`[K10] Primary display: ${screenW}x${screenH} at (${primaryDisplay.bounds.x}, ${primaryDisplay.bounds.y})`);

  /** Load the dashboard into the overlay window via file:// (all assets inlined). */
  function loadDashboard() {
    logToFile('[K10] Loading dashboard via file://');
    overlayWindow.loadFile(path.join(__dirname, getDashboardFile()));
  }

  if (greenScreenMode) {
    // ── Green-screen mode ──
    const saved = loadBounds();
    const defaultW = Math.round(screenW * 0.6);
    const defaultH = Math.round(screenH * 0.5);
    const defaultX = Math.round((screenW - defaultW) / 2);
    const defaultY = Math.round((screenH - defaultH) / 2);

    overlayWindow = new BrowserWindow({
      width:  saved?.width  || defaultW,
      height: saved?.height || defaultH,
      x:      saved?.x      ?? defaultX,
      y:      saved?.y      ?? defaultY,
      icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      movable: true,
      hasShadow: false,
      focusable: true,
      transparent: false,
      backgroundColor: '#00FF00',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    // Persist bounds on move/resize
    overlayWindow.on('moved',   () => saveBounds(overlayWindow.getBounds()));
    overlayWindow.on('resized', () => saveBounds(overlayWindow.getBounds()));

    // Green screen windows are always interactive (no click-through)
    loadDashboard();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');

    // Inject opaque-mode class after page loads
    overlayWindow.webContents.on('did-finish-load', () => {
      rendererCrashCount = 0;
      overlayWindow.webContents.executeJavaScript(`
        document.body.classList.add('opaque-mode');
      `);
    });

  } else {
    // ── Transparent overlay mode ──
    // macOS: use workArea to respect the dock and menu bar.
    // Windows: use full bounds so the overlay covers the entire screen over the game.
    const isMac = process.platform === 'darwin';
    const overlayBounds = isMac ? primaryDisplay.workArea : primaryDisplay.bounds;

    overlayWindow = new BrowserWindow({
      width:  overlayBounds.width,
      height: overlayBounds.height,
      x:      overlayBounds.x,
      y:      overlayBounds.y,
      icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
      // Start hidden in the inverted shell; shown when isInRace flips true.
      show: !startHidden,
      frame: false,
      alwaysOnTop: true,
      // In the inverted shell the overlay is session-only — hide from taskbar
      // so the only persistent app tile is the web dashboard.
      skipTaskbar: startHidden,
      resizable: false,
      hasShadow: false,
      focusable: false,
      minimizable: false,
      maximizable: false,
      transparent: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    loadDashboard();
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    if (startHidden) {
      logToFile('[K10] Inverted shell: overlay created hidden (awaiting isInRace)');
    }

    overlayWindow.webContents.on('did-finish-load', () => {
      rendererCrashCount = 0;
    });
  }

  overlayWindow.on('closed', () => { overlayWindow = null; });

  // ── Reflow overlay when system UI changes ──
  // Windows: taskbar auto-hide changes workArea — reflow to full bounds.
  // macOS: dock resize/show/hide changes workArea — reflow to workArea.
  if (!greenScreenMode) {
    screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      if (!changedMetrics.includes('workArea') && !changedMetrics.includes('bounds')) return;

      const primary = screen.getPrimaryDisplay();
      if (display.id !== primary.id) return;

      // macOS: respect dock/menu bar via workArea. Windows: cover full screen.
      const target = process.platform === 'darwin' ? primary.workArea : primary.bounds;
      const cur = overlayWindow.getBounds();
      if (cur.x === target.x && cur.y === target.y && cur.width === target.width && cur.height === target.height) return;

      logToFile(`[K10] Display metrics changed (${changedMetrics.join(', ')}), reflowing overlay to ${target.width}x${target.height}`);
      overlayWindow.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height });
    });
  }

  // ── Windows: periodically re-assert always-on-top ──────────
  // DirectX fullscreen exclusive mode can steal z-order even from
  // screen-saver level windows. Re-assert every 5 seconds.
  if (process.platform === 'win32') {
    setInterval(() => {
      if (overlayWindow && !overlayWindow.isDestroyed() && !settingsMode && !isIdleMode) {
        overlayWindow.setAlwaysOnTop(false);
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 5000);
  }

  // ── Crash recovery ──────────────────────────────────────────
  overlayWindow.webContents.on('render-process-gone', (_event, details) => {
    logToFile(`[K10] Renderer crashed: ${details.reason}`);
    if (details.reason === 'crashed' || details.reason === 'killed') {
      rendererCrashCount++;
      if (rendererCrashCount > 3) {
        logToFile('[K10] Renderer crash limit reached (3) — giving up');
        return;
      }
      setTimeout(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          loadDashboard();
        }
      }, 2000);
    }
  });

  overlayWindow.webContents.on('unresponsive', () => {
    logToFile('[K10] Renderer unresponsive — reloading');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      loadDashboard();
    }
  });

  // ── GPU process crash handler ───────────────────────────────
  app.on('child-process-gone', (_event, details) => {
    logToFile(`[K10] Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.type === 'GPU') {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        logToFile('[K10] GPU process crashed — reloading dashboard');
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            loadDashboard();
          }
        }, 2000);
      }
    }
  });
}

// ── Remote Dashboard Server ──────────────────────────────────
// Auto-start the LAN server if enabled in settings
async function maybeStartRemoteServer() {
  const settings = loadSettingsSync();
  if (settings.remoteServer !== true) return;
  try {
    const simhubUrl = settings.simhubUrl
      ? settings.simhubUrl.replace(/\/racecor-io-pro-drive\/?$/, '')
      : 'http://localhost:8889';
    const info = await remoteServer.start({
      port: settings.remoteServerPort || remoteServer.DEFAULT_PORT,
      appDir: __dirname,
      simhubUrl: simhubUrl,
      log: logToFile,
    });
    logToFile(`[K10] Remote dashboard: ${info.url} (iPad/tablet access)`);
  } catch (err) {
    logToFile(`[K10] Remote server failed to start: ${err.message}`);
  }
}

// ── Settings mode ────────────────────────────────────────────
function enterSettingsMode() {
  if (!overlayWindow) return;
  settingsMode = true;
  if (!greenScreenMode) {
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.setFocusable(true);
  }
  overlayWindow.focus();
  overlayWindow.webContents.send('settings-mode', true);
  console.log('[K10] Settings mode ON');
}

function exitSettingsMode() {
  if (!overlayWindow) return;
  settingsMode = false;
  if (!greenScreenMode) {
    if (isIdleMode) {
      // Idle: keep window interactive for nav bar buttons
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.setFocusable(true);
    } else {
      // Race: restore click-through overlay
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    }
  }
  if (greenScreenMode) {
    saveBounds(overlayWindow.getBounds());
  }
  overlayWindow.webContents.send('settings-mode', false);
  console.log('[K10] Settings mode OFF');
}

logToFile('[K10] App starting...');

app.whenReady().then(() => {
  // Remove the default Electron menu bar (File/Edit/View/etc) from all windows
  Menu.setApplicationMenu(null);

  logToFile(`[K10] Platform: ${os.platform()} ${os.arch()} | Electron ${process.versions.electron}`);
  logToFile('[K10] Hotkeys: Ctrl+Shift+S/H/G/R/D/M/Q');
  try {
    createOverlay();
    logToFile('[K10] Overlay window created OK');

    // ── Display media handler for screen recording ──
    // Electron 33+ requires this to allow getDisplayMedia() in the renderer.
    // Automatically grant access to the primary screen without a picker dialog.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          callback({ video: null });
        }
      } catch (err) {
        logToFile(`[K10] Display media handler error: ${err.message}`);
        callback({ video: null });
      }
    });

    maybeStartRemoteServer();
    updater.initAutoUpdater(overlayWindow, logToFile);

    // ── Auto-install Stream Deck plugin on first run ──
    autoInstallStreamDeckPlugin();

    // ── Inverted shell: open the web-app window as the primary surface ──
    // The overlay starts hidden and is revealed when poll-engine reports
    // isInRace=true. Users boot into the web dashboard by default; the
    // overlay is only on-screen while they are actually in a sim session.
    if (shouldInvertShell() && !greenScreenMode) {
      // Small deferral so the overlay renderer finishes its initial load
      // before we open a second window (avoids any IPC races during boot).
      setTimeout(() => {
        try {
          openDashboardWindow();
          logToFile('[K10] Inverted shell: web-app window opened as primary surface');
        } catch (err) {
          logToFile(`[K10] Failed to open web-app window: ${err.message}`);
        }
      }, 250);
    }
  } catch (err) {
    logToFile(`[K10] FATAL: createOverlay() threw: ${err.stack || err.message}`);
    app.quit();
    return;
  }

  // ── AUTO-CONNECT iRacing ──
  // Open the iRacing web client and start syncing on app launch.
  // No clicks needed — just opens the window and goes.
  //
  // ── GLOBAL HOTKEYS ──

  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) overlayWindow.hide();
      else overlayWindow.show();
    }
  });

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!overlayWindow) return;
    if (settingsMode) exitSettingsMode();
    else enterSettingsMode();
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (!overlayWindow) return;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    if (greenScreenMode) {
      // Reset to centered 60% × 50% window
      const w = Math.round(sw * 0.6);
      const h = Math.round(sh * 0.5);
      overlayWindow.setBounds({ x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), width: w, height: h });
      saveBounds(overlayWindow.getBounds());
    } else {
      overlayWindow.setBounds({ x: 0, y: 0, width: sw, height: sh });
    }
    console.log('[K10] Window position/size reset');
  });

  globalShortcut.register('CommandOrControl+Shift+G', () => {
    // Toggle green-screen mode and restart
    const settings = loadSettingsSync();
    settings.greenScreen = !settings.greenScreen;
    saveSettingsSync(settings);
    const mode = settings.greenScreen ? 'green-screen' : 'transparent';
    console.log(`[K10] Toggling to ${mode} mode — restarting...`);
    app.relaunch();
    app.exit(0);
  });

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.quit();
  });

  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (overlayWindow) overlayWindow.webContents.send('restart-demo');
  });

  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (overlayWindow) overlayWindow.webContents.send('reset-trackmap');
  });

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-rating-editor');
  });

  globalShortcut.register('CommandOrControl+Shift+U', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-driver-profile');
  });

  globalShortcut.register('CommandOrControl+Shift+F', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-drive-mode');
  });

  globalShortcut.register('CommandOrControl+Shift+V', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-recording');
  });

  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (overlayWindow) overlayWindow.webContents.send('save-replay-buffer');
  });

  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (overlayWindow) overlayWindow.webContents.send('toggle-replay-director');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ═══════════════════════════════════════════════════════════════
// STREAM DECK ACTION API
// Centralized dispatcher for all overlay actions. Called by
// both global hotkeys and the HTTP action endpoint so Stream
// Deck can trigger any action via a simple GET request.
// ═══════════════════════════════════════════════════════════════

const _actionHandlers = {
  // ── Window / App ──
  'toggle-overlay': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    if (overlayWindow.isVisible()) overlayWindow.hide();
    else overlayWindow.show();
    return { ok: true, visible: overlayWindow.isVisible() };
  },
  'toggle-settings': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    if (settingsMode) exitSettingsMode();
    else enterSettingsMode();
    return { ok: true, settingsMode };
  },
  'reset-window': () => {
    if (!overlayWindow) return { ok: false, reason: 'no window' };
    const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
    if (greenScreenMode) {
      const w = Math.round(sw * 0.6);
      const h = Math.round(sh * 0.5);
      overlayWindow.setBounds({ x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), width: w, height: h });
      saveBounds(overlayWindow.getBounds());
    } else {
      overlayWindow.setBounds({ x: 0, y: 0, width: sw, height: sh });
    }
    return { ok: true };
  },
  'toggle-greenscreen': () => {
    const settings = loadSettingsSync();
    settings.greenScreen = !settings.greenScreen;
    saveSettingsSync(settings);
    app.relaunch();
    app.exit(0);
    return { ok: true };
  },
  'quit': () => {
    app.quit();
    return { ok: true };
  },

  // ── Renderer IPC passthrough ──
  'restart-demo':           () => _sendRenderer('restart-demo'),
  'reset-trackmap':         () => _sendRenderer('reset-trackmap'),
  'toggle-rating-editor':   () => _sendRenderer('toggle-rating-editor'),
  'toggle-driver-profile':  () => _sendRenderer('toggle-driver-profile'),
  'toggle-drive-mode':      () => _sendRenderer('toggle-drive-mode'),
  'toggle-recording':       () => _sendRenderer('toggle-recording'),
  'save-replay-buffer':     () => _sendRenderer('save-replay-buffer'),
  'toggle-replay-director': () => _sendRenderer('toggle-replay-director'),

  // ── New actions (not bound to hotkeys) ──
  'pitbox-next-tab':     () => _sendRenderer('pitbox-next-tab'),
  'pitbox-prev-tab':     () => _sendRenderer('pitbox-prev-tab'),
  'dismiss-commentary':  () => _sendRenderer('dismiss-commentary'),
  'cycle-rating':        () => _sendRenderer('cycle-rating'),
  'cycle-car-logo':      () => _sendRenderer('cycle-car-logo'),
  'zoom-in':             () => _sendRenderer('zoom-in'),
  'zoom-out':            () => _sendRenderer('zoom-out'),
  'toggle-leaderboard':  () => _sendRenderer('toggle-leaderboard'),

  // ── Mode presets ──
  'preset-broadcast': () => _sendRenderer('preset-broadcast'),
  'preset-practice':  () => _sendRenderer('preset-practice'),
  'preset-qualifying': () => _sendRenderer('preset-qualifying'),
};

function _sendRenderer(channel) {
  if (!overlayWindow) return { ok: false, reason: 'no window' };
  overlayWindow.webContents.send(channel);
  return { ok: true };
}

/**
 * Execute a named action. Returns a result object.
 * @param {string} name — action name (e.g. 'toggle-overlay')
 * @returns {{ ok: boolean, reason?: string }}
 */
function dispatchAction(name) {
  const handler = _actionHandlers[name];
  if (!handler) return { ok: false, reason: 'unknown action: ' + name };
  try {
    return handler();
  } catch (err) {
    logToFile(`[K10] Action error (${name}): ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// Expose dispatcher to remote-server.js for HTTP action API
remoteServer.setActionDispatcher(dispatchAction);

app.on('window-all-closed', () => {
  app.quit();
});

// ── Stream Deck plugin auto-install on first run ──
// Checks if the plugin is already installed; if not, installs it silently.
// Tracked via settings.streamDeckPluginInstalled so it only runs once.
function autoInstallStreamDeckPlugin() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const fs = require('fs');
  const os = require('os');
  const settings = loadSettingsSync();
  if (settings.streamDeckPluginInstalled) return;

  // Check if Stream Deck is installed by looking for its plugin directory
  let sdPluginsDir;
  if (process.platform === 'win32') {
    sdPluginsDir = path.join(process.env.APPDATA || '', 'Elgato', 'StreamDeck', 'Plugins');
  } else {
    sdPluginsDir = path.join(os.homedir(), 'Library', 'Application Support',
      'com.elgato.StreamDeck', 'Plugins');
  }

  if (!fs.existsSync(sdPluginsDir)) {
    logToFile('[K10] Stream Deck not found — skipping plugin install');
    return;
  }

  // Check if already installed
  const installedDir = path.join(sdPluginsDir, 'com.k10motorsports.racecor.overlay.sdPlugin');
  if (fs.existsSync(installedDir)) {
    logToFile('[K10] Stream Deck plugin already installed');
    settings.streamDeckPluginInstalled = true;
    saveSettingsSync(settings);
    return;
  }

  // Copy the plugin directory into Stream Deck's Plugins folder
  const srcDir = path.join(__dirname, 'streamdeck', 'racecor',
    'com.k10motorsports.racecor.overlay.sdPlugin');
  if (!fs.existsSync(srcDir)) {
    logToFile('[K10] Stream Deck plugin source not found in app bundle');
    return;
  }

  try {
    fs.cpSync(srcDir, installedDir, { recursive: true });
    settings.streamDeckPluginInstalled = true;
    saveSettingsSync(settings);
    logToFile('[K10] Stream Deck plugin installed to: ' + installedDir);
  } catch (err) {
    logToFile('[K10] Stream Deck plugin install failed: ' + err.message);
  }
}

// ── IPC: Stream Deck plugin install ──
// Zips the bundled .sdPlugin directory into a .streamDeckPlugin file
// and opens it, which triggers the Stream Deck app to install the plugin.
ipcMain.handle('install-streamdeck-plugin', async () => {
  const fs = require('fs');
  const os = require('os');
  const { execSync } = require('child_process');
  const sdPluginDir = path.join(__dirname, 'streamdeck', 'racecor',
    'com.k10motorsports.racecor.overlay.sdPlugin');

  if (!fs.existsSync(sdPluginDir)) {
    logToFile('[K10] Stream Deck plugin not found at: ' + sdPluginDir);
    return { ok: false, reason: 'Plugin files not found in app bundle' };
  }

  const tmpFile = path.join(os.tmpdir(),
    'com.k10motorsports.racecor.overlay.streamDeckPlugin');

  try {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    const parentDir = path.dirname(sdPluginDir);
    const dirName = path.basename(sdPluginDir);

    if (process.platform === 'win32') {
      execSync(`powershell -Command "Compress-Archive -Path '${dirName}' -DestinationPath '${tmpFile}' -Force"`,
        { cwd: parentDir, timeout: 15000 });
    } else {
      execSync(`zip -r "${tmpFile}" "${dirName}"`,
        { cwd: parentDir, timeout: 15000 });
    }

    await shell.openPath(tmpFile);
    logToFile('[K10] Stream Deck plugin install triggered');
    return { ok: true };
  } catch (err) {
    logToFile('[K10] Stream Deck plugin install error: ' + err.message);
    return { ok: false, reason: err.message };
  }
});

// ── IPC: Interactive mode (for connection banner / settings) ──
ipcMain.handle('request-interactive', async () => {
  if (!overlayWindow || greenScreenMode) return;
  settingsMode = true;
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.setFocusable(true);
  overlayWindow.focus();
  console.log('[K10] Interactive mode ON — window accepts input');
});

ipcMain.handle('release-interactive', async () => {
  if (!overlayWindow || greenScreenMode) return;
  settingsMode = false;
  if (isIdleMode) {
    // Idle: keep interactive for nav bar
    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindow.setFocusable(true);
  } else {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
  }
  console.log('[K10] Interactive mode OFF — click-through restored');
});

// ── IPC: Idle/race window mode switching ──
// When idle (not in car): normal app behavior — visible in taskbar, not always-on-top,
// focusable via alt-tab. When racing: overlay mode — always-on-top, skip taskbar,
// click-through. The nav bar buttons use pointer-events:auto on individual elements,
// so the window itself stays click-through in both modes.
ipcMain.handle('notify-idle-state', async (_event, idle) => {
  if (!overlayWindow || greenScreenMode) return;
  if (idle === isIdleMode) return;   // no change
  isIdleMode = idle;

  if (idle) {
    // Idle mode: behave like a normal app window — fully interactive
    // so the idle logo and nav bar buttons can be clicked.
    overlayWindow.setAlwaysOnTop(false);
    if (!settingsMode) {
      overlayWindow.setIgnoreMouseEvents(false);
      overlayWindow.setFocusable(true);
    }
    console.log('[K10] Idle mode — taskbar visible, interactive, not always-on-top');
  } else {
    // Race mode: overlay on top of the game
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    if (!settingsMode) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    }
    console.log('[K10] Race mode — always-on-top, taskbar hidden');
  }
});

// ── IPC: In-race state (drives overlay visibility in inverted shell) ──
// The poll-engine (in the overlay renderer) emits this on every
// debounced flip. When the inverted-shell flag is on, the overlay window
// is revealed only while in a sim session. Broadcasts to the web-app
// window so it can render live session status.
ipcMain.handle('notify-in-race-state', async (_event, inRace) => {
  if (inRace === isInRace) return;   // no change
  isInRace = !!inRace;

  // Broadcast to the web-app window so its UI can reflect live session state.
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.webContents.send('in-race-state', isInRace);
  }

  // Only gate overlay visibility when the inverted shell is enabled.
  // Legacy mode: overlay is always visible.
  if (!shouldInvertShell()) return;
  if (!overlayWindow || overlayWindow.isDestroyed() || greenScreenMode) return;

  if (isInRace) {
    // Reveal the overlay without stealing focus from the game.
    overlayWindow.showInactive();
    if (!settingsMode) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    }
    logToFile('[K10] In-race → overlay revealed');
  } else {
    overlayWindow.hide();
    logToFile('[K10] Out of race → overlay hidden');
  }
});

// Expose the current in-race state so the web window can decide initial UI
// on load (rather than waiting for the next flip — which may not come for
// minutes if the user is already in a steady state).
ipcMain.handle('get-in-race-state', async () => {
  return isInRace;
});

// ── IPC: Screen recording ──────────────────────────────────────
// The renderer handles capture via getDisplayMedia + MediaRecorder.
// Main process owns the file I/O: creates the write stream, receives
// chunks from the renderer, and finalizes the file on stop.
let _recordingStream = null;
let _recordingPath = null;
let _recordingStartTime = null;
let _recordingBytesWritten = 0;
let _recordingChunkCount = 0;
let _lastChunkDebugAt = 0;

function getRecordingDir() {
  // Use user-configured directory, fall back to system Videos folder
  const settings = loadSettingsSync();
  const dir = settings.recordingDirectory || app.getPath('videos');
  // Ensure the directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

ipcMain.handle('start-recording', async (_event, options = {}) => {
  if (_recordingStream) {
    return { error: 'Already recording' };
  }
  try {
    const settings = loadSettingsSync();
    const dir = getRecordingDir();
    const dirSource = settings.recordingDirectory ? 'settings' : 'default';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const ext = options.ext || 'webm';
    const filename = `RaceCor_${ts}.${ext}`;
    _recordingPath = path.join(dir, filename);
    _recordingStream = fs.createWriteStream(_recordingPath);
    _recordingStartTime = Date.now();
    _recordingBytesWritten = 0;
    _recordingChunkCount = 0;
    _lastChunkDebugAt = 0;

    const logMsg = `[K10] Recording started: ${_recordingPath} (from ${dirSource})`;
    logToFile(logMsg);
    console.log(logMsg);

    // Send debug event to renderer
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('recording-debug', {
        kind: 'start',
        path: _recordingPath,
        filename: filename,
        dir: dir,
        dirSource: dirSource,
      });
    }

    return { success: true, path: _recordingPath, filename };
  } catch (err) {
    logToFile(`[K10] Recording start error: ${err.message}`);
    return { error: err.message };
  }
});

ipcMain.handle('write-recording-chunk', async (_event, arrayBuffer) => {
  if (!_recordingStream) return;
  try {
    _recordingStream.write(Buffer.from(arrayBuffer));
    _recordingBytesWritten += arrayBuffer.byteLength;
    _recordingChunkCount += 1;

    // Throttled debug event: only send once every 2 seconds
    const now = Date.now();
    if (now - _lastChunkDebugAt >= 2000) {
      _lastChunkDebugAt = now;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('recording-debug', {
          kind: 'chunk',
          bytesWritten: _recordingBytesWritten,
          chunkCount: _recordingChunkCount,
        });
      }
    }
  } catch (err) {
    logToFile(`[K10] Recording write error: ${err.message}`);
  }
});

ipcMain.handle('stop-recording', async () => {
  if (!_recordingStream) {
    return { error: 'Not recording' };
  }
  return new Promise((resolve) => {
    const filePath = _recordingPath;
    const duration = Date.now() - _recordingStartTime;
    _recordingStream.end(() => {
      let fileSize = 0;
      try { fileSize = fs.statSync(filePath).size; } catch (e) { /* ok */ }
      const sizeStr = (fileSize / 1024 / 1024).toFixed(1);
      const durationStr = (duration / 1000).toFixed(1);
      const logMsg = `[K10] Recording stopped: ${filePath} (${sizeStr} MB, ${durationStr}s)`;
      logToFile(logMsg);
      console.log(logMsg);

      // Send debug event to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('recording-debug', {
          kind: 'stop',
          path: filePath,
          filename: path.basename(filePath),
          fileSize: fileSize,
          duration: duration,
        });
      }

      resolve({ success: true, path: filePath, fileSize, duration });
    });
    _recordingStream = null;
    _recordingPath = null;
    _recordingStartTime = null;
  });
});

ipcMain.handle('get-recording-state', async () => {
  return {
    recording: !!_recordingStream,
    path: _recordingPath,
    duration: _recordingStartTime ? Date.now() - _recordingStartTime : 0,
  };
});

// ── IPC: Telemetry sidecar (.telemetry.jsonl alongside video) ──
// The renderer writes frame-synced telemetry data as JSON Lines.
// We keep a write stream open per-sidecar for efficient appending.
let _sidecarStreams = {};  // path → fs.WriteStream

ipcMain.handle('sidecar-start', async (_event, filePath) => {
  try {
    if (_sidecarStreams[filePath]) {
      _sidecarStreams[filePath].end();
    }
    _sidecarStreams[filePath] = fs.createWriteStream(filePath, { flags: 'w' });
    logToFile(`[K10] Sidecar started: ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    logToFile(`[K10] Sidecar start error: ${err.message}`);
    return { error: err.message };
  }
});

ipcMain.on('sidecar-write', (_event, filePath, chunk) => {
  // Use ipcMain.on (fire-and-forget) for performance — 30 writes/sec
  // However, check for backpressure: if write() returns false, the internal
  // buffer is full and we should wait for 'drain' before accepting more.
  var stream = _sidecarStreams[filePath];
  if (stream && !stream.destroyed) {
    var canWrite = stream.write(chunk);
    if (!canWrite) {
      logToFile(`[K10] Sidecar write backpressure on ${filePath} — waiting for drain`);
      // The renderer will eventually retry or the stream will emit 'drain'
      // and automatically resume. Log this edge case for monitoring.
    }
  }
});

ipcMain.handle('sidecar-stop', async (_event, filePath) => {
  var stream = _sidecarStreams[filePath];
  if (stream) {
    stream.end();
    delete _sidecarStreams[filePath];
    logToFile(`[K10] Sidecar stopped: ${filePath}`);
  }
  return { success: true };
});

// ── IPC: Replay buffer save ──
// Saves a chunk of buffered recording data to a timestamped clip file.
ipcMain.handle('save-replay-buffer', async (_event, options) => {
  try {
    const dir = getRecordingDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const filename = `RaceCor_Replay_${ts}.webm`;
    const filePath = path.join(dir, filename);
    // options.data is an ArrayBuffer from the renderer
    const buf = Buffer.from(options.data);
    fs.writeFileSync(filePath, buf);
    const fileSize = fs.statSync(filePath).size;
    logToFile(`[K10] Replay buffer saved: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    return { success: true, path: filePath, filename, fileSize };
  } catch (err) {
    logToFile(`[K10] Replay buffer save error: ${err.message}`);
    return { error: err.message };
  }
});

// ── IPC: FFmpeg transcode (.webm → .mp4) ──
// After recording stops, the renderer can request a transcode to MP4
// with hardware-accelerated encoding (NVENC on the 4090).
let _transcoding = false;

ipcMain.handle('get-ffmpeg-info', async () => {
  const ffmpegPath = ffmpegEncoder.getFfmpegPath();
  const encoder = ffmpegEncoder.detectEncoder();
  return {
    available: !!ffmpegPath,
    path: ffmpegPath,
    encoder: encoder,
    hardware: encoder && encoder !== 'libx264',
  };
});

ipcMain.handle('transcode-recording', async (_event, webmPath, options) => {
  if (_transcoding) {
    return { error: 'Transcode already in progress' };
  }
  if (!webmPath || !fs.existsSync(webmPath)) {
    return { error: 'Source file not found: ' + webmPath };
  }

  _transcoding = true;
  logToFile(`[K10] Transcode starting: ${webmPath}`);

  try {
    var result = await ffmpegEncoder.transcode(webmPath, options, function (progress) {
      // Forward progress to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('transcode-progress', progress);
      }
    });

    logToFile(`[K10] Transcode complete: ${result.outputPath} (${(result.fileSize / 1024 / 1024).toFixed(1)} MB, encoder: ${result.encoder})`);

    // Delete source .webm if transcode succeeded and setting allows
    if (options && options.deleteSource !== false) {
      ffmpegEncoder.cleanupSource(webmPath);
      logToFile(`[K10] Deleted source .webm: ${webmPath}`);
    }

    _transcoding = false;
    return result;
  } catch (err) {
    _transcoding = false;
    logToFile(`[K10] Transcode error: ${err.message}`);
    return { error: err.message };
  }
});

// ── IPC: Replay Director (Phase 5) ──
// Automates iRacing replay recording of TV-view moments identified
// by the telemetry sidecar. Sends keyboard input to iRacing.

ipcMain.handle('start-replay-director', async (_event, sidecarPath) => {
  if (replayDirector.isRunning()) {
    return { error: 'Replay director is already running' };
  }
  if (!sidecarPath || !fs.existsSync(sidecarPath)) {
    return { error: 'Sidecar file not found: ' + sidecarPath };
  }

  logToFile(`[K10] Replay director starting: ${sidecarPath}`);

  // Run in background — don't await (it takes minutes)
  replayDirector.run(sidecarPath, {
    onProgress: function (progress) {
      // Forward progress to renderer
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('replay-director-progress', progress);
      }
      if (progress.status === 'recording_start') {
        // Tell renderer to start the screen recording
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('replay-director-record', { action: 'start' });
        }
      } else if (progress.status === 'recording_stop') {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('replay-director-record', { action: 'stop' });
        }
      }
      logToFile(`[K10] Replay director: ${progress.status} — ${progress.message || ''}`);
    },
  }).then(function (result) {
    logToFile(`[K10] Replay director finished: ${JSON.stringify(result)}`);
  }).catch(function (err) {
    logToFile(`[K10] Replay director error: ${err.message}`);
  });

  return { success: true, message: 'Replay director started' };
});

ipcMain.handle('cancel-replay-director', async () => {
  replayDirector.cancel();
  return { success: true };
});

ipcMain.handle('get-replay-director-state', async () => {
  return replayDirector.getProgress();
});

ipcMain.handle('parse-sidecar-moments', async (_event, sidecarPath) => {
  try {
    const moments = replayDirector.parseSidecar(sidecarPath);
    const estimatedSec = replayDirector.estimateTime(moments);
    return { success: true, moments, estimatedSeconds: estimatedSec };
  } catch (err) {
    return { error: err.message };
  }
});

// ── IPC: Detach settings to secondary display ──
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  // Pick the secondary display, fall back to primary if only one monitor
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find(d => d.id !== primary.id) || primary;

  const winW = 620;
  const winH = 700;
  const sx = secondary.bounds.x + Math.round((secondary.bounds.width - winW) / 2);
  const sy = secondary.bounds.y + Math.round((secondary.bounds.height - winH) / 2);

  settingsWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: sx,
    y: sy,
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    frame: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#1a1a1a',
    // Skip taskbar so it doesn't fight with the sim for alt-tab focus
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      sandbox: true,
      allowRunningInsecureContent: false,
    }
  });

  // Use 'screen-saver' level so the window stays above fullscreen sims
  settingsWindow.setAlwaysOnTop(true, 'screen-saver');

  // Load the same dashboard with a query flag so renderer knows to show settings only
  settingsWindow.loadFile(path.join(__dirname, getDashboardFile()), {
    query: { settingsPopout: '1' }
  });

  // Recover visibility: when the window is ready, force it visible and
  // on top in case the sim stole focus during load.
  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // If the sim steals focus and the window somehow gets hidden, restore it
  settingsWindow.on('hide', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
    }
  });

  // Verify the window ended up on a valid display; if the target display
  // has unexpected bounds (e.g., removed between detection and creation),
  // move it to center of primary display.
  settingsWindow.once('show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      const bounds = settingsWindow.getBounds();
      const allDisplays = screen.getAllDisplays();
      const onAnyDisplay = allDisplays.some(d => {
        return bounds.x < d.bounds.x + d.bounds.width &&
               bounds.x + bounds.width > d.bounds.x &&
               bounds.y < d.bounds.y + d.bounds.height &&
               bounds.y + bounds.height > d.bounds.y;
      });
      if (!onAnyDisplay) {
        const pri = screen.getPrimaryDisplay();
        settingsWindow.setPosition(
          pri.bounds.x + Math.round((pri.bounds.width - winW) / 2),
          pri.bounds.y + Math.round((pri.bounds.height - winH) / 2)
        );
        logToFile('[K10] Settings window was off-screen, moved to primary display');
      }
    }
  });

  const onDisplayRemoved = () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      // Check if the window is still on a valid display
      const bounds = settingsWindow.getBounds();
      const allDisplays = screen.getAllDisplays();
      const onAnyDisplay = allDisplays.some(d => {
        return bounds.x < d.bounds.x + d.bounds.width &&
               bounds.x + bounds.width > d.bounds.x &&
               bounds.y < d.bounds.y + d.bounds.height &&
               bounds.y + bounds.height > d.bounds.y;
      });
      if (!onAnyDisplay) {
        // Display was removed — move to primary instead of closing
        const pri = screen.getPrimaryDisplay();
        settingsWindow.setPosition(
          pri.bounds.x + Math.round((pri.bounds.width - winW) / 2),
          pri.bounds.y + Math.round((pri.bounds.height - winH) / 2)
        );
        logToFile('[K10] Display removed, moved settings to primary display');
      }
    }
  };

  screen.on('display-removed', onDisplayRemoved);

  settingsWindow.on('closed', () => {
    screen.removeListener('display-removed', onDisplayRemoved);
    settingsWindow = null;
    // Tell main overlay that the popout closed
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('settings-popout-closed');
    }
    logToFile('[K10] Settings popout window closed');
  });

  logToFile(`[K10] Settings popout opened on display "${secondary.label || secondary.id}" at (${sx}, ${sy})`);
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
    settingsWindow = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// WEB DASHBOARD WINDOW
// Normal resizable window loading the live prodrive.racecor.io
// dashboard (or localhost:3000 in dev mode).
// Session cookies persist via partition so the user stays signed in.
// ═══════════════════════════════════════════════════════════════

const isDev = process.argv.includes('--dev');

function getDashboardURL() {
  return isDev
    ? (process.env.K10_DASHBOARD_URL || 'http://localhost:3000')
    : K10_API_BASE;  // https://prodrive.racecor.io — defined later in file
}

let dashboardWindow = null;

function openDashboardWindow(targetPath) {
  // `targetPath` is an optional absolute path (e.g. '/drive/admin/overlay-settings').
  // When provided we navigate the window there — whether it's a fresh open
  // or an existing one being focused. Keeps the "Open web admin" beta-banner
  // entry point in sync with the single-window shell.
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    if (targetPath) {
      dashboardWindow.loadURL(getDashboardURL() + targetPath).catch((err) => {
        logToFile('[K10] Dashboard navigation failed: ' + err.message);
      });
    }
    dashboardWindow.show();
    dashboardWindow.moveTop();
    dashboardWindow.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const winW = Math.min(1280, primary.workAreaSize.width);
  const winH = Math.min(900, primary.workAreaSize.height);

  dashboardWindow = new BrowserWindow({
    width: winW,
    height: winH,
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    frame: true,
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    alwaysOnTop: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    title: 'K10 Pro Drive',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox stays off here — the preload uses `require('electron')` to
      // wire up ipcRenderer. The preload itself is still safe (no Node in
      // the renderer; only the exposeInMainWorld surface is reachable).
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Persist cookies so login survives app restarts
      partition: 'persist:dashboard',
      // Preload exposes `window.k10` so the web app's useElectronBridge hook
      // can detect the bridge and gate admin UI (e.g. AdminNav's Overlay tab)
      // behind `hasBridge === true`.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Tag the UA with `RaceCor/<version>` so the web app's useElectronBridge
  // UA-sniff (`/RaceCor\//i.test(ua)`) flips `isElectron` true. Without this
  // the hook only sees the default Electron UA and assumes it's a browser.
  try {
    const uaSuffix = ` RaceCor/${app.getVersion()}`;
    const current = dashboardWindow.webContents.getUserAgent();
    if (!/RaceCor\//i.test(current)) {
      dashboardWindow.webContents.setUserAgent(current + uaSuffix);
    }
  } catch (e) {
    logToFile('[K10] Failed to tag dashboard UA: ' + e.message);
  }

  // Open external links in the user's default browser
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('dashboard-closed');
    }
    logToFile('[K10] Dashboard window closed');
  });

  const dashURL = getDashboardURL();
  dashboardWindow.loadURL(dashURL).catch((err) => {
    logToFile('[K10] Dashboard failed to load: ' + err.message);
  });

  logToFile(`[K10] Dashboard window opened: ${dashURL}${isDev ? ' (dev)' : ''}`);
}

function closeDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
    dashboardWindow = null;
  }
}

ipcMain.handle('open-dashboard', async (_evt, targetPath) => {
  openDashboardWindow(targetPath);
  return true;
});

ipcMain.handle('close-dashboard', async () => {
  closeDashboardWindow();
  return true;
});

// ═══════════════════════════════════════════════════════════════
// MOZA HARDWARE MANAGER WINDOW
// Dedicated window for the Moza settings panel. Opens from the
// idle nav bar or via IPC. Loads the same dashboard with a query
// flag so the renderer enters Moza-settings-only mode.
// ═══════════════════════════════════════════════════════════════

function openMozaManagerWindow() {
  if (mozaWindow && !mozaWindow.isDestroyed()) {
    mozaWindow.show();
    mozaWindow.moveTop();
    mozaWindow.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const winW = Math.min(560, primary.workAreaSize.width);
  const winH = Math.min(720, primary.workAreaSize.height);

  mozaWindow = new BrowserWindow({
    width: winW,
    height: winH,
    icon: path.join(__dirname, 'images', 'branding', 'icon.png'),
    frame: false,
    autoHideMenuBar: true,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#1a1a1a',
    skipTaskbar: false,
    title: 'Moza Hardware Manager',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      sandbox: true,
    },
  });

  mozaWindow.setAlwaysOnTop(true, 'screen-saver');

  // Load the dashboard with a query flag for Moza-only mode
  mozaWindow.loadFile(path.join(__dirname, getDashboardFile()), {
    query: { mozaManager: '1' }
  });

  mozaWindow.once('ready-to-show', () => {
    if (mozaWindow && !mozaWindow.isDestroyed()) {
      mozaWindow.show();
      mozaWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  mozaWindow.on('closed', () => {
    mozaWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('moza-manager-closed');
    }
    logToFile('[K10] Moza manager window closed');
  });

  logToFile('[K10] Moza manager window opened');
}

function closeMozaManagerWindow() {
  if (mozaWindow && !mozaWindow.isDestroyed()) {
    mozaWindow.close();
    mozaWindow = null;
  }
}

ipcMain.handle('open-moza-manager', async () => {
  openMozaManagerWindow();
  return true;
});

ipcMain.handle('close-moza-manager', async () => {
  closeMozaManagerWindow();
  return true;
});

ipcMain.handle('open-settings-popout', async () => {
  openSettingsWindow();
  return true;
});

ipcMain.handle('close-settings-popout', async () => {
  closeSettingsWindow();
  return true;
});

// Relay settings changes from either window to the other
ipcMain.handle('settings-changed', async (event, settings) => {
  if (typeof settings !== 'object' || settings === null) {
    logToFile('[K10] Warning: settings-changed received invalid data');
    return;
  }
  // Persist
  saveSettingsSync(settings);
  // Forward to the OTHER window
  const senderWC = event.sender;
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents !== senderWC) {
    overlayWindow.webContents.send('settings-sync', settings);
  }
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.webContents !== senderWC) {
    settingsWindow.webContents.send('settings-sync', settings);
  }
  return true;
});

// ── IPC: Driver profile / car history persistence ──
ipcMain.handle('get-profile-data', async () => {
  return loadProfileData();
});

ipcMain.handle('save-profile-data', async (event, data) => {
  if (typeof data !== 'object' || data === null) {
    logToFile('[K10] Warning: save-profile-data received invalid data');
    return;
  }
  saveProfileData(data);
});

// ── IPC: iRating / Safety Rating persistence ──
ipcMain.handle('get-rating-data', async () => {
  return loadRatingData();
});

ipcMain.handle('save-rating-data', async (event, data) => {
  if (typeof data !== 'object' || data === null) {
    logToFile('[K10] Warning: save-rating-data received invalid data');
    return;
  }
  saveRatingData(data);
});

// ── IPC: App version (from package.json, stamped by CI from git tag) ──
ipcMain.handle('get-version', () => app.getVersion());

// ── IPC: Settings persistence ──
ipcMain.handle('get-settings', async () => {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return null;
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  saveSettingsSync(settings);
  return true;
});

// ── IPC: Green screen mode query ──
ipcMain.handle('get-green-screen-mode', async () => {
  return greenScreenMode;
});

// ── IPC: Dashboard mode query (legacy, returns 'build') ──
ipcMain.handle('get-dashboard-mode', async () => {
  return 'build';
});

// ── IPC: Restart app (used after toggling green screen mode) ──
ipcMain.handle('restart-app', async () => {
  app.relaunch();
  app.exit(0);
});

// ── IPC: Quit app ──
ipcMain.handle('quit-app', () => {
  app.quit();
});

// ── IPC: Open external URL in user's default browser ──
ipcMain.handle('open-external', async (event, urlStr) => {
  try {
    const url = new URL(urlStr);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await shell.openExternal(urlStr);
    }
  } catch (e) {
    // invalid URL — silently reject
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATER (overlay)
// Checks GitHub Releases for new versions, downloads in background,
// installs on next restart.
// ═══════════════════════════════════════════════════════════════
// (require moved to top of file with other imports)

ipcMain.handle('check-for-updates', async () => {
  return updater.checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  return updater.downloadUpdate();
});

ipcMain.handle('install-update', async () => {
  updater.installAndRestart();
});

// ═══════════════════════════════════════════════════════════════
// DISCORD OAUTH2 INTEGRATION
// Opens the user's browser for Discord authorization, listens
// on a local callback server, exchanges the code for a token,
// then fetches and persists the Discord user profile.
// ═══════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID     = '1483105220023160882';
const DISCORD_REDIRECT_PORT = 18492;
const DISCORD_REDIRECT_URI  = `http://localhost:${DISCORD_REDIRECT_PORT}/callback`;
const DISCORD_SCOPES        = 'identify guilds.join';
const DISCORD_GUILD_ID      = '1310050023326121994';  // K10 Motorsports server
const DISCORD_GUILD_INVITE  = 'https://discord.gg/racecor-io-pro-drive';

let _discordCallbackServer = null;
let _discordCodeVerifier   = null;  // PKCE code_verifier for current auth flow

// PKCE helpers — generate verifier + S256 challenge (no client secret needed)
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function getDiscordPath() {
  return path.join(app.getPath('userData'), 'discord-user.json');
}

function loadDiscordUser() {
  try {
    return JSON.parse(fs.readFileSync(getDiscordPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveDiscordUser(user) {
  fs.writeFileSync(getDiscordPath(), JSON.stringify(user, null, 2));
}

function clearDiscordUser() {
  try { fs.unlinkSync(getDiscordPath()); } catch (e) { /* ok */ }
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function exchangeCodeForToken(code) {
  if (!_discordCodeVerifier) throw new Error('Missing PKCE code verifier');

  const tokenData = await httpsPost('https://discord.com/api/oauth2/token', {
    client_id: DISCORD_CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: DISCORD_REDIRECT_URI,
    code_verifier: _discordCodeVerifier,
  });

  _discordCodeVerifier = null;  // single-use
  if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
  return tokenData;
}

async function fetchDiscordProfile(accessToken) {
  const user = await httpsGet('https://discord.com/api/users/@me', {
    Authorization: `Bearer ${accessToken}`,
  });
  if (user.id) return user;
  throw new Error('Failed to fetch Discord profile');
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    if (_discordCallbackServer) {
      try { _discordCallbackServer.close(); } catch (e) { /* ok */ }
    }

    _discordCallbackServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${DISCORD_REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f44336">Connection Cancelled</h2><p>You can close this tab and return to the overlay.</p></div></body></html>');
          resolve({ error });
          setTimeout(() => { try { _discordCallbackServer.close(); } catch (e) {} _discordCallbackServer = null; }, 1000);
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#4caf50">Connected!</h2><p>You can close this tab and return to the K10 Motorsports overlay.</p></div></body></html>');
          resolve({ code });
          setTimeout(() => { try { _discordCallbackServer.close(); } catch (e) {} _discordCallbackServer = null; }, 1000);
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code parameter');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    _discordCallbackServer.listen(DISCORD_REDIRECT_PORT, '127.0.0.1', () => {
      console.log(`[K10] Discord callback server listening on port ${DISCORD_REDIRECT_PORT}`);
    });

    _discordCallbackServer.on('error', (err) => {
      console.error('[K10] Discord callback server error:', err);
      reject(err);
    });

    // Timeout: close server after 5 minutes if no callback received
    setTimeout(() => {
      if (_discordCallbackServer) {
        try { _discordCallbackServer.close(); } catch (e) {}
        _discordCallbackServer = null;
        resolve({ error: 'timeout' });
      }
    }, 300000);
  });
}

// ── IPC: Discord OAuth2 ──
ipcMain.handle('discord-connect', async () => {
  try {
    // Generate PKCE verifier + challenge (no client secret needed)
    _discordCodeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(_discordCodeVerifier);

    // Start listening for the callback BEFORE opening the browser
    const callbackPromise = startCallbackServer();

    // Open Discord OAuth2 authorization URL in user's default browser (with PKCE)
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(DISCORD_SCOPES)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    // Temporarily lower z-level so the browser window is visible above the overlay
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(false);
    }

    await shell.openExternal(authUrl);
    console.log('[K10] Discord OAuth2: opened browser for authorization (PKCE)');

    // Wait for the callback
    const result = await callbackPromise;

    // Restore z-level (respect idle mode — don't go always-on-top when not racing)
    if (overlayWindow && !overlayWindow.isDestroyed() && !isIdleMode) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(result.code);

    // Fetch user profile
    const profile = await fetchDiscordProfile(tokenData.access_token);

    // Build user data to persist
    const userData = {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name || profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      connectedAt: new Date().toISOString(),
    };

    saveDiscordUser(userData);
    console.log(`[K10] Discord connected: ${userData.globalName} (${userData.id})`);

    return {
      success: true,
      user: {
        id: userData.id,
        username: userData.username,
        globalName: userData.globalName,
        avatar: userData.avatar,
      },
    };
  } catch (err) {
    console.error('[K10] Discord connect error:', err);
    // Restore z-level if it was lowered (respect idle mode)
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isAlwaysOnTop() && !isIdleMode) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord-disconnect', async () => {
  clearDiscordUser();
  console.log('[K10] Discord disconnected');
  return { success: true };
});

ipcMain.handle('get-discord-user', async () => {
  const user = loadDiscordUser();
  if (!user) return null;
  // Return only safe fields (no tokens)
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    connectedAt: user.connectedAt,
  };
});

// ═══════════════════════════════════════════════════════════════
// K10 PRO DRIVE OAUTH2 INTEGRATION
// Opens the user's browser to the K10 website for authorization,
// reuses the same localhost callback server (port 18492),
// exchanges the auth code for a K10 access token.
// ═══════════════════════════════════════════════════════════════

const K10_API_BASE = process.env.K10_API_BASE || 'https://prodrive.racecor.io';

function getK10Path() {
  return path.join(app.getPath('userData'), 'k10-pro-user.json');
}

function loadK10User() {
  try {
    return JSON.parse(fs.readFileSync(getK10Path(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveK10User(data) {
  fs.writeFileSync(getK10Path(), JSON.stringify(data, null, 2));
}

function clearK10User() {
  try { fs.unlinkSync(getK10Path()); } catch (e) { /* ok */ }
}

async function httpsPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    // Use http for localhost dev, https for production
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function httpsGetWithAuth(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'http:' ? http : https;
    const req = lib.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

ipcMain.handle('k10-connect', async () => {
  try {
    // Generate PKCE verifier + challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Start listening for the callback BEFORE opening the browser
    const callbackPromise = startCallbackServer();

    // Build the K10 Pro Drive authorization URL
    const authUrl = `${K10_API_BASE}/api/plugin-auth/authorize?code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}`;

    // Temporarily lower z-level so the browser window is visible above the overlay
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(false);
    }

    await shell.openExternal(authUrl);
    console.log('[K10] K10 Pro OAuth2: opened browser for authorization');

    // Wait for the callback
    const result = await callbackPromise;

    // Restore z-level (respect idle mode — don't go always-on-top when not racing)
    if (overlayWindow && !overlayWindow.isDestroyed() && !isIdleMode) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (result.error) {
      return { success: false, error: result.error };
    }

    // Exchange code for K10 access token
    const tokenData = await httpsPostJson(`${K10_API_BASE}/api/plugin-auth/token`, {
      grant_type: 'authorization_code',
      code: result.code,
      code_verifier: codeVerifier,
    });

    if (tokenData.error) {
      return { success: false, error: tokenData.error };
    }

    // Verify token and get user profile + features
    const verifyResult = await httpsGetWithAuth(`${K10_API_BASE}/api/plugin-auth/verify`, tokenData.access_token);
    if (verifyResult.status !== 200 || !verifyResult.data.user) {
      return { success: false, error: 'Token verification failed' };
    }

    const userData = {
      ...verifyResult.data.user,
      features: verifyResult.data.features || [],
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      connectedAt: new Date().toISOString(),
    };

    saveK10User(userData);
    console.log(`[K10] K10 Pro connected: ${userData.discordDisplayName || userData.discordUsername} (${userData.discordId})`);

    return {
      success: true,
      user: {
        id: userData.id,
        discordId: userData.discordId,
        discordUsername: userData.discordUsername,
        discordDisplayName: userData.discordDisplayName,
        discordAvatar: userData.discordAvatar,
        features: userData.features,
      },
    };
  } catch (err) {
    console.error('[K10] K10 Pro connect error:', err);
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isAlwaysOnTop() && !isIdleMode) {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle('k10-disconnect', async () => {
  clearK10User();
  console.log('[K10] K10 Pro disconnected');
  return { success: true };
});

ipcMain.handle('get-k10-user', async () => {
  const user = loadK10User();
  if (!user) return null;
  // Return only safe fields (no tokens)
  return {
    id: user.id,
    discordId: user.discordId,
    discordUsername: user.discordUsername,
    discordDisplayName: user.discordDisplayName,
    discordAvatar: user.discordAvatar,
    features: user.features || [],
    connectedAt: user.connectedAt,
  };
});

ipcMain.handle('get-k10-token', async () => {
  const user = loadK10User();
  return user?.accessToken || null;
});

ipcMain.handle('verify-k10-token', async () => {
  const user = loadK10User();
  if (!user || !user.accessToken) return { valid: false };

  try {
    const result = await httpsGetWithAuth(`${K10_API_BASE}/api/plugin-auth/verify`, user.accessToken);
    if (result.status === 200 && result.data.user) {
      // Update stored features
      user.features = result.data.features || [];
      saveK10User(user);
      return { valid: true, features: user.features };
    }

    // Try refresh
    if (user.refreshToken) {
      const refreshResult = await httpsPostJson(`${K10_API_BASE}/api/plugin-auth/token`, {
        grant_type: 'refresh_token',
        refresh_token: user.refreshToken,
      });
      if (refreshResult.access_token) {
        user.accessToken = refreshResult.access_token;
        user.refreshToken = refreshResult.refresh_token;
        user.expiresAt = refreshResult.expires_at;
        saveK10User(user);
        return { valid: true, features: user.features };
      }
    }

    return { valid: false };
  } catch (err) {
    console.warn('[K10] Token verification failed:', err.message);
    return { valid: false };
  }
});

// ═══════════════════════════════════════════════════════════════
// ── IPC: Remote Dashboard Server ──
ipcMain.handle('get-remote-server-info', async () => {
  return remoteServer.getInfo();
});

ipcMain.handle('start-remote-server', async (event, opts = {}) => {
  try {
    const settings = loadSettingsSync();
    const simhubUrl = (settings.simhubUrl || 'http://localhost:8889/racecor-io-pro-drive/')
      .replace(/\/racecor-io-pro-drive\/?$/, '');
    const info = await remoteServer.start({
      port: opts.port || settings.remoteServerPort || remoteServer.DEFAULT_PORT,
      appDir: __dirname,
      simhubUrl: simhubUrl,
      log: logToFile,
    });
    // Persist the enabled state
    settings.remoteServer = true;
    if (opts.port) settings.remoteServerPort = opts.port;
    saveSettingsSync(settings);
    return { success: true, ...info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-remote-server', async () => {
  await remoteServer.stop();
  const settings = loadSettingsSync();
  settings.remoteServer = false;
  saveSettingsSync(settings);
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════
// AMBIENT LIGHT — Screen Color Capture (REMOVED)
//
// The Electron desktopCapturer pipeline has been replaced by a
// native C# ScreenColorSampler in the SimHub plugin. The plugin
// captures a small screen region using Graphics.CopyFromScreen()
// on a background thread at ~4 FPS and embeds the averaged RGB
// in the telemetry JSON (DS.AmbientR/G/B/HasData).
//
// The dashboard JS reads ambient color from poll data via
// poll-engine.js → updateAmbientFromPoll() in ambient-light.js.
//
// No Electron IPC or desktopCapturer is needed anymore.
// ═══════════════════════════════════════════════════════════════
