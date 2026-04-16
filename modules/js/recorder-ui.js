// ═══════════════════════════════════════════════════════════════
// RECORDER UI — Recording indicator, timer, and controls
// Shows a red recording dot + elapsed time in the overlay corner.
// Listens for recording-state-change events from recorder.js.
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
})();
