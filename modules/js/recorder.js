// ═══════════════════════════════════════════════════════════════
// SCREEN RECORDER — Phase 1: Basic Screen + Mic Capture
// Captures the full display (game + overlay composited) to a local
// .webm file using Electron's desktopCapturer + MediaRecorder.
// Chunks are streamed to the main process via IPC for file I/O.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _mediaRecorder = null;
  var _displayStream = null;
  var _micStream = null;
  var _recording = false;
  var _startTime = 0;

  // ── Codec negotiation ──────────────────────────────────────
  // Prefer H.264 in WebM (best compatibility with editors).
  // Fall back to VP9, then VP8.
  var CODEC_PREFS = [
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  function pickMimeType() {
    for (var i = 0; i < CODEC_PREFS.length; i++) {
      if (MediaRecorder.isTypeSupported(CODEC_PREFS[i])) {
        return CODEC_PREFS[i];
      }
    }
    return '';  // let the browser decide
  }

  // ── Quality presets ────────────────────────────────────────
  // Always capture at native resolution (3440×1440 ultrawide) to preserve
  // the full overlay layout in the corners. Bitrates scaled for 21:9
  // (~5MP per frame — roughly 2.4× the data of 16:9 1080p).
  // 16:9 conversion happens downstream in the editing pipeline.
  var QUALITY = {
    low:    { videoBitsPerSecond:  8000000 },   //  8 Mbps — small files, decent quality
    medium: { videoBitsPerSecond: 16000000 },   // 16 Mbps — good balance
    high:   { videoBitsPerSecond: 28000000 },   // 28 Mbps — near-lossless for ultrawide
  };

  // ── Start recording ────────────────────────────────────────
  async function startRecording(options) {
    if (_recording) {
      console.warn('[Recorder] Already recording');
      return { error: 'Already recording' };
    }

    options = options || {};
    var quality = QUALITY[options.quality] || QUALITY.high;
    var includeMic = options.includeMic !== false;  // default: include mic

    try {
      // 1. Get the display stream via desktopCapturer
      //    Capture at native resolution (e.g. 3440×1440 ultrawide) so the
      //    full overlay is preserved including corner elements. Use high
      //    min constraints so Electron doesn't downsample the capture.
      var constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            minWidth: 1920,
            minHeight: 1080,
            maxWidth: 7680,     // support up to 8K displays
            maxHeight: 4320,
            maxFrameRate: 60,
          },
        },
      };

      _displayStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[Recorder] Display stream acquired');

      // 2. Optionally get the microphone stream
      if (includeMic) {
        try {
          _micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          console.log('[Recorder] Mic stream acquired');
        } catch (micErr) {
          console.warn('[Recorder] Mic unavailable, recording without:', micErr.message);
          _micStream = null;
        }
      }

      // 3. Combine streams
      var combinedTracks = _displayStream.getVideoTracks().slice();
      if (_micStream) {
        combinedTracks = combinedTracks.concat(_micStream.getAudioTracks());
      }
      var combinedStream = new MediaStream(combinedTracks);

      // 4. Pick codec and create MediaRecorder
      var mimeType = pickMimeType();
      var recorderOpts = {
        videoBitsPerSecond: quality.videoBitsPerSecond,
      };
      if (mimeType) {
        recorderOpts.mimeType = mimeType;
      }

      _mediaRecorder = new MediaRecorder(combinedStream, recorderOpts);
      console.log('[Recorder] Using codec:', _mediaRecorder.mimeType);

      // 5. Tell main process to open a write stream
      var result = await window.k10.startRecording({ ext: 'webm' });
      if (result.error) {
        throw new Error(result.error);
      }

      // 6. Stream chunks to main process via IPC
      _mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) {
          e.data.arrayBuffer().then(function (buf) {
            window.k10.writeRecordingChunk(buf);
          });
        }
      };

      _mediaRecorder.onerror = function (e) {
        console.error('[Recorder] MediaRecorder error:', e.error);
        stopRecording();
        if (typeof window.onRecordingError === 'function') {
          window.onRecordingError(e.error);
        }
      };

      _mediaRecorder.onstop = function () {
        console.log('[Recorder] MediaRecorder stopped');
      };

      // 7. Start — request data every 1 second for steady writes
      _mediaRecorder.start(1000);
      _recording = true;
      _startTime = Date.now();

      // Notify UI
      window.dispatchEvent(new CustomEvent('recording-state-change', {
        detail: { recording: true, filename: result.filename },
      }));

      console.log('[Recorder] Recording started → ' + result.filename);
      return { success: true, filename: result.filename };

    } catch (err) {
      console.error('[Recorder] Start failed:', err);
      cleanup();
      return { error: err.message };
    }
  }

  // ── Stop recording ─────────────────────────────────────────
  async function stopRecording() {
    if (!_recording || !_mediaRecorder) {
      return { error: 'Not recording' };
    }

    return new Promise(function (resolve) {
      _mediaRecorder.onstop = async function () {
        // Finalize the file on disk
        var result = await window.k10.stopRecording();
        cleanup();

        window.dispatchEvent(new CustomEvent('recording-state-change', {
          detail: { recording: false, result: result },
        }));

        console.log('[Recorder] Recording saved');
        resolve(result);
      };

      _mediaRecorder.stop();
    });
  }

  // ── Toggle ─────────────────────────────────────────────────
  async function toggleRecording() {
    if (_recording) {
      return stopRecording();
    } else {
      // Read quality preference from settings
      var quality = 'high';
      if (typeof window.getSettings === 'function') {
        var s = window.getSettings();
        if (s && s.recordingQuality) quality = s.recordingQuality;
      }
      return startRecording({ quality: quality });
    }
  }

  // ── Cleanup ────────────────────────────────────────────────
  function cleanup() {
    _recording = false;
    _startTime = 0;
    if (_displayStream) {
      _displayStream.getTracks().forEach(function (t) { t.stop(); });
      _displayStream = null;
    }
    if (_micStream) {
      _micStream.getTracks().forEach(function (t) { t.stop(); });
      _micStream = null;
    }
    _mediaRecorder = null;
  }

  // ── Getters ────────────────────────────────────────────────
  function isRecording() {
    return _recording;
  }

  function getElapsedMs() {
    return _recording ? Date.now() - _startTime : 0;
  }

  // ── Wire up hotkey from main process ───────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (window.k10 && window.k10.onToggleRecording) {
      window.k10.onToggleRecording(function () {
        toggleRecording();
      });
    }
  });

  // ── Public API ─────────────────────────────────────────────
  window.recorderStart = startRecording;
  window.recorderStop = stopRecording;
  window.recorderToggle = toggleRecording;
  window.recorderIsRecording = isRecording;
  window.recorderElapsedMs = getElapsedMs;
})();
