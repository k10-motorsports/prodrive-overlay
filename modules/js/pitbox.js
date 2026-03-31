// ═══════════════════════════════════════════════════════════════
//  PIT BOX — Tabbed driver panel: tyres, fuel, weather,
//  in-car adjustments, camera/FFB.
//  All data read-only from telemetry. Respects iRacing DisplayUnits.
// ═══════════════════════════════════════════════════════════════

(function initPitBox() {
  'use strict';

  // ── DOM cache (populated on first update) ──
  let _els = null;
  let _lastIsIRacing = null;

  // ── Previous values for change detection ──
  const _prev = {};
  let _initialized = false;

  // ── Wheel button input counters ──
  // The plugin increments these each time the corresponding SimHub action fires.
  // We detect changes per-frame and dispatch the appropriate UI action.
  let _lastTabCycle = -1;
  let _lastTabCycleBack = -1;
  let _lastNext = -1;
  let _lastPrev = -1;
  let _lastIncrement = -1;
  let _lastDecrement = -1;
  let _lastToggle = -1;
  var _tabOrder = ['tyres', 'fuel', 'weather', 'adj', 'camera'];
  var _pbHidden = false;  // "off" state — pitbox dismissed via tab cycling past the edges

  function cacheElements() {
    var $ = function(id) { return document.getElementById(id); };
    _els = {
      panel:       $('pitBoxPanel'),
      noData:      $('pbNoData'),
      content:     $('pbContent'),
      // Tyres tab — pit selections
      tireLF:      $('pbTireLF'),   tireRF:      $('pbTireRF'),
      tireLR:      $('pbTireLR'),   tireRR:      $('pbTireRR'),
      pressLF:     $('pbPressLF'),  pressRF:     $('pbPressRF'),
      pressLR:     $('pbPressLR'),  pressRR:     $('pbPressRR'),
      // Tyres tab — wear bars
      wearLF:      $('pbWearLF'),   wearLFVal:   $('pbWearLFVal'),
      wearRF:      $('pbWearRF'),   wearRFVal:   $('pbWearRFVal'),
      wearLR:      $('pbWearLR'),   wearLRVal:   $('pbWearLRVal'),
      wearRR:      $('pbWearRR'),   wearRRVal:   $('pbWearRRVal'),
      // Tyres tab — temps
      tempLF:      $('pbTempLF'),   tempRF:      $('pbTempRF'),
      tempLR:      $('pbTempLR'),   tempRR:      $('pbTempRR'),
      // Fuel tab
      fuelBar:     $('pbFuelBar'),
      fuelLevel:   $('pbFuelLevel'),
      fuelUnit:    $('pbFuelUnit'),
      fuelPerLap:  $('pbFuelPerLap'),
      fuelLaps:    $('pbFuelLaps'),
      fuelVal:     $('pbFuelVal'),
      fastRepair:  $('pbFastRepair'),
      windshield:  $('pbWindshield'),
      // Weather tab
      weatherIcon: $('pbWeatherIcon'),
      airTemp:     $('pbAirTemp'),
      trackTemp:   $('pbTrackTemp'),
      conditions:  $('pbConditions'),
      // Adjustments tab
      adjBB:    $('pbAdjBB'),    adjTC:    $('pbAdjTC'),
      adjABS:   $('pbAdjABS'),   adjARBF:  $('pbAdjARBF'),
      adjARBR:  $('pbAdjARBR'),  adjEng:   $('pbAdjEng'),
      adjFuel:  $('pbAdjFuel'),  adjWJL:   $('pbAdjWJL'),
      adjWJR:   $('pbAdjWJR'),   adjWingF: $('pbAdjWingF'),
      adjWingR: $('pbAdjWingR'),
      rowTC:    $('pbRowTC'),    rowABS:   $('pbRowABS'),
      rowARBF:  $('pbRowARBF'),  rowARBR:  $('pbRowARBR'),
      rowEng:   $('pbRowEng'),   rowFuel:  $('pbRowFuel'),
      rowWJL:   $('pbRowWJL'),   rowWJR:   $('pbRowWJR'),
      rowWingF: $('pbRowWingF'), rowWingR: $('pbRowWingR'),
      // Camera tab
      ffbMax:   $('pbFFBMax'),
      mirror:   $('pbMirror'),
    };
  }

  // ── Tab switching ──
  window.switchPbTab = function(el) {
    var tab = el.dataset.pbTab;
    if (!tab) return;
    // Deactivate all tabs and pages
    var tabs = document.querySelectorAll('.pb-tab');
    var pages = document.querySelectorAll('.pb-page');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    // Activate selected
    el.classList.add('active');
    var page = document.querySelector('[data-pb-page="' + tab + '"]');
    if (page) page.classList.add('active');
  };

  // ── Flash animation ──
  function flash(el) {
    if (!el || !_initialized) return;
    el.classList.remove('pb-flash');
    void el.offsetWidth;
    el.classList.add('pb-flash');
    setTimeout(function() { el.classList.remove('pb-flash'); }, 1400);
  }

  function checkAndFlash(key, newVal, el) {
    if (_prev[key] !== undefined && _prev[key] !== newVal) flash(el);
    _prev[key] = newVal;
  }

  function setRowVisible(rowEl, visible) {
    if (!rowEl) return;
    rowEl.classList.toggle('hidden', !visible);
  }

  // ── Wear bar helpers ──
  // Parse tyre wear with null-awareness and raw telemetry fallback.
  // Returns null when no data available, otherwise 0-1 (1=new, 0=worn).
  function _parseTyreWear(gameDataVal, rawL, rawM, rawR) {
    // Try GameData value first
    if (gameDataVal != null && gameDataVal !== '') {
      var v = parseFloat(gameDataVal);
      if (!isNaN(v)) return v;
    }
    // Fallback: raw telemetry wear points (average of inner/mid/outer)
    var l = parseFloat(rawL), m = parseFloat(rawM), r = parseFloat(rawR);
    if (!isNaN(l) && !isNaN(m) && !isNaN(r) && (l + m + r) > 0) {
      return (l + m + r) / 3;
    }
    return null; // No data available yet
  }

  function updateWearBar(fillEl, valEl, wear) {
    if (!fillEl || !valEl) return;
    if (wear === null || wear === undefined) {
      // No data — show placeholder instead of fake 100%
      fillEl.style.width = '0%';
      fillEl.className = 'pb-tire-bar-fill';
      valEl.textContent = '—';
      return;
    }
    var pct = Math.max(0, Math.min(100, (1 - wear) * 100));
    var remaining = Math.round(pct);
    fillEl.style.width = remaining + '%';
    fillEl.className = 'pb-tire-bar-fill' +
      (remaining < 20 ? ' crit' : remaining < 40 ? ' warn' : '');
    valEl.textContent = remaining + '%';
  }

  // ── Temperature formatting — respects DisplayUnits ──
  function formatTemp(celsius, units) {
    if (!celsius && celsius !== 0) return '—';
    var c = parseFloat(celsius) || 0;
    if (c === 0) return '—';
    // units: 0=imperial(°F), 1=metric(°C)
    if (units === 0) return Math.round(c * 9 / 5 + 32) + '°F';
    return Math.round(c) + '°C';
  }

  // ── Main update handler ──
  window.updatePitBox = function(d) {
    if (!_els) cacheElements();
    if (!_els || !_els.panel) return;

    // Show/hide based on game detection
    var isIRacing = typeof _isIRacing !== 'undefined' ? _isIRacing : false;
    if (isIRacing !== _lastIsIRacing) {
      _lastIsIRacing = isIRacing;
      if (_els.noData) _els.noData.style.display = isIRacing ? 'none' : '';
      if (_els.content) _els.content.style.display = isIRacing ? '' : 'none';
    }
    if (!isIRacing) return;

    var pb = function(key) { return d['K10Motorsports.Plugin.PitBox.' + key]; };
    var dc = function(key) { return d['DataCorePlugin.GameRawData.Telemetry.' + key]; };
    var ds = function(key) { return d['K10Motorsports.Plugin.DS.' + key]; };
    var gd = function(key) { return d['DataCorePlugin.GameData.' + key]; };

    // 0=imperial, 1=metric. Cannot use `|| 1` fallback here because 0 is a
    // valid value (imperial) — `0 || 1` would incorrectly evaluate to metric.
    var rawUnits = ds('DisplayUnits');
    var units = (rawUnits !== '' && rawUnits !== null && rawUnits !== undefined)
      ? parseInt(rawUnits) : 1;

    // ════════════════════════════════════════
    //  TYRES TAB
    // ════════════════════════════════════════

    // Pit selections
    updateTire('LF', _els.tireLF, _els.pressLF, pb('TireLF'), pb('PressureLF'));
    updateTire('RF', _els.tireRF, _els.pressRF, pb('TireRF'), pb('PressureRF'));
    updateTire('LR', _els.tireLR, _els.pressLR, pb('TireLR'), pb('PressureLR'));
    updateTire('RR', _els.tireRR, _els.pressRR, pb('TireRR'), pb('PressureRR'));

    // Wear bars — iRacing sends 0-1 where 1=new, 0=worn.
    // Use null-aware parsing: null/undefined means "no data yet" (show —),
    // whereas 0 means "fully worn" (show 0%).
    // Fall back to raw telemetry average if GameData returns null (first lap).
    var wearFL = _parseTyreWear(gd('TyreWearFrontLeft'), dc('LFwearL'), dc('LFwearM'), dc('LFwearR'));
    var wearFR = _parseTyreWear(gd('TyreWearFrontRight'), dc('RFwearL'), dc('RFwearM'), dc('RFwearR'));
    var wearRL = _parseTyreWear(gd('TyreWearRearLeft'), dc('LRwearL'), dc('LRwearM'), dc('LRwearR'));
    var wearRR = _parseTyreWear(gd('TyreWearRearRight'), dc('RRwearL'), dc('RRwearM'), dc('RRwearR'));
    updateWearBar(_els.wearLF, _els.wearLFVal, wearFL);
    updateWearBar(_els.wearRF, _els.wearRFVal, wearFR);
    updateWearBar(_els.wearLR, _els.wearLRVal, wearRL);
    updateWearBar(_els.wearRR, _els.wearRRVal, wearRR);

    // Tyre temps
    if (_els.tempLF) _els.tempLF.textContent = formatTemp(gd('TyreTempFrontLeft'), units);
    if (_els.tempRF) _els.tempRF.textContent = formatTemp(gd('TyreTempFrontRight'), units);
    if (_els.tempLR) _els.tempLR.textContent = formatTemp(gd('TyreTempRearLeft'), units);
    if (_els.tempRR) _els.tempRR.textContent = formatTemp(gd('TyreTempRearRight'), units);

    // ════════════════════════════════════════
    //  FUEL TAB
    // ════════════════════════════════════════

    var fuelPct = parseFloat(ds('FuelPct')) || 0;
    var fuelFormatted = ds('FuelFormatted') || '—';
    var fuelPerLap = ds('FuelPerLapFormatted') || '—';
    var fuelLaps = parseFloat(ds('FuelLapsRemaining')) || 0;
    var fuelDisplay = pb('FuelDisplay') || '—';
    var fuelRequested = pb('FuelRequested');
    var unitLabel = units === 0 ? 'gallons' : 'liters';

    // Fuel gauge bar
    if (_els.fuelBar) {
      _els.fuelBar.style.width = Math.min(100, fuelPct) + '%';
      _els.fuelBar.className = 'pb-fuel-bar-fill' +
        (fuelPct < 10 ? ' crit' : fuelPct < 25 ? ' warn' : '');
    }
    if (_els.fuelLevel) _els.fuelLevel.textContent = fuelFormatted;
    if (_els.fuelUnit) _els.fuelUnit.textContent = unitLabel;
    if (_els.fuelPerLap) _els.fuelPerLap.textContent = fuelPerLap;
    if (_els.fuelLaps) {
      _els.fuelLaps.textContent = fuelLaps > 0 && fuelLaps < 99
        ? fuelLaps.toFixed(1) : '—';
    }
    // Pit fuel add
    if (_els.fuelVal) {
      _els.fuelVal.textContent = fuelRequested ? fuelDisplay : 'OFF';
      _els.fuelVal.className = 'pb-value ' + (fuelRequested ? 'active' : 'inactive');
      checkAndFlash('fuel', fuelDisplay + '|' + fuelRequested, _els.fuelVal.parentElement);
    }

    // Services
    updateToggle('fastRepair', _els.fastRepair, pb('FastRepairRequested'));
    updateToggle('windshield', _els.windshield, pb('WindshieldRequested'));

    // ════════════════════════════════════════
    //  WEATHER TAB
    // ════════════════════════════════════════

    var airTemp = parseFloat(ds('AirTemp')) || 0;
    var trackTempVal = parseFloat(ds('TrackTemp')) || 0;
    var isWet = parseInt(ds('WeatherWet')) === 1;

    if (_els.weatherIcon) _els.weatherIcon.textContent = isWet ? '🌧' : '☀';
    if (_els.airTemp) _els.airTemp.textContent = formatTemp(airTemp, units);
    if (_els.trackTemp) _els.trackTemp.textContent = formatTemp(trackTempVal, units);
    if (_els.conditions) {
      _els.conditions.textContent = isWet ? 'Wet' : 'Dry';
      _els.conditions.className = 'pb-value' + (isWet ? ' on' : '');
    }

    // ════════════════════════════════════════
    //  ADJUSTMENTS TAB
    // ════════════════════════════════════════

    setRowVisible(_els.rowTC,    pb('HasTC'));
    setRowVisible(_els.rowABS,   pb('HasABS'));
    setRowVisible(_els.rowARBF,  pb('HasARBFront'));
    setRowVisible(_els.rowARBR,  pb('HasARBRear'));
    setRowVisible(_els.rowEng,   pb('HasEnginePower'));
    setRowVisible(_els.rowFuel,  pb('HasFuelMixture'));
    setRowVisible(_els.rowWJL,   pb('HasWeightJackerL'));
    setRowVisible(_els.rowWJR,   pb('HasWeightJackerR'));
    setRowVisible(_els.rowWingF, pb('HasWingFront'));
    setRowVisible(_els.rowWingR, pb('HasWingRear'));

    updateAdj('bb',    _els.adjBB,    dc('dcBrakeBias'),         '%', 1);
    updateAdj('tc',    _els.adjTC,    dc('dcTractionControl'),   '',  0);
    updateAdj('abs',   _els.adjABS,   dc('dcABS'),               '',  0);
    updateAdj('arbf',  _els.adjARBF,  dc('dcAntiRollFront'),     '',  0);
    updateAdj('arbr',  _els.adjARBR,  dc('dcAntiRollRear'),      '',  0);
    updateAdj('eng',   _els.adjEng,   dc('dcEnginePower'),       '',  0);
    updateAdj('fmix',  _els.adjFuel,  dc('dcFuelMixture'),       '',  0);
    updateAdj('wjl',   _els.adjWJL,   dc('dcWeightJackerLeft'),  '',  0);
    updateAdj('wjr',   _els.adjWJR,   dc('dcWeightJackerRight'), '',  0);
    updateAdj('wingf', _els.adjWingF, dc('dcWingFront'),         '',  0);
    updateAdj('wingr', _els.adjWingR, dc('dcWingRear'),          '',  0);

    // ════════════════════════════════════════
    //  CAMERA / FFB TAB
    // ════════════════════════════════════════

    // dcFFBMaxForce is not currently exposed in telemetry —
    // show "—" until we wire it. Mirrors are in-sim only.
    if (_els.ffbMax) _els.ffbMax.textContent = '—';
    if (_els.mirror) _els.mirror.textContent = '—';

    // ════════════════════════════════════════
    //  WHEEL BUTTON INPUTS
    // ════════════════════════════════════════

    var tabCycle     = parseInt(ds('PitboxTabCycle')) || 0;
    var tabCycleBack = parseInt(ds('PitboxTabCycleBack')) || 0;
    var pbNext       = parseInt(ds('PitboxNext')) || 0;
    var pbPrev       = parseInt(ds('PitboxPrev')) || 0;
    var pbInc        = parseInt(ds('PitboxIncrement')) || 0;
    var pbDec        = parseInt(ds('PitboxDecrement')) || 0;
    var pbTog        = parseInt(ds('PitboxToggle')) || 0;

    if (_lastTabCycle === -1) {
      // First frame — capture baselines, don't fire anything
      _lastTabCycle = tabCycle; _lastTabCycleBack = tabCycleBack;
      _lastNext = pbNext; _lastPrev = pbPrev;
      _lastIncrement = pbInc; _lastDecrement = pbDec;
      _lastToggle = pbTog;
    } else {
      // Tab cycling — respond to TabCycle, TabCycleBack, Next, and Prev
      var tabDir = 0;
      if (tabCycle !== _lastTabCycle)         { _lastTabCycle = tabCycle; tabDir = 1; }
      if (tabCycleBack !== _lastTabCycleBack) { _lastTabCycleBack = tabCycleBack; tabDir = -1; }
      if (pbNext !== _lastNext)               { _lastNext = pbNext; tabDir = 1; }
      if (pbPrev !== _lastPrev)               { _lastPrev = pbPrev; tabDir = -1; }
      if (tabDir !== 0) {
        var panel = document.getElementById('pitBoxPanel');
        if (_pbHidden) {
          // Re-show: next → first tab, prev → last tab
          _pbHidden = false;
          if (panel) panel.classList.remove('pb-dismissed');
          var revealIdx = tabDir === 1 ? 0 : _tabOrder.length - 1;
          var revealTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[revealIdx] + '"]');
          if (revealTab) switchPbTab(revealTab);
        } else {
          var activeTab = document.querySelector('.pb-tab.active');
          var currentKey = activeTab ? activeTab.dataset.pbTab : _tabOrder[0];
          var idx = _tabOrder.indexOf(currentKey);
          // Check if cycling past an edge → dismiss
          var atEnd   = (tabDir === 1  && idx === _tabOrder.length - 1);
          var atStart = (tabDir === -1 && idx === 0);
          if (atEnd || atStart) {
            _pbHidden = true;
            if (panel) panel.classList.add('pb-dismissed');
            // Deselect all tabs and pages so state is clean on re-show
            var allTabs = document.querySelectorAll('.pb-tab');
            var allPages = document.querySelectorAll('.pb-page');
            for (var t = 0; t < allTabs.length; t++) allTabs[t].classList.remove('active');
            for (var p = 0; p < allPages.length; p++) allPages[p].classList.remove('active');
          } else {
            var nextIdx = idx + tabDir;
            var nextTab = document.querySelector('.pb-tab[data-pb-tab="' + _tabOrder[nextIdx] + '"]');
            if (nextTab) switchPbTab(nextTab);
          }
        }
      }
      if (pbInc !== _lastIncrement)  { _lastIncrement = pbInc;  /* TODO: increment focused value */ }
      if (pbDec !== _lastDecrement)  { _lastDecrement = pbDec;  /* TODO: decrement focused value */ }
      if (pbTog !== _lastToggle) { _lastToggle = pbTog; /* TODO: toggle focused element on/off */ }
    }

    // Enable flash detection after first full frame
    if (!_initialized) _initialized = true;
  };

  // ── Tire update helper ──
  function updateTire(pos, statusEl, pressEl, isChanging, pressStr) {
    if (statusEl) {
      statusEl.textContent = isChanging ? 'CHANGE' : 'KEEP';
      statusEl.className = 'pb-tire-status ' + (isChanging ? 'changing' : 'keeping');
    }
    if (pressEl) {
      var p = pressStr || '—';
      pressEl.textContent = isChanging ? p : '—';
      pressEl.style.opacity = isChanging ? '1' : '0.3';
    }
    var key = 'tire' + pos;
    var val = (isChanging ? 1 : 0) + '|' + pressStr;
    checkAndFlash(key, val, statusEl ? statusEl.parentElement : null);
  }

  function updateToggle(key, el, isOn) {
    if (!el) return;
    el.textContent = isOn ? 'YES' : 'NO';
    el.className = 'pb-value ' + (isOn ? 'on' : 'off');
    checkAndFlash(key, isOn ? 1 : 0, el.parentElement);
  }

  function updateAdj(key, el, val, suffix, decimals) {
    if (!el) return;
    var v = parseFloat(val) || 0;
    if (v === 0) {
      el.textContent = '—';
      el.className = 'pb-adj-val zero';
    } else {
      el.textContent = v.toFixed(decimals) + suffix;
      el.className = 'pb-adj-val';
    }
    checkAndFlash('adj_' + key, v.toFixed(decimals), el.parentElement);
  }

})();
