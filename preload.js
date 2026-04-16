// ═══════════════════════════════════════════════════════════════
// K10 Motorsports — Preload Script
// Exposes safe IPC bridge to the HTML dashboard
// ═══════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('k10', {
  // App version (read from package.json by Electron)
  getVersion: () => ipcRenderer.invoke('get-version'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  onSettingsMode: (callback) => {
    ipcRenderer.on('settings-mode', (event, active) => callback(active));
  },
  // Request/release interactive mode (makes window focusable + clickable)
  requestInteractive: () => ipcRenderer.invoke('request-interactive'),
  releaseInteractive: () => ipcRenderer.invoke('release-interactive'),
  // Green screen mode
  getGreenScreenMode: () => ipcRenderer.invoke('get-green-screen-mode'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  // Dashboard mode (legacy, returns 'build')
  getDashboardMode: () => ipcRenderer.invoke('get-dashboard-mode'),
  // Open URL in user's default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Global hotkey listeners (forwarded from main process)
  onRestartDemo: (callback) => {
    ipcRenderer.on('restart-demo', () => callback());
  },
  onResetTrackmap: (callback) => {
    ipcRenderer.on('reset-trackmap', () => callback());
  },
  // iRating / Safety Rating
  getRatingData: () => ipcRenderer.invoke('get-rating-data'),
  saveRatingData: (data) => ipcRenderer.invoke('save-rating-data', data),
  onToggleRatingEditor: (callback) => {
    ipcRenderer.on('toggle-rating-editor', () => callback());
  },
  // Driver profile
  getProfileData: () => ipcRenderer.invoke('get-profile-data'),
  saveProfileData: (data) => ipcRenderer.invoke('save-profile-data', data),
  onToggleDriverProfile: (callback) => {
    ipcRenderer.on('toggle-driver-profile', () => callback());
  },
  onToggleDriveMode: (callback) => {
    ipcRenderer.on('toggle-drive-mode', () => callback());
  },
  // Discord OAuth2 (legacy — still works for community features)
  discordConnect: () => ipcRenderer.invoke('discord-connect'),
  discordDisconnect: () => ipcRenderer.invoke('discord-disconnect'),
  getDiscordUser: () => ipcRenderer.invoke('get-discord-user'),
  // K10 Pro Drive OAuth2 (website account → pro features)
  k10Connect: () => ipcRenderer.invoke('k10-connect'),
  k10Disconnect: () => ipcRenderer.invoke('k10-disconnect'),
  getK10User: () => ipcRenderer.invoke('get-k10-user'),
  getK10Token: () => ipcRenderer.invoke('get-k10-token'),
  verifyK10Token: () => ipcRenderer.invoke('verify-k10-token'),
  // Remote dashboard server (iPad/tablet access)
  getRemoteServerInfo: () => ipcRenderer.invoke('get-remote-server-info'),
  startRemoteServer: (opts) => ipcRenderer.invoke('start-remote-server', opts),
  stopRemoteServer: () => ipcRenderer.invoke('stop-remote-server'),
  // Web dashboard window (prodrive.racecor.io)
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  closeDashboard: () => ipcRenderer.invoke('close-dashboard'),
  onDashboardClosed: (callback) => {
    ipcRenderer.on('dashboard-closed', () => callback());
  },
  // Settings popout window (secondary display)
  openSettingsPopout: () => ipcRenderer.invoke('open-settings-popout'),
  closeSettingsPopout: () => ipcRenderer.invoke('close-settings-popout'),
  notifySettingsChanged: (settings) => ipcRenderer.invoke('settings-changed', settings),
  onSettingsSync: (callback) => {
    ipcRenderer.on('settings-sync', (event, settings) => callback(settings));
  },
  onSettingsPopoutClosed: (callback) => {
    ipcRenderer.on('settings-popout-closed', () => callback());
  },
  // Detect if this window was opened as a popout
  isSettingsPopout: () => {
    return new URLSearchParams(window.location.search).get('settingsPopout') === '1';
  },
  // Ambient light — screen capture moved to C# plugin (ScreenColorSampler).
  // Color data now arrives via poll JSON (DS.AmbientR/G/B), no IPC needed.
  // Moza hardware manager window
  openMozaManager: () => ipcRenderer.invoke('open-moza-manager'),
  onMozaManagerClosed: (callback) => {
    ipcRenderer.on('moza-manager-closed', () => callback());
  },
  // Idle state — notify main process so it can switch window mode
  notifyIdleState: (isIdle) => ipcRenderer.invoke('notify-idle-state', isIdle),
  // Screen recording
  startRecording: (opts) => ipcRenderer.invoke('start-recording', opts),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  writeRecordingChunk: (buf) => ipcRenderer.invoke('write-recording-chunk', buf),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  onToggleRecording: (callback) => {
    ipcRenderer.on('toggle-recording', () => callback());
  },
  // Quit application
  quitApp: () => ipcRenderer.invoke('quit-app'),
});
