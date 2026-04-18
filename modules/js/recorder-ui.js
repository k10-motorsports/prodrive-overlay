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

    // Transcode state
    window.addEventListener('transcode-state-change', function (e) {
      if (e.detail.transcoding) {
        showTranscode(e.detail.encoder);
      } else {
        hideTranscode(e.detail.result, e.detail.error);
      }
    });

    // Transcode progress (from main process via IPC)
    if (window.k10 && window.k10.onTranscodeProgress) {
      window.k10.onTranscodeProgress(function (progress) {
        updateTranscodeProgress(progress);
      });
    }

    // Auto-record events (Phase 4)
    window.addEventListener('auto-record-event', function (e) {
      if (!_indicator || !_timer) return;
      var detail = e.detail || {};
      if (detail.event === 'auto-start') {
        _timer.dataset.autoReason = detail.reason || '';
      } else if (detail.event === 'auto-stop') {
        // Brief label showing why auto-stop triggered
        var reasons = { pit_entry: 'Pit stop', end_of_race: 'Finish', session_change: 'Session end' };
        var label = reasons[detail.reason] || 'Auto-stopped';
        showFlash(label, 'hsl(200, 70%, 55%)', 2500);
      }
    });

    // Replay buffer saved (Phase 4)
    window.addEventListener('replay-buffer-saved', function (e) {
      var detail = e.detail || {};
      var mb = detail.fileSize ? (detail.fileSize / 1024 / 1024).toFixed(0) : '?';
      showFlash('Clip saved (' + mb + ' MB)', 'hsl(280, 60%, 60%)', 2500);
    });

    // Recording debug events (lifecycle logging)
    if (window.k10 && window.k10.onRecordingDebug) {
      window.k10.onRecordingDebug(function (data) {
        if (data.kind === 'start') {
          showPathToast('REC → ' + data.filename, 'hsl(140, 70%, 50%)', 4000);
        } else if (data.kind === 'chunk') {
          var mb = (data.bytesWritten / 1024 / 1024).toFixed(1);
          console.log('[RecorderUI] Chunks: ' + data.chunkCount + ', Bytes: ' + mb + 'MB');
        } else if (data.kind === 'stop') {
          var fileSizeMB = (data.fileSize / 1024 / 1024).toFixed(0);
          showFlash('Saved: ' + data.filename + ' — ' + fileSizeMB + ' MB', 'hsl(140, 70%, 50%)', 4000);
        }
      });
    }
  }

  // ── Flash notification on the indicator ────────────────────
  function showFlash(text, color, durationMs) {
    if (!_indicator || !_dot || !_timer) return;
    _indicator.classList.add('rec-active');
    _dot.style.background = color;
    _dot.style.boxShadow = '0 0 6px ' + color.replace(')', ', 0.6)').replace('hsl', 'hsla');
    _timer.style.color = color;
    _timer.textContent = text;
    setTimeout(function () {
      _indicator.classList.remove('rec-active');
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
      _timer.textContent = '0:00';
    }, durationMs || 2500);
  }

  // ── Path toast — briefly shows path, then resumes timer ──────
  function showPathToast(text, color, durationMs) {
    if (!_indicator || !_dot || !_timer) return;
    _dot.style.background = color;
    _dot.style.boxShadow = '0 0 6px ' + color.replace(')', ', 0.6)').replace('hsl', 'hsla');
    _timer.style.color = color;
    var savedText = _timer.textContent;
    _timer.textContent = text;
    setTimeout(function () {
      // Restore timer display and colors
      _timer.textContent = savedText;
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
    }, durationMs || 4000);
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

  // ── Transcode progress indicator ───────────────────────────
  // Reuses the recording indicator but switches to a blue/amber
  // color scheme and shows "Converting... 45%"
  function showTranscode(encoder) {
    if (!_indicator || !_dot || !_timer) return;
    _indicator.classList.add('rec-active', 'rec-transcoding');
    _dot.style.background = 'hsl(35, 80%, 55%)';
    _dot.style.boxShadow = '0 0 6px hsla(35, 80%, 55%, 0.6)';
    _timer.style.color = 'hsl(35, 70%, 65%)';
    _timer.textContent = 'Converting...';
  }

  function updateTranscodeProgress(progress) {
    if (!_timer || !_indicator) return;
    if (!_indicator.classList.contains('rec-transcoding')) return;
    _timer.textContent = 'Converting ' + progress.percent + '%';
  }

  function hideTranscode(result, error) {
    if (!_indicator || !_dot || !_timer) return;
    // Brief success/fail flash
    if (result && result.success) {
      _dot.style.background = 'hsl(140, 70%, 45%)';
      _dot.style.boxShadow = '0 0 6px hsla(140, 70%, 45%, 0.6)';
      _timer.style.color = 'hsl(140, 60%, 55%)';
      _timer.textContent = 'MP4 ready';
    } else {
      _timer.textContent = error ? 'Convert failed' : 'Done';
    }

    // Fade out after 3 seconds
    setTimeout(function () {
      _indicator.classList.remove('rec-active', 'rec-transcoding');
      // Reset colors for next recording
      _dot.style.background = '';
      _dot.style.boxShadow = '';
      _timer.style.color = '';
      _timer.textContent = '0:00';
    }, 3000);
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

    // Output format dropdown
    var fmtSelect = document.getElementById('settingsRecOutputFormat');
    if (fmtSelect) {
      fmtSelect.value = settings.recordingOutputFormat || 'mp4';
    }

    // Encoder dropdown
    var encSelect = document.getElementById('settingsRecEncoder');
    if (encSelect) {
      encSelect.value = settings.recordingEncoder || 'auto';
    }

    // Delete-source toggle
    var delToggle = document.querySelector('[data-key="recordingDeleteSource"]');
    if (delToggle) {
      if (settings.recordingDeleteSource !== false) {
        delToggle.classList.add('active');
      } else {
        delToggle.classList.remove('active');
      }
    }

    // Auto-record toggle
    var autoToggle = document.querySelector('[data-key="recordingAutoRecord"]');
    if (autoToggle) {
      if (settings.recordingAutoRecord) {
        autoToggle.classList.add('active');
      } else {
        autoToggle.classList.remove('active');
      }
    }

    // Auto-stop on pit toggle
    var pitToggle = document.querySelector('[data-key="recordingAutoStopOnPit"]');
    if (pitToggle) {
      if (settings.recordingAutoStopOnPit !== false) {
        pitToggle.classList.add('active');
      } else {
        pitToggle.classList.remove('active');
      }
    }

    // Replay buffer toggle
    var bufToggle = document.querySelector('[data-key="replayBufferEnabled"]');
    if (bufToggle) {
      if (settings.replayBufferEnabled) {
        bufToggle.classList.add('active');
      } else {
        bufToggle.classList.remove('active');
      }
    }

    // Replay buffer duration dropdown
    var bufDur = document.getElementById('settingsReplayBufferDuration');
    if (bufDur) {
      bufDur.value = '' + (settings.replayBufferDuration || 60);
    }

    console.log('[RecorderUI] Devices refreshed:', audioInputs.length, 'audio,', videoInputs.length, 'video');
  }
  window.refreshRecordingDevices = refreshRecordingDevices;

  // ── Detect available encoder and show in settings ──────────
  async function detectAndShowEncoder() {
    var label = document.getElementById('settingsRecDetectedEncoder');
    if (!label) return;
    if (!window.k10 || !window.k10.getFfmpegInfo) {
      label.textContent = 'FFmpeg not available';
      label.style.color = 'hsl(0, 60%, 55%)';
      return;
    }
    try {
      var info = await window.k10.getFfmpegInfo();
      if (info && info.encoder) {
        var names = {
          h264_nvenc: 'NVIDIA NVENC',
          h264_qsv: 'Intel Quick Sync',
          h264_amf: 'AMD AMF',
          libx264: 'Software (x264)'
        };
        label.textContent = (names[info.encoder] || info.encoder) + (info.path ? '' : ' (no FFmpeg)');
        label.style.color = info.encoder !== 'libx264' ? 'hsl(140, 60%, 55%)' : 'hsl(35, 70%, 65%)';
      } else {
        label.textContent = 'No encoder found';
        label.style.color = 'hsl(0, 60%, 55%)';
      }
    } catch (err) {
      label.textContent = 'Detection failed';
      label.style.color = 'hsl(0, 60%, 55%)';
    }
  }

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
        detectAndShowEncoder();
      }
    };
  }
})();
