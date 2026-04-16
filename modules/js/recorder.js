// ═══════════════════════════════════════════════════════════════
// SCREEN RECORDER — Phase 2: Screen + System Audio + Facecam
// Captures the full display (game + overlay composited) to a local
// .webm file using Electron's desktopCapturer + MediaRecorder.
//
// Phase 2 additions:
//   • System audio via user-selected audio input device
//     (virtual audio cable like VB-Audio appears as a mic input)
//   • Mic audio (separate device from system audio)
//   • Audio mixing via Web Audio API (mic + system → single track)
//   • Facecam compositing via offscreen canvas PiP
//
// Chunks are streamed to the main process via IPC for file I/O.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var _mediaRecorder = null;
  var _displayStream = null;
  var _micStream = null;
  var _systemAudioStream = null;
  var _webcamStream = null;
  var _audioContext = null;
  var _compositeCanvas = null;
  var _compositeCtx = null;
  var _compositeAnimFrame = null;
  var _recording = false;
  var _startTime = 0;

  // ── Codec negotiation ──────────────────────────────────────
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
    return '';
  }

  // ── Quality presets ────────────────────────────────────────
  // Always capture at native resolution (3440×1440 ultrawide) to preserve
  // the full overlay layout in the corners. Bitrates scaled for 21:9.
  // 16:9 conversion happens downstream in the editing pipeline.
  var QUALITY = {
    low:    { videoBitsPerSecond:  8000000 },   //  8 Mbps
    medium: { videoBitsPerSecond: 16000000 },   // 16 Mbps
    high:   { videoBitsPerSecond: 28000000 },   // 28 Mbps
  };

  // ── Facecam defaults ───────────────────────────────────────
  var FACECAM_DEFAULTS = {
    width: 320,
    height: 240,
    x: 'right',      // 'left' or 'right'
    y: 'bottom',     // 'top' or 'bottom'
    margin: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'hsla(0, 0%, 100%, 0.25)',
  };

  // ── Device enumeration ─────────────────────────────────────
  // List available audio/video input devices so the user can pick
  // a mic, a system audio source (virtual cable), and a webcam.
  async function enumerateDevices() {
    try {
      // Must request permission first or labels will be empty
      var tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      tempStream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {
      // If user denies, we'll still get device IDs but no labels
    }

    var devices = await navigator.mediaDevices.enumerateDevices();
    var audioInputs = [];
    var videoInputs = [];

    devices.forEach(function (d) {
      if (d.kind === 'audioinput') {
        audioInputs.push({ deviceId: d.deviceId, label: d.label || ('Mic ' + (audioInputs.length + 1)) });
      } else if (d.kind === 'videoinput') {
        videoInputs.push({ deviceId: d.deviceId, label: d.label || ('Camera ' + (videoInputs.length + 1)) });
      }
    });

    return { audioInputs: audioInputs, videoInputs: videoInputs };
  }

  // ── Start recording ────────────────────────────────────────
  async function startRecording(options) {
    if (_recording) {
      console.warn('[Recorder] Already recording');
      return { error: 'Already recording' };
    }

    options = options || {};
    var settings = window._settings || {};
    var quality = QUALITY[options.quality || settings.recordingQuality] || QUALITY.high;
    var includeMic = options.includeMic != null ? options.includeMic : (settings.recordingMic !== false);
    var includeSystemAudio = options.includeSystemAudio != null ? options.includeSystemAudio : !!settings.recordingSystemAudioDevice;
    var includeWebcam = options.includeWebcam != null ? options.includeWebcam : !!settings.recordingWebcamDevice;

    try {
      // ── 1. Display capture ─────────────────────────────────
      var constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            minWidth: 1920,
            minHeight: 1080,
            maxWidth: 7680,
            maxHeight: 4320,
            maxFrameRate: 60,
          },
        },
      };

      _displayStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[Recorder] Display stream acquired');

      // ── 2. Audio sources ───────────────────────────────────
      // Mic and system audio are separate audio input devices.
      // System audio comes from a virtual audio cable (VB-Audio etc.)
      // that the user has configured in Windows sound settings.
      // We mix them together via Web Audio API into a single track.

      var micDeviceId = settings.recordingMicDevice || undefined;
      var sysDeviceId = settings.recordingSystemAudioDevice || undefined;

      if (includeMic) {
        try {
          var micConstraints = {
            audio: {
              echoCancellation: false,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          };
          if (micDeviceId) {
            micConstraints.audio.deviceId = { exact: micDeviceId };
          }
          _micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
          console.log('[Recorder] Mic stream acquired');
        } catch (micErr) {
          console.warn('[Recorder] Mic unavailable:', micErr.message);
          _micStream = null;
        }
      }

      if (includeSystemAudio && sysDeviceId) {
        try {
          _systemAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: sysDeviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          });
          console.log('[Recorder] System audio stream acquired (virtual cable)');
        } catch (sysErr) {
          console.warn('[Recorder] System audio unavailable:', sysErr.message);
          _systemAudioStream = null;
        }
      }

      // ── 3. Mix audio via Web Audio API ─────────────────────
      var mixedAudioTrack = null;
      var hasMic = _micStream && _micStream.getAudioTracks().length > 0;
      var hasSys = _systemAudioStream && _systemAudioStream.getAudioTracks().length > 0;

      if (hasMic || hasSys) {
        _audioContext = new AudioContext();
        var destination = _audioContext.createMediaStreamDestination();

        if (hasMic) {
          var micSource = _audioContext.createMediaStreamSource(_micStream);
          // Mic gain — slightly lower to avoid drowning out game audio
          var micGain = _audioContext.createGain();
          micGain.gain.value = settings.recordingMicVolume != null ? settings.recordingMicVolume : 0.8;
          micSource.connect(micGain).connect(destination);
        }

        if (hasSys) {
          var sysSource = _audioContext.createMediaStreamSource(_systemAudioStream);
          var sysGain = _audioContext.createGain();
          sysGain.gain.value = settings.recordingSystemVolume != null ? settings.recordingSystemVolume : 1.0;
          sysSource.connect(sysGain).connect(destination);
        }

        mixedAudioTrack = destination.stream.getAudioTracks()[0];
        console.log('[Recorder] Audio mixed:', (hasMic ? 'mic' : '') + (hasMic && hasSys ? '+' : '') + (hasSys ? 'system' : ''));
      }

      // ── 4. Webcam (optional facecam PiP) ───────────────────
      var webcamDeviceId = settings.recordingWebcamDevice || undefined;

      if (includeWebcam && webcamDeviceId) {
        try {
          _webcamStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: webcamDeviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 },
            },
          });
          console.log('[Recorder] Webcam stream acquired');
        } catch (camErr) {
          console.warn('[Recorder] Webcam unavailable:', camErr.message);
          _webcamStream = null;
        }
      }

      // ── 5. Compose video stream ────────────────────────────
      // If facecam is active, composite display + webcam onto an
      // offscreen canvas and capture that as the video track.
      // Otherwise, use the raw display stream directly.
      var videoTrack;

      if (_webcamStream) {
        videoTrack = createCompositeStream(_displayStream, _webcamStream, settings);
      } else {
        videoTrack = _displayStream.getVideoTracks()[0];
      }

      // ── 6. Build final MediaStream ─────────────────────────
      var finalTracks = [videoTrack];
      if (mixedAudioTrack) {
        finalTracks.push(mixedAudioTrack);
      }
      var finalStream = new MediaStream(finalTracks);

      // ── 7. Create MediaRecorder ────────────────────────────
      var mimeType = pickMimeType();
      var recorderOpts = {
        videoBitsPerSecond: quality.videoBitsPerSecond,
      };
      if (mimeType) {
        recorderOpts.mimeType = mimeType;
      }

      _mediaRecorder = new MediaRecorder(finalStream, recorderOpts);
      console.log('[Recorder] Using codec:', _mediaRecorder.mimeType);

      // ── 8. Tell main process to open a write stream ────────
      var result = await window.k10.startRecording({ ext: 'webm' });
      if (result.error) {
        throw new Error(result.error);
      }

      // ── 9. Stream chunks to main process ───────────────────
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

      // ── 10. Start — request data every 1 second ────────────
      _mediaRecorder.start(1000);
      _recording = true;
      _startTime = Date.now();

      window.dispatchEvent(new CustomEvent('recording-state-change', {
        detail: { recording: true, filename: result.filename },
      }));

      // Start telemetry sidecar alongside video
      if (typeof window.sidecarStart === 'function' && result.path) {
        window.sidecarStart(result.path);
      }

      console.log('[Recorder] Recording started → ' + result.filename);
      return { success: true, filename: result.filename };

    } catch (err) {
      console.error('[Recorder] Start failed:', err);
      cleanup();
      return { error: err.message };
    }
  }

  // ── Facecam composite ──────────────────────────────────────
  // Draw display capture + webcam PiP onto an offscreen canvas,
  // then captureStream() to produce a single video track.
  function createCompositeStream(displayStream, webcamStream, settings) {
    var displayTrack = displayStream.getVideoTracks()[0];
    var displaySettings = displayTrack.getSettings();
    var canvasW = displaySettings.width || 3440;
    var canvasH = displaySettings.height || 1440;

    // Create offscreen canvas at display resolution
    _compositeCanvas = document.createElement('canvas');
    _compositeCanvas.width = canvasW;
    _compositeCanvas.height = canvasH;
    _compositeCtx = _compositeCanvas.getContext('2d');

    // Video elements for drawing frames
    var displayVideo = document.createElement('video');
    displayVideo.srcObject = displayStream;
    displayVideo.muted = true;
    displayVideo.play();

    var webcamVideo = document.createElement('video');
    webcamVideo.srcObject = webcamStream;
    webcamVideo.muted = true;
    webcamVideo.play();

    // Facecam PiP dimensions and position
    var fc = Object.assign({}, FACECAM_DEFAULTS, settings.recordingFacecam || {});
    var pipW = fc.width;
    var pipH = fc.height;
    var pipX = fc.x === 'left' ? fc.margin : canvasW - pipW - fc.margin;
    var pipY = fc.y === 'top' ? fc.margin : canvasH - pipH - fc.margin;

    // Composite draw loop — runs at display refresh rate
    function drawFrame() {
      _compositeCtx.drawImage(displayVideo, 0, 0, canvasW, canvasH);

      if (webcamVideo.readyState >= 2) {
        // Draw rounded rect clip for the facecam
        _compositeCtx.save();
        roundedRect(_compositeCtx, pipX, pipY, pipW, pipH, fc.borderRadius);
        _compositeCtx.clip();
        _compositeCtx.drawImage(webcamVideo, pipX, pipY, pipW, pipH);
        _compositeCtx.restore();

        // Border
        if (fc.borderWidth > 0) {
          _compositeCtx.save();
          _compositeCtx.strokeStyle = fc.borderColor;
          _compositeCtx.lineWidth = fc.borderWidth;
          roundedRect(_compositeCtx, pipX, pipY, pipW, pipH, fc.borderRadius);
          _compositeCtx.stroke();
          _compositeCtx.restore();
        }
      }

      _compositeAnimFrame = requestAnimationFrame(drawFrame);
    }

    drawFrame();

    // captureStream(0) = manual frame rate, driven by rAF
    // captureStream(60) = browser-managed 60fps
    var canvasStream = _compositeCanvas.captureStream(60);
    return canvasStream.getVideoTracks()[0];
  }

  // Canvas helper: draw a rounded rectangle path
  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Stop recording ─────────────────────────────────────────
  async function stopRecording() {
    if (!_recording || !_mediaRecorder) {
      return { error: 'Not recording' };
    }

    return new Promise(function (resolve) {
      _mediaRecorder.onstop = async function () {
        var result = await window.k10.stopRecording();
        cleanup();

        window.dispatchEvent(new CustomEvent('recording-state-change', {
          detail: { recording: false, result: result },
        }));

        // Stop telemetry sidecar
        if (typeof window.sidecarStop === 'function') {
          window.sidecarStop();
        }

        console.log('[Recorder] Recording saved');

        // Auto-transcode .webm → .mp4 if FFmpeg is available
        if (result && result.success && result.path) {
          autoTranscode(result.path);
        }

        resolve(result);
      };

      _mediaRecorder.stop();
    });
  }

  // ── Auto-transcode ─────────────────────────────────────────
  // Fire-and-forget transcode from .webm → .mp4 using FFmpeg.
  // Runs in the background after recording stops. Progress is
  // forwarded to the UI via 'transcode-progress' IPC events.
  async function autoTranscode(webmPath) {
    var settings = window._settings || {};

    // If user chose WebM output, skip transcode entirely
    if (settings.recordingOutputFormat === 'webm') {
      console.log('[Recorder] Output format is WebM — skipping transcode');
      return;
    }

    if (!window.k10 || !window.k10.getFfmpegInfo) return;

    var info = await window.k10.getFfmpegInfo();
    if (!info.available) {
      console.log('[Recorder] FFmpeg not available — keeping .webm');
      return;
    }

    console.log('[Recorder] Auto-transcode starting (' + info.encoder + ')...');
    window.dispatchEvent(new CustomEvent('transcode-state-change', {
      detail: { transcoding: true, encoder: info.encoder },
    }));

    var opts = {
      quality: settings.recordingQuality || 'high',
      encoder: settings.recordingEncoder || 'auto',
      deleteSource: settings.recordingDeleteSource !== false,
    };

    try {
      var result = await window.k10.transcodeRecording(webmPath, opts);
      if (result.error) {
        console.warn('[Recorder] Transcode failed:', result.error);
      } else {
        console.log('[Recorder] Transcode complete → ' + result.outputPath);
      }
      window.dispatchEvent(new CustomEvent('transcode-state-change', {
        detail: { transcoding: false, result: result },
      }));
    } catch (err) {
      console.error('[Recorder] Transcode error:', err);
      window.dispatchEvent(new CustomEvent('transcode-state-change', {
        detail: { transcoding: false, error: err.message },
      }));
    }
  }

  // ── Toggle ─────────────────────────────────────────────────
  async function toggleRecording() {
    if (_recording) {
      return stopRecording();
    } else {
      return startRecording();
    }
  }

  // ── Cleanup ────────────────────────────────────────────────
  function cleanup() {
    _recording = false;
    _startTime = 0;

    if (_compositeAnimFrame) {
      cancelAnimationFrame(_compositeAnimFrame);
      _compositeAnimFrame = null;
    }
    _compositeCanvas = null;
    _compositeCtx = null;

    if (_displayStream) {
      _displayStream.getTracks().forEach(function (t) { t.stop(); });
      _displayStream = null;
    }
    if (_micStream) {
      _micStream.getTracks().forEach(function (t) { t.stop(); });
      _micStream = null;
    }
    if (_systemAudioStream) {
      _systemAudioStream.getTracks().forEach(function (t) { t.stop(); });
      _systemAudioStream = null;
    }
    if (_webcamStream) {
      _webcamStream.getTracks().forEach(function (t) { t.stop(); });
      _webcamStream = null;
    }
    if (_audioContext) {
      _audioContext.close().catch(function () {});
      _audioContext = null;
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
  window.recorderEnumerateDevices = enumerateDevices;
})();
