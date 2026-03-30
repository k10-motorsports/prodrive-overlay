// ═══════════════════════════════════════════════════════════════
//  RATING EDITOR — Manual iRating, License & Safety Rating entry
//  Lives in the iRacing settings tab (requires Discord connection).
//  Persists to disk via Electron IPC (irating-history.json).
//  Ctrl+Shift+I opens settings and switches to the iRacing tab.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  let _manualIR = 0;
  let _manualSR = 0;
  let _manualLicense = '';
  let _ratingHistory = [];

  // ── Expose to poll engine ──
  window._manualIRating = 0;
  window._manualSafetyRating = 0;
  window._manualLicense = '';

  // ── DOM refs ──
  const irInput = document.getElementById('reIRatingInput');
  const irSlider = document.getElementById('reIRatingSlider');
  const srInput = document.getElementById('reSRInput');
  const srSlider = document.getElementById('reSRSlider');
  const licSelect = document.getElementById('reLicenseSelect');
  const historyEl = document.getElementById('reHistory');

  // ── Sync input ↔ slider ──
  if (irInput && irSlider) {
    irInput.addEventListener('input', function() {
      irSlider.value = Math.min(+irSlider.max, Math.max(0, +irInput.value));
    });
    irSlider.addEventListener('input', function() {
      irInput.value = (+irSlider.value).toFixed(0);
    });
  }
  if (srInput && srSlider) {
    srInput.addEventListener('input', function() {
      srSlider.value = Math.min(+srSlider.max, Math.max(0, +srInput.value));
    });
    srSlider.addEventListener('input', function() {
      srInput.value = (+srSlider.value).toFixed(2);
    });
  }

  // ── Toggle: open settings → switch to iRacing tab ──
  function toggleRatingEditor() {
    const overlay = document.getElementById('settingsOverlay');
    const iracingTab = document.getElementById('iracingTab');
    if (!overlay || !iracingTab) return;

    if (!overlay.classList.contains('open')) {
      if (typeof toggleSettings === 'function') toggleSettings();
    }
    if (typeof switchSettingsTab === 'function') switchSettingsTab(iracingTab);

    _populateInputs();
    renderHistory();
  }
  window.toggleRatingEditor = toggleRatingEditor;

  function _populateInputs() {
    if (irInput) irInput.value = _manualIR > 0 ? _manualIR.toFixed(0) : '';
    if (irSlider) irSlider.value = _manualIR || 0;
    if (srInput) srInput.value = _manualSR > 0 ? _manualSR.toFixed(2) : '';
    if (srSlider) srSlider.value = _manualSR || 0;
    if (licSelect) licSelect.value = _manualLicense || 'R';
  }

  // ── Enable/disable iRacing tab based on K10 Pro connection ──
  function updateIRacingTabState() {
    const tab = document.getElementById('iracingTab');
    if (!tab) return;
    const connected = !!_k10User;
    tab.classList.toggle('disabled', !connected);
    tab.title = connected ? '' : 'Connect K10 Pro to enable';
  }
  window.updateIRacingTabState = updateIRacingTabState;

  // ── License display string ──
  function _licenseLabel(code) {
    if (code === 'R') return 'R';
    if (code === 'P') return 'Pro';
    return code || '—';
  }

  // ── Save values ──
  function saveRatingValues() {
    const newIR = Math.max(0, +(irInput ? irInput.value : 0));
    const newSR = Math.max(0, Math.min(4.99, +(srInput ? srInput.value : 0)));
    const newLic = licSelect ? licSelect.value : _manualLicense;

    const entry = {
      timestamp: new Date().toISOString(),
      iRating: +newIR.toFixed(2),
      safetyRating: +newSR.toFixed(2),
      license: newLic,
      prevIR: +_manualIR.toFixed(2),
      prevSR: +_manualSR.toFixed(2),
      prevLicense: _manualLicense,
    };

    _manualIR = newIR;
    _manualSR = newSR;
    _manualLicense = newLic;
    window._manualIRating = _manualIR;
    window._manualSafetyRating = _manualSR;
    window._manualLicense = _manualLicense;

    if (entry.iRating !== entry.prevIR || entry.safetyRating !== entry.prevSR || entry.license !== entry.prevLicense) {
      _ratingHistory.push(entry);
      if (_ratingHistory.length > 200) _ratingHistory = _ratingHistory.slice(-200);
    }

    const data = { iRating: _manualIR, safetyRating: _manualSR, license: _manualLicense, history: _ratingHistory };
    if (window.k10 && window.k10.saveRatingData) {
      window.k10.saveRatingData(data);
    }
    try { localStorage.setItem('k10-rating-data', JSON.stringify(data)); } catch(e) {}

    _applyToDisplay();
    renderHistory();
  }
  window.saveRatingValues = saveRatingValues;

  // ── Reset to saved values ──
  function resetRatingEditor() {
    _populateInputs();
  }
  window.resetRatingEditor = resetRatingEditor;

  // ── Delete a history entry ──
  function deleteRatingEntry(idx) {
    if (idx < 0 || idx >= _ratingHistory.length) return;
    _ratingHistory.splice(idx, 1);
    const data = { iRating: _manualIR, safetyRating: _manualSR, license: _manualLicense, history: _ratingHistory };
    if (window.k10 && window.k10.saveRatingData) window.k10.saveRatingData(data);
    try { localStorage.setItem('k10-rating-data', JSON.stringify(data)); } catch(e) {}
    renderHistory();
  }
  window.deleteRatingEntry = deleteRatingEntry;

  // ── Apply to dashboard display ──
  function _applyToDisplay() {
    if ((_manualIR > 0 || _manualSR > 0) && typeof window.setHasRatingData === 'function') {
      window.setHasRatingData(true);
    }
    const ratVals = document.querySelectorAll('.rating-value');
    if (ratVals.length >= 2) {
      ratVals[0].textContent = _manualIR > 0 ? Math.round(_manualIR).toString() : '—';
      ratVals[1].textContent = _manualSR > 0 ? _manualSR.toFixed(2) : '—';
    }
    if (typeof updateIRBar === 'function') updateIRBar(_manualIR);
    if (typeof updateSRPie === 'function') updateSRPie(_manualSR);
    // Show license letter in the SR delta slot
    const ratDeltas = document.querySelectorAll('.rating-delta');
    if (ratDeltas.length >= 2) {
      ratDeltas[1].textContent = _manualLicense ? _licenseLabel(_manualLicense) : (_manualSR > 0 ? (_manualSR >= 3.0 ? 'A' : _manualSR >= 2.0 ? 'B' : _manualSR >= 1.0 ? 'C' : 'D') : '—');
    }
  }

  // ── Render history ──
  function renderHistory() {
    if (!historyEl) return;
    if (_ratingHistory.length === 0) {
      historyEl.innerHTML = '<div style="text-align:center;padding:8px 0;color:hsla(0,0%,100%,0.25);">No history yet</div>';
      return;
    }
    const recent = _ratingHistory.slice(-10).reverse();
    let html = '';
    for (let ri = 0; ri < recent.length; ri++) {
      const e = recent[ri];
      // Real index in _ratingHistory (recent is reversed, so map back)
      const realIdx = _ratingHistory.length - 1 - ri;
      const date = new Date(e.timestamp);
      const dateStr = (date.getMonth()+1) + '/' + date.getDate() + ' ' + date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
      const irDelta = e.iRating - e.prevIR;
      const srDelta = e.safetyRating - e.prevSR;
      const irDeltaStr = irDelta !== 0 ? (irDelta > 0 ? '+' : '') + irDelta.toFixed(0) : '';
      const srDeltaStr = srDelta !== 0 ? (srDelta > 0 ? '+' : '') + srDelta.toFixed(2) : '';
      const licStr = e.license ? _licenseLabel(e.license) : '';
      html += '<div class="re-history-entry">'
        + '<span>' + dateStr + '</span>'
        + '<span>iR ' + e.iRating + (irDeltaStr ? ' <span style="color:' + (irDelta > 0 ? 'var(--green)' : 'var(--red)') + '">' + irDeltaStr + '</span>' : '') + '</span>'
        + '<span>' + licStr + ' ' + e.safetyRating.toFixed(2) + (srDeltaStr ? ' <span style="color:' + (srDelta > 0 ? 'var(--green)' : 'var(--red)') + '">' + srDeltaStr + '</span>' : '') + '</span>'
        + '<button class="re-history-del" onclick="deleteRatingEntry(' + realIdx + ')">&times;</button>'
        + '</div>';
    }
    historyEl.innerHTML = html;
  }

  // ── Load on startup ──
  async function initRatingEditor() {
    let data = null;

    if (window.k10 && window.k10.getRatingData) {
      try { data = await window.k10.getRatingData(); } catch(e) {}
    }
    if (!data || (!data.iRating && !data.safetyRating)) {
      try { data = JSON.parse(localStorage.getItem('k10-rating-data') || 'null'); } catch(e) {}
    }

    if (data) {
      _manualIR = +(data.iRating || 0);
      _manualSR = +(data.safetyRating || 0);
      _manualLicense = data.license || '';
      _ratingHistory = Array.isArray(data.history) ? data.history : [];
      window._manualIRating = _manualIR;
      window._manualSafetyRating = _manualSR;
      window._manualLicense = _manualLicense;
      if (_manualIR > 0 || _manualSR > 0) _applyToDisplay();
    }

    if (window.k10 && window.k10.onToggleRatingEditor) {
      window.k10.onToggleRatingEditor(toggleRatingEditor);
    }

    updateIRacingTabState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRatingEditor);
  } else {
    initRatingEditor();
  }
})();
