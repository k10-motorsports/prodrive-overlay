// ═══════════════════════════════════════════════════════════════
// MOZA HARDWARE SETTINGS
// Manages the Moza Hardware tab in the settings panel.
// Reads device state from the main poll (MozaConnected, etc.)
// and fetches full device settings on-demand via action endpoints.
// Writes user changes back to hardware via set* actions.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _initialized = false;
  var _tabOpen = false;
  var _lastConnected = null;
  var _deviceSettings = {};   // cached per-device settings from action fetches
  var _curveEditors = {};     // MozaCurveEditor instances keyed by axis name
  var _debounceTimers = {};   // slider debounce timers
  var _refreshing = false;

  var DEBOUNCE_MS = 200;

  // SimHub action URL base — reuse overlay's existing polling URL minus the trailing path
  function getActionUrl(action, params) {
    var base = window._simhubUrlOverride || 'http://localhost:8889/racecor-io-pro-drive/';
    var url = new URL(base);
    url.searchParams.set('action', action);
    if (params) {
      Object.keys(params).forEach(function (k) {
        url.searchParams.set(k, params[k]);
      });
    }
    return url.toString();
  }

  async function fetchAction(action, params) {
    try {
      var res = await fetch(getActionUrl(action, params));
      return await res.json();
    } catch (err) {
      console.warn('[MozaSettings] Action fetch failed:', action, err.message);
      return null;
    }
  }

  // ── Init ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Wire up the Moza Hardware sidebar item if it exists
    var tabEl = document.querySelector('[data-tab="mozaHardware"]');
    if (tabEl) {
      // Listen for tab switches to know when we're visible
      var origSwitch = window.switchSettingsTab;
      if (origSwitch) {
        window.switchSettingsTab = function (el) {
          origSwitch(el);
          var tab = el.dataset ? el.dataset.tab : el.getAttribute('data-tab');
          if (tab === 'mozaHardware') {
            onTabOpened();
          } else {
            _tabOpen = false;
          }
        };
      }
    }

    // Reconnect / Refresh button handlers
    var reconnBtn = document.getElementById('mozaReconnectBtn');
    var refreshBtn = document.getElementById('mozaRefreshBtn');
    if (reconnBtn) reconnBtn.addEventListener('click', mozaReconnect);
    if (refreshBtn) refreshBtn.addEventListener('click', mozaRefresh);

    // Init device panel expand/collapse
    document.querySelectorAll('.moza-device-header').forEach(function (header) {
      header.addEventListener('click', function () {
        var panel = header.closest('.moza-device-panel');
        if (panel) {
          panel.classList.toggle('expanded');
          // Load device settings on first expand
          var device = panel.dataset.device;
          if (device && panel.classList.contains('expanded') && !_deviceSettings[device]) {
            loadDeviceSettings(device);
          }
        }
      });
    });

    _initialized = true;
  });

  // ── Called from poll-engine.js on every frame ───────────────
  // Only updates connection status indicators; does NOT fetch
  // full device settings (those are on-demand when tab is open).
  window.updateMozaStatus = function (p) {
    if (!_initialized) return;

    var pre = p._demo ? 'RaceCorProDrive.Plugin.Demo.DS.' : 'RaceCorProDrive.Plugin.DS.';
    var connected = p[pre + 'MozaConnected'] === true || p[pre + 'MozaConnected'] === 'True';
    var deviceCount = +(p[pre + 'MozaDeviceCount']) || 0;

    // Update global status dot
    var statusDot = document.getElementById('mozaGlobalStatus');
    var countLabel = document.getElementById('mozaDeviceCountLabel');
    if (statusDot) {
      statusDot.className = 'moza-status-dot ' + (connected ? 'connected' : 'disconnected');
    }
    if (countLabel) {
      countLabel.textContent = connected ? deviceCount + ' device' + (deviceCount !== 1 ? 's' : '') : 'No devices';
    }

    // Show/hide disconnected message vs device panels
    var disconnectedEl = document.getElementById('mozaDisconnectedMsg');
    var devicesEl = document.getElementById('mozaDevicesContainer');
    if (disconnectedEl) disconnectedEl.style.display = connected ? 'none' : '';
    if (devicesEl) devicesEl.style.display = connected ? '' : 'none';

    // Per-device connection indicators
    updateDeviceIndicator('mozaWheelbasePanel', pre + 'MozaWheelbaseConnected', p);
    updateDeviceIndicator('mozaPedalsPanel', pre + 'MozaPedalsConnected', p);
    updateDeviceIndicator('mozaHandbrakePanel', pre + 'MozaHandbrakeConnected', p);
    updateDeviceIndicator('mozaShifterPanel', pre + 'MozaShifterConnected', p);
    updateDeviceIndicator('mozaDashboardPanel', pre + 'MozaDashboardConnected', p);
    updateDeviceIndicator('mozaWheelPanel', pre + 'MozaWheelConnected', p);

    // Update wheelbase model label if available
    var wbModel = p[pre + 'MozaWheelbaseModel'] || '';
    var modelEl = document.getElementById('mozaWheelbaseModelLabel');
    if (modelEl && wbModel) modelEl.textContent = wbModel;

    // Live FFB strength readout (from main poll, no extra fetch)
    var ffbEl = document.getElementById('mozaFFBStrengthLive');
    var ffbVal = p[pre + 'MozaWheelbaseFFBStrength'];
    if (ffbEl && ffbVal !== undefined) ffbEl.textContent = ffbVal + '%';

    // Track connection changes — reload settings if reconnected
    if (connected && _lastConnected === false && _tabOpen) {
      loadAllDeviceSettings();
    }
    _lastConnected = connected;
  };

  function updateDeviceIndicator(panelId, propKey, p) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var isConnected = p[propKey] === true || p[propKey] === 'True';
    panel.style.display = isConnected ? '' : 'none';

    var dot = panel.querySelector('.moza-status-dot');
    if (dot) {
      dot.className = 'moza-status-dot ' + (isConnected ? 'connected' : 'disconnected');
    }
  }

  // ── Tab opened — load full settings ────────────────────────
  function onTabOpened() {
    _tabOpen = true;
    if (_lastConnected) {
      loadAllDeviceSettings();
    }
  }

  async function loadAllDeviceSettings() {
    if (_refreshing) return;
    _refreshing = true;

    var results = await Promise.all([
      fetchAction('getMozaWheelbaseSettings'),
      fetchAction('getMozaPedalSettings'),
      fetchAction('getMozaHandbrakeSettings'),
      fetchAction('getMozaShifterSettings'),
      fetchAction('getMozaDashboardSettings'),
      fetchAction('getMozaWheelSettings'),
    ]);

    if (results[0]) renderWheelbaseSettings(results[0]);
    if (results[1]) renderPedalSettings(results[1]);
    if (results[2]) renderHandbrakeSettings(results[2]);
    if (results[3]) renderShifterSettings(results[3]);
    if (results[4]) renderDashboardSettings(results[4]);
    if (results[5]) renderWheelSettings(results[5]);

    _refreshing = false;
  }

  async function loadDeviceSettings(device) {
    var actionMap = {
      wheelbase: 'getMozaWheelbaseSettings',
      pedals: 'getMozaPedalSettings',
      handbrake: 'getMozaHandbrakeSettings',
      shifter: 'getMozaShifterSettings',
      dashboard: 'getMozaDashboardSettings',
      wheel: 'getMozaWheelSettings',
    };
    var action = actionMap[device];
    if (!action) return;
    var data = await fetchAction(action);
    if (!data) return;
    _deviceSettings[device] = data;

    var renderMap = {
      wheelbase: renderWheelbaseSettings,
      pedals: renderPedalSettings,
      handbrake: renderHandbrakeSettings,
      shifter: renderShifterSettings,
      dashboard: renderDashboardSettings,
      wheel: renderWheelSettings,
    };
    if (renderMap[device]) renderMap[device](data);
  }

  // ── Render: Wheelbase ──────────────────────────────────────
  function renderWheelbaseSettings(data) {
    _deviceSettings.wheelbase = data;
    setSliderValue('mozaFFBStrength', data.ffbStrength, 0, 100, '%');
    setSliderValue('mozaMaxTorque', data.maxTorque, 0, 100, '%');
    setSliderValue('mozaRotationRange', data.rotationRange, 90, 2700, '°');
    setSliderValue('mozaFriction', data.friction, 0, 100, '%');
    setSliderValue('mozaSpring', data.spring, 0, 100, '%');
    setSliderValue('mozaDamper', data.damper, 0, 100, '%');
    setSliderValue('mozaInertia', data.inertia, 0, 100, '%');
    setSliderValue('mozaRoadSensitivity', data.roadSensitivity, 0, 100, '%');

    // EQ bands (if present)
    for (var i = 1; i <= 6; i++) {
      var key = 'eq' + i;
      if (data[key] !== undefined) {
        setSliderValue('mozaEQ' + i, data[key], 0, 100, '');
      }
    }
  }

  // ── Render: Pedals ─────────────────────────────────────────
  function renderPedalSettings(data) {
    _deviceSettings.pedals = data;

    // Throttle curve
    if (data.throttleCurve && window.MozaCurveEditor) {
      initCurveEditor('mozaThrottleCurve', data.throttleCurve, '#4CAF50', 'Throttle', 'Pedals', 'throttleCurve');
    }
    // Brake curve
    if (data.brakeCurve && window.MozaCurveEditor) {
      initCurveEditor('mozaBrakeCurve', data.brakeCurve, '#F44336', 'Brake', 'Pedals', 'brakeCurve');
    }
    // Clutch curve
    if (data.clutchCurve && window.MozaCurveEditor) {
      initCurveEditor('mozaClutchCurve', data.clutchCurve, '#42A5F5', 'Clutch', 'Pedals', 'clutchCurve');
    }

    // Deadzones
    setSliderValue('mozaThrottleDeadzone', data.throttleDeadzone, 0, 30, '%');
    setSliderValue('mozaBrakeDeadzone', data.brakeDeadzone, 0, 30, '%');
    setSliderValue('mozaClutchDeadzone', data.clutchDeadzone, 0, 30, '%');
  }

  // ── Render: Handbrake ──────────────────────────────────────
  function renderHandbrakeSettings(data) {
    _deviceSettings.handbrake = data;

    if (data.curve && window.MozaCurveEditor) {
      initCurveEditor('mozaHandbrakeCurve', data.curve, '#FF9800', 'Handbrake', 'Handbrake', 'curve');
    }
    setSliderValue('mozaHandbrakeThreshold', data.buttonThreshold, 0, 100, '%');
    setSliderValue('mozaHandbrakeDeadzone', data.deadzone, 0, 30, '%');
  }

  // ── Render: Shifter ────────────────────────────────────────
  function renderShifterSettings(data) {
    _deviceSettings.shifter = data;
    var dirEl = document.getElementById('mozaShifterDirection');
    if (dirEl && data.direction !== undefined) {
      dirEl.value = String(data.direction);
    }
    var modeEl = document.getElementById('mozaShifterHidMode');
    if (modeEl && data.hidMode !== undefined) {
      modeEl.value = String(data.hidMode);
    }
  }

  // ── Render: Dashboard ──────────────────────────────────────
  function renderDashboardSettings(data) {
    _deviceSettings.dashboard = data;
    setSliderValue('mozaDashBrightness', data.brightness, 0, 100, '%');
    var rpmEl = document.getElementById('mozaDashRpmMode');
    if (rpmEl && data.rpmDisplayMode !== undefined) {
      rpmEl.value = String(data.rpmDisplayMode);
    }
  }

  // ── Render: Steering Wheel ─────────────────────────────────
  function renderWheelSettings(data) {
    _deviceSettings.wheel = data;
    setSliderValue('mozaWheelRGBBrightness', data.rgbBrightness, 0, 100, '%');
  }

  // ── Helpers ────────────────────────────────────────────────

  function setSliderValue(id, value, min, max, suffix) {
    var slider = document.getElementById(id);
    var valEl = document.getElementById(id + 'Val');
    if (!slider) return;
    if (value === undefined || value === null) return;
    slider.min = min;
    slider.max = max;
    slider.value = value;
    if (valEl) valEl.textContent = value + (suffix || '');
  }

  function initCurveEditor(canvasId, curveData, color, label, device, settingKey) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (_curveEditors[canvasId]) {
      // Already initialized — just update the data
      _curveEditors[canvasId].setCurve(curveData);
      return;
    }

    var editor = new window.MozaCurveEditor(canvas, {
      color: color,
      label: label,
      onCurveChange: function (points) {
        debouncedSetSetting(device, settingKey, JSON.stringify(points));
      },
    });
    editor.setCurve(curveData);
    _curveEditors[canvasId] = editor;
  }

  // ── Write settings to hardware ─────────────────────────────

  function debouncedSetSetting(device, key, value) {
    var timerKey = device + '.' + key;
    if (_debounceTimers[timerKey]) {
      clearTimeout(_debounceTimers[timerKey]);
    }
    _debounceTimers[timerKey] = setTimeout(function () {
      delete _debounceTimers[timerKey];
      setMozaSetting(device, key, value);
    }, DEBOUNCE_MS);
  }

  async function setMozaSetting(device, key, value) {
    var actionMap = {
      Wheelbase: 'setMozaWheelbaseSetting',
      Pedals: 'setMozaPedalSetting',
      Handbrake: 'setMozaHandbrakeSetting',
      Shifter: 'setMozaShifterSetting',
      Dashboard: 'setMozaDashboardSetting',
      Wheel: 'setMozaWheelSetting',
    };
    var action = actionMap[device];
    if (!action) {
      console.warn('[MozaSettings] Unknown device for setting write:', device);
      return;
    }
    await fetchAction(action, { key: key, value: String(value) });
  }

  // ── Slider change handler (called from inline oninput) ─────
  window.mozaSliderChanged = function (slider) {
    var id = slider.id;
    var val = slider.value;
    var valEl = document.getElementById(id + 'Val');
    var suffix = slider.dataset.suffix || '';
    if (valEl) valEl.textContent = val + suffix;

    var device = slider.dataset.device;
    var key = slider.dataset.key;
    if (device && key) {
      debouncedSetSetting(device, key, val);
    }
  };

  // ── Select change handler ──────────────────────────────────
  window.mozaSelectChanged = function (select) {
    var device = select.dataset.device;
    var key = select.dataset.key;
    if (device && key) {
      setMozaSetting(device, key, select.value);
    }
  };

  // ── Reconnect / Refresh ────────────────────────────────────
  async function mozaReconnect() {
    var btn = document.getElementById('mozaReconnectBtn');
    if (btn) btn.disabled = true;
    var statusDot = document.getElementById('mozaGlobalStatus');
    if (statusDot) statusDot.className = 'moza-status-dot searching';

    await fetchAction('mozaReconnect');

    // Wait a moment then refresh
    setTimeout(function () {
      if (btn) btn.disabled = false;
      mozaRefresh();
    }, 2000);
  }

  async function mozaRefresh() {
    var btn = document.getElementById('mozaRefreshBtn');
    if (btn) btn.disabled = true;

    await fetchAction('mozaRefresh');
    await loadAllDeviceSettings();

    if (btn) btn.disabled = false;
  }

  window.mozaReconnect = mozaReconnect;
  window.mozaRefresh = mozaRefresh;
})();
