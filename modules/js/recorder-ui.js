// ═══════════════════════════════════════════════════════════════
// RECORDER UI — Recording indicator, timer, settings helpers
// Shows a red recording dot + elapsed time in the overlay corner.
// Also handles recording settings panel: device enumeration,
// facecam config, and settings persistence.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var _indicator = null;
  var _dot = null;
  var _timer = null;
  var _timerInterval = null;

  document.addEventListener('DOMContentLoaded', function () {
    createIndicator();
    bindEvents();
  });

  // ── Build the DOM ──────────────────────────────────────────
  function createIndicator() {
    _indicator = document.createElement('div');
    _indicator.className = 'rec-indicator';
    _indicator.id = 'recIndicator';

    _dot = document.createElement('span');
    _dot.className = 'rec-dot';

    _timer = document.createElement('span');
    _timer.className = 'rec-timer';
    _timer.textContent = '0:00';

    _indicator.appendChild(_dot);
    _indicator.appendChild(_timer);
    document.body.appendChild(_indicator);
  }

  // ── Event binding ──────────────────────────────────────────
  function bindEvents() {
    window.addEventListener('recording-state-change', function (e) {
      if (e.detail.recording) {
        show();
      } else {
        hide();
      }
    });
  }

  // ── Show/hide ──────────────────────────────────────────────
  function show() {
    if (!_indicator) return;
    _indicator.classList.add('rec-active');
    startTimer();
  }

  function hide() {
    if (!_indicator) return;
    _indicator.classList.remove('rec-active');
    stopTimer();
    _timer.textContent = '0:00';
  }

  // ── Timer ──────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    _timerInterval = setInterval(updateTimer, 500);
  }

  function stopTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
  }

  function updateTimer() {
    if (typeof window.recorderElapsedMs !== 'function') return;
    var ms = window.recorderElapsedMs();
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    var hr = Math.floor(min / 60);

    if (hr > 0) {
      min = min % 60;
      _timer.textContent = hr + ':' + pad(min) + ':' + pad(sec);
    } else {
      _timer.textContent = min + ':' + pad(sec);
    }
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  // ═══════════════════════════════════════════════════════════
  // RECORDING SETTINGS — device enumeration + persistence
  // ═══════════════════════════════════════════════════════════

  // ── Update a recording setting and persist ─────────────────
  function updateRecSetting(key, value) {
    if (!window._settings) return;
    window._settings[key] = value;
    if (typeof window.saveSettings === 'function') {
      window.saveSettings();
    }
  }
  window.updateRecSetting = updateRecSetting;

  // ── Facecam size helper ────────────────────────────────────
  var FACECAM_SIZES = {
    small:  { width: 240, height: 180 },
    medium: { width: 320, height: 240 },
    large:  { width: 480, height: 360 },
  };

  function updateRecFacecamSize(sizeKey) {
    if (!window._settings) return;
    var size = FACECAM_SIZES[sizeKey] || FACECAM_SIZES.medium;
    if (!window._settings.recordingFacecam) {
      window._settings.recordingFacecam = {};
    }
    window._settings.recordingFacecam.width = size.width;
    window._settings.recordingFacecam.height = size.height;
    window._settings.recordingFacecamSize = sizeKey;
    if (typeof window.saveSettings === 'function') window.saveSettings();
  }
  window.updateRecFacecamSize = updateRecFacecamSize;

  // ── Facecam position helper ────────────────────────────────
  function updateRecFacecamPos(posKey) {
    if (!window._settings) return;
    var parts = posKey.split('-');
    if (!window._settings.recordingFacecam) {
      window._settings.recordingFacecam = {};
    }
    window._settings.recordingFacecam.y = parts[0] || 'bottom';
    window._settings.recordingFacecam.x = parts[1] || 'right';
    window._settings.recordingFacecamPos = posKey;
    if (typeof window.saveSettings === 'function') window.saveSettings();
  }
  window.updateRecFacecamPos = updateRecFacecamPos;

  // ── Enumerate devices and populate dropdowns ───────────────
  async function refreshRecordingDevices() {
    if (typeof window.recorderEnumerateDevices !== 'function') return;

    var result = await window.recorderEnumerateDevices();
    var audioInputs = result.audioInputs || [];
    var videoInputs = result.videoInputs || [];
    var settings = window._settings || {};

    // Mic device dropdown
    var micSelect = document.getElementById('settingsRecMicDevice');
    if (micSelect) {
      var micVal = settings.recordingMicDevice || '';
      micSelect.innerHTML = '<option value="">Default</option>';
      audioInputs.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label;
        if (d.deviceId === micVal) opt.selected = true;
        micSelect.appendChild(opt);
      });
    }

    // System audio device dropdown (virtual audio cable appears here)
    var sysSelect = document.getElementById('settingsRecSystemAudioDevice');
    if (sysSelect) {
      var sysVal = settings.recordingSystemAudioDevice || '';
      sysSelect.innerHTML = '<option value="">None</option>';
      audioInputs.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label;
        if (d.deviceId === sysVal) opt.selected = true;
        sysSelect.appendChild(opt);
      });
    }

    // Webcam device dropdown
    var camSelect = document.getElementById('settingsRecWebcamDevice');
    if (camSelect) {
      var camVal = settings.recordingWebcamDevice || '';
      camSelect.innerHTML = '<option value="">None</option>';
      videoInputs.forEach(function (d) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label;
        if (d.deviceId === camVal) opt.selected = true;
        camSelect.appendChild(opt);
      });
    }

    // Quality dropdown
    var qualSelect = document.getElementById('settingsRecordingQuality');
    if (qualSelect) {
      qualSelect.value = settings.recordingQuality || 'high';
    }

    // Facecam size/position dropdowns
    var sizeSelect = document.getElementById('settingsRecFacecamSize');
    if (sizeSelect) {
      sizeSelect.value = settings.recordingFacecamSize || 'medium';
    }

    var posSelect = document.getElementById('settingsRecFacecamPos');
    if (posSelect) {
      posSelect.value = settings.recordingFacecamPos || 'bottom-right';
    }

    console.log('[RecorderUI] Devices refreshed:', audioInputs.length, 'audio,', videoInputs.length, 'video');
  }
  window.refreshRecordingDevices = refreshRecordingDevices;

  // Auto-enumerate when the Recording tab is first opened
  var _devicesLoaded = false;
  var origSwitchTab = window.switchSettingsTab;
  if (typeof origSwitchTab === 'function') {
    // Wrap the existing tab switcher to detect when Recording tab opens
    window.switchSettingsTab = function (tab) {
      origSwitchTab(tab);
      var tabName = tab && (tab.dataset ? tab.dataset.tab : null);
      if (tabName === 'recording' && !_devicesLoaded) {
        _devicesLoaded = true;
        refreshRecordingDevices();
      }
    };
  }
})();
