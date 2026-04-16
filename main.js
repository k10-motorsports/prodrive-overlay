// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Electron Overlay
// Transparent, always-on-top, click-through overlay window
// that renders the HTML dashboard over the sim
// ═══════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Menu } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const remoteServer = require('./remote-server');
const updater      = require('./modules/js/auto-updater');
const ffmpegEncoder = require('./modules/js/ffmpeg-encoder');

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
let rendererCrashCount = 0;
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
      skipTaskbar: true,
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
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
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
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
    overlayWindow.setFocusable(false);
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
    maybeStartRemoteServer();
    updater.initAutoUpdater(overlayWindow, logToFile);
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
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
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setFocusable(false);
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
    // Idle mode: behave like a normal app window
    overlayWindow.setAlwaysOnTop(false);
    overlayWindow.setSkipTaskbar(false);
    // Keep click-through — only idle logo + nav buttons have pointer-events: auto
    if (!settingsMode) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    }
    console.log('[K10] Idle mode — taskbar visible, not always-on-top');
  } else {
    // Race mode: overlay on top of the game
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setSkipTaskbar(true);
    if (!settingsMode) {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      overlayWindow.setFocusable(false);
    }
    console.log('[K10] Race mode — always-on-top, taskbar hidden');
  }
});

// ── IPC: Screen recording ──────────────────────────────────────
// The renderer handles capture via desktopCapturer + MediaRecorder.
// Main process owns the file I/O: creates the write stream, receives
// chunks from the renderer, and finalizes the file on stop.
let _recordingStream = null;
let _recordingPath = null;
let _recordingStartTime = null;

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
    const dir = getRecordingDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const ext = options.ext || 'webm';
    const filename = `RaceCor_${ts}.${ext}`;
    _recordingPath = path.join(dir, filename);
    _recordingStream = fs.createWriteStream(_recordingPath);
    _recordingStartTime = Date.now();
    logToFile(`[K10] Recording started: ${_recordingPath}`);
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
      logToFile(`[K10] Recording stopped: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB, ${(duration / 1000).toFixed(1)}s)`);
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
  var stream = _sidecarStreams[filePath];
  if (stream && !stream.destroyed) {
    stream.write(chunk);
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

function openDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Persist cookies so login survives app restarts
      partition: 'persist:dashboard',
    },
  });

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

ipcMain.handle('open-dashboard', async () => {
  openDashboardWindow();
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
