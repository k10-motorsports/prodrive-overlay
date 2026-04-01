// WebGL utility functions and data

  const TACH_SEGS = 11;
  const tachoBar = document.getElementById('tachoBar');
  const rpmText = document.getElementById('rpmText');
  for (let i = 0; i < TACH_SEGS; i++) {
    const s = document.createElement('div');
    s.className = 'tacho-seg';
    tachoBar.appendChild(s);
  }

  const RPM_COLORS = {
    green: 'var(--green)',
    yellow: 'var(--amber)',
    red: 'var(--red)',
    dim: 'var(--text-dim)',
  };

  let _prevLitCount = 0;
  let _rpmPulseTimer = null;

  function updateTacho(pct) {
    const segs = tachoBar.children;
    const lit = Math.round(pct * TACH_SEGS);
    let topColor = 'dim';
    for (let i = 0; i < TACH_SEGS; i++) {
      segs[i].className = 'tacho-seg';
      if (i < lit) {
        const f = i / TACH_SEGS;
        if (f < 0.55) { segs[i].classList.add('lit-green'); topColor = 'green'; }
        else if (f < 0.73) { segs[i].classList.add('lit-yellow'); topColor = 'yellow'; }
        else if (f < 0.91) { segs[i].classList.add('lit-red'); topColor = 'red'; }
        else { segs[i].classList.add('lit-redline'); topColor = 'red'; }
        segs[i].style.height = '100%';
      } else {
        segs[i].style.height = '2px';
      }
    }
    rpmText.style.color = RPM_COLORS[topColor];

    // Pulse the RPM text when a new segment lights up
    if (lit > _prevLitCount && lit > 0) {
      const pulseClass = topColor === 'green' ? 'rpm-pulse-green'
        : topColor === 'yellow' ? 'rpm-pulse-yellow' : 'rpm-pulse-red';
      rpmText.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
      // Force reflow so the class re-triggers the transition
      void rpmText.offsetWidth;
      rpmText.classList.add(pulseClass);
      if (_rpmPulseTimer) clearTimeout(_rpmPulseTimer);
      _rpmPulseTimer = setTimeout(() => {
        rpmText.classList.remove('rpm-pulse-green', 'rpm-pulse-yellow', 'rpm-pulse-red');
      }, 180);
    }
    _prevLitCount = lit;
  }
  updateTacho(0); // Will be driven by SimHub RPM data

  // ═══ LAYERED PEDAL HISTOGRAMS — DOM bars ═══
  const HIST_BARS = 20;
  function setupHist(id, cls) {
    const c = document.getElementById(id);
    if (!c) return;
    for (let i = 0; i < HIST_BARS; i++) {
      const b = document.createElement('div');
      b.className = `pedal-hist-bar ${cls}`;
      if (i === HIST_BARS - 1) b.classList.add('live');
      c.appendChild(b);
    }
  }
  setupHist('throttleHist', 'throttle');
  setupHist('brakeHist', 'brake');
  setupHist('clutchHist', 'clutch');

  function renderHist(id, data) {
    const el = document.getElementById(id);
    if (!el) return;
    const bars = el.children;
    for (let i = 0; i < data.length && i < bars.length; i++)
      bars[i].style.transform = 'scaleY(' + Math.max(0.01, data[i]) + ')';
  }
  // Initialize empty
  renderHist('throttleHist', new Array(HIST_BARS).fill(0));
  renderHist('brakeHist', new Array(HIST_BARS).fill(0));
  renderHist('clutchHist', new Array(HIST_BARS).fill(0));

  // Rolling history buffers
  const _thrHist = new Array(HIST_BARS).fill(0);
  const _brkHist = new Array(HIST_BARS).fill(0);
  const _cltHist = new Array(HIST_BARS).fill(0);

  // ═══ PEDAL TRACE — curve-following dots + trail (2D canvas) ═══
  // When a pedal profile is active, dots travel along the response curves.
  // Falls back to time-series waveforms when no profile is loaded.
  const _pedalTraceLen = 120;
  const _ptThr = new Float32Array(_pedalTraceLen);
  const _ptBrk = new Float32Array(_pedalTraceLen);
  const _ptClt = new Float32Array(_pedalTraceLen);
  let _ptIdx = 0;
  let _ptCount = 0;
  const _ptCanvas = document.getElementById('pedalTraceCanvas');
  const _ptCtx = _ptCanvas ? _ptCanvas.getContext('2d') : null;

  // Trail history for curve-following dots (stores canvas positions)
  const _trailLen = 16;
  const _thrTrail = [];
  const _brkTrail = [];
  const _cltTrail = [];

  // ─── rAF-gated pedal rendering ───
  let _pedalRafId = 0;
  let _pedalPending = false;
  let _pendingThr = 0, _pendingBrk = 0, _pendingClt = 0;

  function renderPedalTrace(thr, brk, clt) {
    _pendingThr = thr;
    _pendingBrk = brk;
    _pendingClt = clt;
    if (!_pedalPending) {
      _pedalPending = true;
      _pedalRafId = requestAnimationFrame(_flushPedalFrame);
    }
  }

  function _flushPedalFrame() {
    _pedalPending = false;
    const thr = _pendingThr, brk = _pendingBrk, clt = _pendingClt;

    // Shift rolling histogram and add new sample
    _thrHist.shift(); _thrHist.push(thr);
    _brkHist.shift(); _brkHist.push(brk);
    _cltHist.shift(); _cltHist.push(clt);
    renderHist('throttleHist', _thrHist);
    renderHist('brakeHist', _brkHist);
    renderHist('clutchHist', _cltHist);

    // Update percentage labels
    const labels = document.querySelectorAll('.pedal-pct');
    if (labels.length >= 3) {
      labels[0].textContent = Math.round(thr * 100) + '%';
      labels[1].textContent = Math.round(brk * 100) + '%';
      labels[2].textContent = Math.round(clt * 100) + '%';
    }

    if (!_ptCtx) return;
    const c = _ptCanvas;
    const rect = c.getBoundingClientRect();
    if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
      c.width = Math.round(rect.width);
      c.height = Math.round(rect.height);
    }
    const w = c.width, h = c.height;
    const ctx = _ptCtx;
    ctx.clearRect(0, 0, w, h);

    // ── Curve-following mode: dots travel along response curves ──
    const curvePos = window.getCurvePositions ? window.getCurvePositions(thr, brk, clt) : null;
    if (curvePos && curvePos.length > 0) {
      _renderCurveDots(ctx, curvePos, thr, brk, clt);
      return;
    }

    // ── Fallback: time-series waveforms (no profile loaded) ──
    _ptThr[_ptIdx] = thr;
    _ptBrk[_ptIdx] = brk;
    _ptClt[_ptIdx] = clt;
    _ptIdx = (_ptIdx + 1) % _pedalTraceLen;
    _ptCount++;

    const count = Math.min(_ptCount, _pedalTraceLen);
    if (count < 3) return;

    const traces = [
      { buf: _ptThr, color: [76, 175, 80] },
      { buf: _ptBrk, color: [244, 67, 54] },
      { buf: _ptClt, color: [66, 165, 245] },
    ];

    for (const tr of traces) {
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const idx = (_ptIdx - count + i + _pedalTraceLen) % _pedalTraceLen;
        const x = (i / (count - 1)) * w;
        const y = h - tr.buf[idx] * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      const [r, g, b] = tr.color;
      grad.addColorStop(0, `rgba(${r},${g},${b},0.0)`);
      grad.addColorStop(0.3, `rgba(${r},${g},${b},0.08)`);
      grad.addColorStop(0.7, `rgba(${r},${g},${b},0.2)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.45)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      const lastIdx = (_ptIdx - 1 + _pedalTraceLen) % _pedalTraceLen;
      const lastVal = tr.buf[lastIdx];
      if (lastVal > 0.02) {
        const lx = w - 1;
        const ly = h - lastVal * (h - 2) - 1;
        ctx.beginPath();
        ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
        ctx.fill();
      }
    }
  }

  // ── Curve-following dot renderer ──
  // Each dot sits on the response curve at the current pedal input position.
  // A fading trail of recent positions shows movement along the curve.
  function _renderCurveDots(ctx, positions, thr, brk, clt) {
    // Update trails — map pedal values to their corresponding trail arrays
    const trailMap = [
      { trail: _thrTrail, val: thr },
      { trail: _brkTrail, val: brk },
      { trail: _cltTrail, val: clt },
    ];

    // Push new positions into trail buffers
    for (const pos of positions) {
      let trail;
      if (pos.rgb[0] === 76) trail = _thrTrail;        // green = throttle
      else if (pos.rgb[0] === 244) trail = _brkTrail;   // red = brake
      else trail = _cltTrail;                            // blue = clutch

      trail.push({ x: pos.x, y: pos.y });
      while (trail.length > _trailLen) trail.shift();
    }

    // Clear trails for pedals not in positions (below threshold)
    if (thr <= 0.01) _thrTrail.length = 0;
    if (brk <= 0.01) _brkTrail.length = 0;
    if (clt <= 0.01) _cltTrail.length = 0;

    // Draw trails + dots
    const allTrails = [
      { trail: _thrTrail, rgb: [76, 175, 80] },
      { trail: _brkTrail, rgb: [244, 67, 54] },
      { trail: _cltTrail, rgb: [66, 165, 245] },
    ];

    for (const { trail, rgb } of allTrails) {
      if (trail.length < 1) continue;
      const [r, g, b] = rgb;

      // Draw fading trail line
      if (trail.length >= 2) {
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) * 0.35;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Draw glowing dot at current position
      const cur = trail[trail.length - 1];

      // Outer glow
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
      ctx.fill();

      // Inner glow
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.fill();
    }
  }

  // ═══ COMMENTARY ═══
  const col = document.getElementById('commentaryCol');
  const dash = document.getElementById('dashboard');
  const inner = document.getElementById('commentaryInner');

  // ── Commentary icon library ──
  // Each SVG uses currentColor so it inherits the sentiment hue via style.color.
  // viewBox 0 0 24 24, stroke-based, 1.5px stroke for clarity at 28px render size.
  const _s = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra||''}>${d}</svg>`;
  const _commentaryIcons = {
    // ── car_response ──
    spin_catch:        _s('<path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/><path d="M14.5 9.5l3-3" stroke-dasharray="2 2"/>'),
    wall_contact:      _s('<rect x="2" y="4" width="4" height="16" rx="1"/><path d="M6 12h5"/><path d="M11 8l4 4-4 4"/><path d="M15 7l2 2-2 2"/><path d="M17 13l2 2-2 2"/><circle cx="19" cy="6" r="1" fill="currentColor" stroke="none"/>'),
    off_track:         _s('<path d="M3 20L12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>'),
    kerb_hit:          _s('<path d="M3 18h18"/><path d="M3 18l3-3h2l3-3h2l3-3h2l3-3"/><path d="M8 12v6"/><path d="M16 6v12"/><circle cx="12" cy="9" r="2"/>'),
    high_cornering_load: _s('<circle cx="12" cy="12" r="9"/><path d="M12 12l6-3"/><path d="M12 3v2"/><path d="M12 19v2"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="M5.64 5.64l1.41 1.41"/><path d="M16.95 16.95l1.41 1.41"/>'),
    heavy_braking:     _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><rect x="10" y="6" width="4" height="5" rx="1" fill="currentColor" stroke="none" opacity="0.5"/><path d="M8 12h8"/><path d="M12 8v8"/>'),
    car_balance_sustained: _s('<path d="M4 16l4-8h8l4 8"/><circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><path d="M12 4v4"/><path d="M10 6h4"/>'),
    rapid_gear_change: _s('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7v4h3V7"/><path d="M12 11v4h3v-4"/><path d="M9 15v3"/><circle cx="12" cy="19" r="0.5" fill="currentColor"/>'),

    // ── hardware ──
    abs_activation:    _s('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h2l1-2 1 4 1-4 1 2h2"/>', ' stroke-width="1.8"'),
    tc_intervention:   _s('<path d="M12 3a9 9 0 1 0 0 18"/><path d="M12 3a9 9 0 0 1 0 18"/><path d="M9 9l6 6"/><path d="M9 9h3v3"/>'),
    ffb_torque_spike:  _s('<path d="M12 2v20"/><path d="M2 12h20"/><path d="M7 7c2 2 3 5 5 5s3-3 5-5"/><path d="M7 17c2-2 3-5 5-5s3 3 5 5"/>'),
    brake_bias_change: _s('<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M8 8h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/><path d="M16 8h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1"/><path d="M8 12h8" stroke-dasharray="2 1"/>'),
    tc_setting_change: _s('<circle cx="12" cy="12" r="9"/><path d="M8 8h8"/><path d="M12 8v8"/><path d="M9 15l3-3 3 3" stroke-dasharray="2 1"/>'),
    abs_setting_change: _s('<circle cx="12" cy="12" r="9"/><path d="M7 12h10"/><path d="M7 9h10"/><path d="M7 15h10"/><circle cx="14" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
    arb_front_change:  _s('<path d="M4 16h16"/><path d="M6 16V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/><path d="M10 12h4" stroke-dasharray="2 1"/><path d="M8 10l2 2-2 2"/>'),
    arb_rear_change:   _s('<path d="M4 8h16"/><path d="M6 8v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><path d="M10 12h4" stroke-dasharray="2 1"/><path d="M16 10l-2 2 2 2"/>'),

    // ── game_feel ──
    qualifying_push:   _s('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8"/>'),
    drs_active:        _s('<path d="M2 8h20"/><path d="M4 8l2 10h12l2-10"/><path d="M8 8V5a4 4 0 0 1 8 0v3"/><path d="M10 12h4" stroke-dasharray="3 2"/>'),
    ers_low:           _s('<path d="M2 12h4l2-4 3 8 3-8 2 4h4"/><path d="M18 6l2 2-2 2"/>'),
    personal_best:     _s('<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.3L12 16.7l-6.2 4.5 2.4-7.3L2 9.4h7.6z"/>'),
    long_stint:        _s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M16 4l2 2"/><path d="M8 4L6 6"/>'),
    session_time_low:  _s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/><path d="M3 3l3 3"/><path d="M21 3l-3 3"/>'),

    // ── racing_experience ──
    close_battle:      _s('<path d="M5 17l3-12h3l2 5 2-5h3l3 12"/><path d="M4 10h16" stroke-dasharray="3 2"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>'),
    position_gained:   _s('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
    position_lost:     _s('<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>'),
    yellow_flag:       _s('<path d="M5 2v20"/><path d="M5 4h12l-3 4 3 4H5"/>'),
    debris_on_track:   _s('<path d="M3 20h18"/><path d="M7 17l2-5"/><path d="M12 12l-1-4"/><path d="M15 14l2-6"/><path d="M10 17l1-3"/><circle cx="8" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="7" r="1.5" fill="currentColor"/><circle cx="17" cy="11" r="1" fill="currentColor"/>'),
    race_start:        _s('<circle cx="8" cy="6" r="2.5"/><circle cx="16" cy="6" r="2.5"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><circle cx="8" cy="18" r="2.5" fill="currentColor" opacity="0.3"/><circle cx="16" cy="18" r="2.5" fill="currentColor" opacity="0.3"/>'),
    formation_lap:     _s('<path d="M3 6h18"/><path d="M7 6v12"/><path d="M12 6v12"/><path d="M17 6v12"/><path d="M5 14h14" stroke-dasharray="2 2"/><path d="M3 18h18"/>'),
    pit_entry:         _s('<path d="M3 12h4l2-3h6l2 3h4"/><path d="M7 12v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/><path d="M11 5h2v4h-2z" fill="currentColor" stroke="none"/><path d="M10 5h4"/>'),
    low_fuel:          _s('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4V2h6v2"/><path d="M9 12h6"/><path d="M12 12v5"/><path d="M8 18h8" stroke-dasharray="2 1"/>'),
    wet_track:         _s('<path d="M4 14a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 0 4-4 4 4 0 0 1 4 4"/><path d="M4 18a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 0 4-4 4 4 0 0 1 4 4"/><path d="M8 3v3"/><path d="M12 2v4"/><path d="M16 3v3"/>'),
    track_temp_cold:   _s('<path d="M12 2v14"/><circle cx="12" cy="18" r="4"/><path d="M8 18a4 4 0 0 0 8 0"/><path d="M10 8h4"/><path d="M10 11h4"/><path d="M3 5l2 1"/><path d="M3 9l2-1"/>'),
    track_temp_hot:    _s('<path d="M12 2v14"/><circle cx="12" cy="18" r="4" fill="currentColor" opacity="0.2"/><path d="M8 18a4 4 0 0 0 8 0"/><path d="M10 8h4"/><path d="M10 11h4"/><path d="M18 3l1 3"/><path d="M20 8l-2 1"/><path d="M19 12l-2-1"/>'),
    tyre_wear_high:    _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M9 7l6 10" stroke-dasharray="2 2"/><path d="M15 7l-6 10" stroke-dasharray="2 2"/>'),
    hot_tyres:         _s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="M10 10l-3-3" stroke-dasharray="1.5 1.5"/><path d="M14 14l3 3" stroke-dasharray="1.5 1.5"/>'),
    incident_spike:    _s('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>'),
    black_flag:        _s('<path d="M5 2v20"/><path d="M5 4h14v8H5"/><path d="M5 4h7v4H5" fill="currentColor" opacity="0.4"/><path d="M12 8h7v4h-7" fill="currentColor" opacity="0.4"/>'),

    // strategy engine
    strategy_call:     _s('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),

    // fallback
    _default:          _s('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/>')
  };

  // Title → topicId reverse map (fallback when CommentaryTopicId isn't available)
  const _titleToTopicId = {
    'Big Save': 'spin_catch',
    'Wall / Barrier Contact': 'wall_contact',
    'Off Track': 'off_track',
    'Kerb / Curb Hit': 'kerb_hit',
    'ABS Activation': 'abs_activation',
    'Traction Control Cut': 'tc_intervention',
    'Close Racing': 'close_battle',
    'Position Gained': 'position_gained',
    'Position Lost': 'position_lost',
    'Yellow Flag': 'yellow_flag',
    'Debris on Track': 'debris_on_track',
    'Race Start': 'race_start',
    'Formation / Pace Lap': 'formation_lap',
    'Personal Best Lap': 'personal_best',
    'Pit Lane Entry': 'pit_entry',
    'Maximum Cornering Load': 'high_cornering_load',
    'FFB Torque Spike': 'ffb_torque_spike',
    'Low Fuel': 'low_fuel',
    'Wet Conditions': 'wet_track',
    'Cold Track Conditions': 'track_temp_cold',
    'High Tyre Wear': 'tyre_wear_high',
    'Overheating Tyres': 'hot_tyres',
    'Major Braking Zone': 'heavy_braking',
    'Hot Qualifying Lap': 'qualifying_push',
    'iRacing Incident Points': 'incident_spike',
    'ERS Battery Low': 'ers_low',
    'High Track Temperature': 'track_temp_hot',
    'DRS Open': 'drs_active',
    'Car On The Limit': 'car_balance_sustained',
    'Black Flag': 'black_flag',
    'Aggressive Gear Shift': 'rapid_gear_change',
    'Long Stint Distance': 'long_stint',
    'Session Time Running Out': 'session_time_low',
    'Brake Bias Adjustment': 'brake_bias_change',
    'Traction Control Adjusted': 'tc_setting_change',
    'ABS Level Adjusted': 'abs_setting_change',
    'Front ARB Adjusted': 'arb_front_change',
    'Rear ARB Adjusted': 'arb_rear_change',
  };

  // Category → icon fallback (when neither topicId nor title match)
  const _categoryIcons = {
    car_response:       _commentaryIcons['car_balance_sustained'],
    hardware:           _commentaryIcons['abs_activation'],
    game_feel:          _commentaryIcons['qualifying_push'],
    racing_experience:  _commentaryIcons['close_battle'],
    strategy:           _s('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),
  };

  function _resolveCommentaryIcon(topicId, title, category) {
    if (topicId && _commentaryIcons[topicId]) return _commentaryIcons[topicId];
    const idFromTitle = _titleToTopicId[title];
    if (idFromTitle && _commentaryIcons[idFromTitle]) return _commentaryIcons[idFromTitle];
    if (category && _categoryIcons[category]) return _categoryIcons[category];
    return _commentaryIcons['_default'];
  }

  // Overheating topics → force orange (hue 30) or red (hue 0) based on severity
  const _heatTopics = { hot_tyres: true, track_temp_hot: true };
  // Wear / degradation topics → force orange hue
  const _wearTopics = { tyre_wear_high: true, long_stint: true };
  // Best / achievement topics → force green color scheme
  const _bestTopics = { personal_best: true, position_gained: true };

  function showCommentary(hue, title, text, meta, topicId, severity, trackImage) {
    // Resolve topic early so we can override hue for heat, wear & best topics
    const resolvedTopic = topicId || _titleToTopicId[title] || '';
    if (_heatTopics[resolvedTopic]) {
      hue = (severity >= 3) ? 0 : 30;   // high severity → red, else orange
    } else if (_wearTopics[resolvedTopic]) {
      hue = 30;                           // orange for wear/degradation
    } else if (_bestTopics[resolvedTopic]) {
      hue = 145;                          // green for achievements
    }

    col.style.setProperty('--commentary-h', hue);
    inner.style.background = `hsla(${hue}, 50%, 13%, 0.96)`;
    inner.style.borderColor = `hsla(${hue}, 50%, 27%, 0.50)`;
    document.getElementById('commentaryTitle').textContent = title;
    document.getElementById('commentaryTitle').style.color = `hsl(${hue},55%,65%)`;
    // Set commentary icon — try topicId, then title lookup, then category, then default
    const iconEl = document.getElementById('commentaryIcon');
    const iconColor = `hsl(${hue},55%,65%)`;
    const svgStr = _resolveCommentaryIcon(topicId, title, meta);
    iconEl.innerHTML = svgStr;
    iconEl.style.color = iconColor;
    const textEl = document.getElementById('commentaryText');
    const scrollEl = document.getElementById('commentaryScroll');
    textEl.textContent = text;
    textEl.classList.remove('scrolling');
    scrollEl.classList.remove('no-overflow');
    document.getElementById('commentaryMeta').textContent = meta;

    // Track image — show when URL provided by track-related commentary
    const imgEl = document.getElementById('commentaryTrackImg');
    if (trackImage) {
      imgEl.style.backgroundImage = `url(${trackImage})`;
      imgEl.innerHTML = '<span class="img-attr">Wikimedia Commons \u00B7 CC</span>';
      imgEl.classList.add('active');
    } else {
      imgEl.classList.remove('active');
    }

    col.classList.add('visible');
    dash.style.setProperty('--sentiment-h', hue);
    dash.style.setProperty('--sentiment-s', '40%');
    dash.style.setProperty('--sentiment-l', '12%');
    dash.style.setProperty('--sentiment-alpha', '0.06');

    // Activate data visualization for this topic (hue already overridden for heat)
    if (window.showCommentaryViz) window.showCommentaryViz(resolvedTopic, hue);
    // Activate WebGL trail effect on commentary border
    if (window.setCommentaryTrailGL) window.setCommentaryTrailGL(true, hue);

    // After width transition settles (~600ms), measure overflow for slow scroll
    setTimeout(() => {
      const scrollH = scrollEl.clientHeight;
      const textH = textEl.scrollHeight;
      if (textH > scrollH + 4) {
        const overflow = textH - scrollH;
        textEl.style.setProperty('--scroll-distance', `-${overflow}px`);
        // Duration: ~40px/s so it reads comfortably
        const duration = Math.max(6, overflow / 40 * 2 + 4);
        textEl.style.setProperty('--scroll-duration', `${duration.toFixed(1)}s`);
        textEl.classList.add('scrolling');
      } else {
        scrollEl.classList.add('no-overflow');
      }
    }, 620);  // wait for commentary-col max-height transition (0.55s) to finish
  }
  function hideCommentary() {
    col.classList.remove('visible');
    dash.style.setProperty('--sentiment-alpha', '0');
    if (window.hideCommentaryViz) window.hideCommentaryViz();
    if (window.setCommentaryTrailGL) window.setCommentaryTrailGL(false);
    // Clear track image
    const imgEl = document.getElementById('commentaryTrackImg');
    if (imgEl) imgEl.classList.remove('active');
  }

  // ═══ CYCLING PANELS (rating/position only — fuel/tyres no longer cycle) ═══
  let ratingActive = true;

  let _hasRatingData = false; // set true when iRating or SR become nonzero
  // Allow external modules (rating-editor.js) to flag rating data as available
  window.setHasRatingData = function(val) { _hasRatingData = !!val; };
  // Expose current cycle state so poll-engine can use asymmetric timing
  window._isRatingPageActive = function() { return ratingActive; };
  function cycleRatingPos() {
    // Don't cycle to rating page if no iRating/SR data is available
    if (!_hasRatingData) return;
    const r = document.getElementById('ratingPage');
    const p = document.getElementById('positionPage');
    const d1 = document.getElementById('dotRating');
    const d2 = document.getElementById('dotPos');
    if (ratingActive) {
      r.classList.replace('active', 'inactive');
      p.classList.replace('inactive', 'active');
      d1.classList.remove('active'); d2.classList.add('active');
    } else {
      p.classList.replace('active', 'inactive');
      r.classList.replace('inactive', 'active');
      d2.classList.remove('active'); d1.classList.add('active');
    }
    ratingActive = !ratingActive;
  }

  // Force position page visible (used when timer row is showing)
  function showPositionPage() {
    const r = document.getElementById('ratingPage');
    const p = document.getElementById('positionPage');
    const d1 = document.getElementById('dotRating');
    const d2 = document.getElementById('dotPos');
    if (ratingActive) {
      r.classList.replace('active', 'inactive');
      p.classList.replace('inactive', 'active');
      d1.classList.remove('active'); d2.classList.add('active');
      ratingActive = false;
    }
  }

  // Cycling interval — call cycleRatingPos() from SimHub timer or JS setInterval
  // setInterval(cycleRatingPos, 10000);

  // ═══ iRATING BAR CHART ═══
  function updateIRBar(iRating) {
    const maxIR = 5000;
    const pct = Math.min(100, (iRating / maxIR) * 100);
    document.getElementById('irBarFill').style.width = pct + '%';
  }
  updateIRBar(0); // Will be set from session data

  // ═══ SAFETY RATING PIE CHART ═══
  function updateSRPie(srValue) {
    const pct = Math.min(1, srValue / 4.0);
    const circ = 2 * Math.PI * 15; // ~94.25
    const offset = circ * (1 - pct);
    const fill = document.getElementById('srPieFill');
    fill.setAttribute('stroke-dashoffset', offset);
    // Color: green if > 3.0, amber if > 2.0, red if lower
    if (srValue >= 3.0) fill.setAttribute('stroke', 'var(--green)');
    else if (srValue >= 2.0) fill.setAttribute('stroke', 'var(--amber)');
    else fill.setAttribute('stroke', 'var(--red)');
    // text label removed
  }
  updateSRPie(0); // Will be set from session data

  // ═══ FLASH SYSTEM ═══
  function flashElement(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), 1500);
  }

  function flashCtrlBar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('ctrl-changed', 'ctrl-flash-out');
    void el.offsetWidth;
    el.classList.add('ctrl-changed');
    setTimeout(() => {
      el.classList.remove('ctrl-changed');
      el.classList.add('ctrl-flash-out');
      setTimeout(() => el.classList.remove('ctrl-flash-out'), 1200);
    }, 300);
  }

  // ═══ CONTROL VISIBILITY ═══
  // Hide TC/ABS ctrl-items when the car doesn't have them
  function setCtrlVisibility(hasBB, hasTC, hasABS) {
    const bb = document.getElementById('ctrlBB');
    const tc = document.getElementById('ctrlTC');
    const abs = document.getElementById('ctrlABS');
    if (bb) bb.classList.toggle('ctrl-hidden', !hasBB);
    if (tc) tc.classList.toggle('ctrl-hidden', !hasTC);
    if (abs) abs.classList.toggle('ctrl-hidden', !hasABS);
    // Show "No Adjustments" when none are available
    const panel = bb && bb.closest('.car-controls');
    if (panel) panel.classList.toggle('no-adj', !hasBB && !hasTC && !hasABS);
  }

  // ═══ TYRE TEMPERATURE COLORING ═══
  // Returns CSS class based on tyre temp (°F for iRacing)
  function getTyreTempClass(tempF) {
    if (tempF <= 0) return '';
    if (tempF < 150) return 'cold';       // < 66°C
    if (tempF < 230) return 'optimal';     // 66-110°C
    if (tempF < 270) return 'hot';         // 110-132°C
    return 'danger';                       // > 132°C
  }

  // Update a single tyre cell: temp value + color class + wear bar.
  // wearPct is REMAINING life: 100 = brand new, 0 = destroyed, -1 = no data.
  function updateTyreCell(index, tempF, wearPct) {
    const cells = document.querySelectorAll('.tyre-cell');
    const wearFills = document.querySelectorAll('.tyre-wear-fill');
    if (index >= cells.length) return;
    const cell = cells[index];

    // No wear data — show empty bar with dim indicator
    if (wearPct < 0) {
      if (index < wearFills.length) {
        wearFills[index].style.width = '0%';
        wearFills[index].style.background = 'hsla(0,0%,100%,0.1)';
      }
      // Still update temp
      cell.textContent = tempF > 0 ? Math.round(tempF) + '°' : '—';
      cell.className = 'tyre-cell ' + getTyreTempClass(tempF);
      return;
    }

    cell.textContent = tempF > 0 ? Math.round(tempF) + '°' : '—';
    cell.className = 'tyre-cell ' + getTyreTempClass(tempF);
    if (index < wearFills.length) {
      wearFills[index].style.width = Math.max(0, Math.min(100, wearPct)) + '%';
      // Color by remaining life: > 50% green, > 25% amber, below = red
      if (wearPct > 50) wearFills[index].style.background = 'var(--green)';
      else if (wearPct > 25) wearFills[index].style.background = 'var(--amber)';
      else wearFills[index].style.background = 'var(--red)';
    }
  }

  // ═══ FUEL STATE ═══
  function updateFuelBar(pct, pitLapPct) {
    const bar = document.querySelector('.fuel-bar-inner');
    if (!bar) return;
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    bar.className = 'fuel-bar-inner';
    if (pct > 40) bar.classList.add('healthy');
    else if (pct > 15) bar.classList.add('caution');
    else bar.classList.add('critical');
    // Pit marker
    const marker = document.querySelector('.fuel-bar-pit-marker');
    if (marker && pitLapPct > 0) {
      marker.style.left = Math.min(100, pitLapPct) + '%';
      marker.style.display = '';
    } else if (marker) {
      marker.style.display = 'none';
    }
  }

  // ═══ TRACK MAP ═══
  let _mapLastPath = '';
  let _mapSmoothedX = 0, _mapSmoothedY = 0;
  let _mapHasInit = false;
  const _SVG_NS = 'http://www.w3.org/2000/svg';
  const _MAP_MAX_OPPONENTS = 63; // iRacing max field size

  // G-force animation trail on player dot — ring buffer of recent positions
  const _MAP_TRAIL_LEN = 24;
  const _mapTrailX = new Float32Array(_MAP_TRAIL_LEN);
  const _mapTrailY = new Float32Array(_MAP_TRAIL_LEN);
  const _mapTrailG = new Float32Array(_MAP_TRAIL_LEN); // total G at each sample
  let _mapTrailIdx = 0;
  let _mapTrailCount = 0;
  let _fullMapTrailEl = null;
  let _zoomMapTrailEl = null;

  // Parsed track path coordinates for snapping and off-track detection
  let _trackPathCoords = []; // [{x, y}, ...]
  const _OFF_TRACK_DIST = 4.0; // SVG units — beyond this, player is off-track

  // G threshold for "in a turn" — above this, a new trail segment begins
  const _TURN_G_THRESHOLD = 0.5;

  function _ensureTrailGroup(parentId, refElId) {
    const parent = document.getElementById(parentId);
    if (!parent) return null;
    let grp = parent.querySelector('.map-trail-group');
    if (grp) return grp;
    grp = document.createElementNS(_SVG_NS, 'g');
    grp.classList.add('map-trail-group');
    // Insert before the player dot so trail draws behind it
    const refEl = document.getElementById(refElId);
    if (refEl) parent.insertBefore(grp, refEl);
    else parent.appendChild(grp);
    return grp;
  }

  // Pool of reusable <line> elements per trail group
  var _trailLinePool = new WeakMap();

  function _renderMapTrail(grp, strokeWidth) {
    if (!grp) return;
    const count = Math.min(_mapTrailCount, _MAP_TRAIL_LEN);

    // Get or create line pool for this group
    var lines = _trailLinePool.get(grp);
    if (!lines) { lines = []; _trailLinePool.set(grp, lines); }

    if (count < 2) {
      for (var h = 0; h < lines.length; h++) lines[h].setAttribute('visibility', 'hidden');
      return;
    }

    // Walk samples newest→oldest, detect turn boundaries via G threshold.
    // "distFromTurn" tracks how far (in samples) we are from the most recent
    // high-G sample. Opacity starts bright at each turn and fades on straights.
    var segments = count - 1;
    var distFromTurn = 0;
    var inTurn = false;

    for (var i = 0; i < segments; i++) {
      var idxA = (_mapTrailIdx - 1 - i     + _MAP_TRAIL_LEN) % _MAP_TRAIL_LEN;
      var idxB = (_mapTrailIdx - 2 - i     + _MAP_TRAIL_LEN) % _MAP_TRAIL_LEN;
      var gA = _mapTrailG[idxA];

      // Detect turn boundary
      if (gA >= _TURN_G_THRESHOLD) {
        distFromTurn = 0;
        inTurn = true;
      } else {
        distFromTurn++;
        inTurn = false;
      }

      // Opacity: bright at turns, fading on straights
      // At turn (distFromTurn=0): alpha = 0.7
      // Fading linearly to 0.05 over ~12 samples on straights
      var fadeAlpha = Math.max(0.05, 0.7 - distFromTurn * 0.055);
      // Also fade older samples slightly (age-based)
      var ageFade = 1.0 - (i / segments) * 0.3;
      var alpha = fadeAlpha * ageFade;

      // Color: in-turn → warm (orange), straight → cool (cyan)
      var gNorm = Math.min(gA / 2.5, 1.0);
      var hue = Math.round(185 - gNorm * 155);
      var sat = Math.round(60 + gNorm * 30);
      var lum = Math.round(50 + gNorm * 10);

      // Ensure we have a <line> element
      if (i >= lines.length) {
        var ln = document.createElementNS(_SVG_NS, 'line');
        ln.setAttribute('stroke-linecap', 'round');
        grp.appendChild(ln);
        lines.push(ln);
      }
      var el = lines[i];
      el.setAttribute('x1', _mapTrailX[idxA].toFixed(1));
      el.setAttribute('y1', _mapTrailY[idxA].toFixed(1));
      el.setAttribute('x2', _mapTrailX[idxB].toFixed(1));
      el.setAttribute('y2', _mapTrailY[idxB].toFixed(1));
      el.setAttribute('stroke', 'hsla(' + hue + ',' + sat + '%,' + lum + '%,' + alpha.toFixed(2) + ')');
      el.setAttribute('stroke-width', String(strokeWidth));
      el.setAttribute('visibility', 'visible');
    }

    // Hide unused lines
    for (var j = segments; j < lines.length; j++) {
      lines[j].setAttribute('visibility', 'hidden');
    }
  }

  // Parse SVG path string into an array of {x, y} coordinates
  function _parsePathCoords(svgPath) {
    const raw = svgPath.match(/[\d.]+[,\s]+[\d.]+/g);
    if (!raw) return [];
    return raw.map(function(pair) {
      var parts = pair.split(/[,\s]+/);
      return { x: +parts[0], y: +parts[1] };
    });
  }

  // Find the nearest point on the parsed track path to (px, py)
  // Returns {x, y, dist} of the closest path coordinate
  function _nearestTrackPoint(px, py) {
    var best = { x: px, y: py, dist: Infinity };
    for (var i = 0; i < _trackPathCoords.length; i++) {
      var c = _trackPathCoords[i];
      var dx = px - c.x, dy = py - c.y;
      var d = dx * dx + dy * dy;
      if (d < best.dist) { best.x = c.x; best.y = c.y; best.dist = d; }
    }
    best.dist = Math.sqrt(best.dist);
    return best;
  }

  // Reset track map — clears recorded data and restarts capture
  function resetTrackMap() {
    fetch((window._simhubUrlOverride || SIMHUB_URL) + '?action=resetmap').catch(() => {});
    _mapLastPath = '';
    _mapHasInit = false;
    _trackPathCoords = [];
    _mapTrailCount = 0;
    _mapTrailIdx = 0;
    ['fullMapTrack', 'fullMapTrackOuter', 'fullMapTrackInner',
     'zoomMapTrack', 'zoomMapTrackOuter', 'zoomMapTrackInner'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.setAttribute('d', '');
    });
    // Clear trail polylines
    if (_fullMapTrailEl) _fullMapTrailEl.setAttribute('points', '');
    if (_zoomMapTrailEl) _zoomMapTrailEl.setAttribute('points', '');
    // Clear opponent dots
    const fg = document.getElementById('fullMapOpponents');
    const zg = document.getElementById('zoomMapOpponents');
    if (fg) fg.innerHTML = '';
    if (zg) zg.innerHTML = '';
  }

  // Sector colors: 0=none(transparent), 1=pb(purple), 2=faster(green), 3=slower(red)
  const _sectorColors = ['transparent', 'hsl(280,60%,55%)', 'hsl(130,60%,50%)', 'hsl(0,65%,50%)'];
  const _sectorActiveColor = 'hsla(0,0%,100%,0.25)';

  // Split an SVG path string into N sector sub-paths.
  // boundaryPcts is an array of N-1 boundary percentages (e.g. [0.33, 0.67] for 3 sectors).
  // Falls back to equal thirds if no boundaries provided.
  // Track map points are evenly distributed by LapDistPct, so point index ≈ pct * count.
  function _splitPathIntoSectors(svgPath, boundaryPcts) {
    const coords = svgPath.match(/[\d.]+[,\s]+[\d.]+/g);
    if (!coords || coords.length < 6) return [];

    // Determine boundary indices from percentages
    var pcts = (Array.isArray(boundaryPcts) && boundaryPcts.length >= 1)
      ? boundaryPcts
      : [0.333, 0.667]; // default to 3 sectors
    var indices = pcts.map(function(p) { return Math.round(p * coords.length); });

    // Build N sector sub-paths
    var result = [];
    var prevIdx = 0;
    for (var s = 0; s <= indices.length; s++) {
      var endIdx = s < indices.length ? indices[s] : coords.length;
      var pts = coords.slice(prevIdx, endIdx);
      if (pts.length === 0) { result.push(''); prevIdx = endIdx; continue; }
      var startPt = prevIdx === 0 ? pts[0] : coords[prevIdx - 1];
      var d = 'M ' + startPt;
      for (var j = (prevIdx === 0 ? 1 : 0); j < pts.length; j++) d += ' L ' + pts[j];
      result.push(d);
      prevIdx = endIdx;
    }
    return result;
  }
  window._splitPathIntoSectors = _splitPathIntoSectors;

  // Smoothed zoom radius for the local map
  let _mapZoomRadius = 15.5;

  // Smoothed heading for local map rotation
  let _mapSmoothedHeading = 0;

  function updateTrackMap(svgPath, playerX, playerY, opponentStr, speedMph, headingDeg) {
    // No track map available — clear outline, hide markers, center dots
    if (!svgPath && _mapLastPath !== '') {
      _mapLastPath = '';
      _mapHasInit = false;
      _trackPathCoords = [];
      ['fullMapTrack', 'fullMapTrackOuter', 'fullMapTrackInner',
       'zoomMapTrack', 'zoomMapTrackOuter', 'zoomMapTrackInner'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.setAttribute('d', '');
      });

      // Remove sector sub-paths
      const fullSvg = document.getElementById('fullMapSvg');
      if (fullSvg) fullSvg.querySelectorAll('.map-sector').forEach(el => el.remove());

      // Hide start/finish markers
      const fullSF = document.getElementById('fullMapSF');
      const zoomSF = document.getElementById('zoomMapSF');
      if (fullSF) fullSF.style.display = 'none';
      if (zoomSF) zoomSF.style.display = 'none';
    }

    // Update track outline (only when path changes — new track or first load)
    if (svgPath && svgPath !== _mapLastPath) {
      _mapLastPath = svgPath;
      _mapHasInit = false;
      // Parse coordinates for snapping and off-track detection
      _trackPathCoords = _parsePathCoords(svgPath);
      // Set path on all three layers (outer, gap, inner) for both maps
      ['fullMapTrack', 'fullMapTrackOuter', 'fullMapTrackInner',
       'zoomMapTrack', 'zoomMapTrackOuter', 'zoomMapTrackInner'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.setAttribute('d', svgPath);
      });

      // Split path into N sector sub-paths using native iRacing boundaries
      const boundaryPcts = Array.isArray(window._sectorBoundaries) ? window._sectorBoundaries : null;
      const sectorPaths = _splitPathIntoSectors(svgPath, boundaryPcts);
      const sectorCount = sectorPaths.length;

      // Dynamically create/update sector path elements in the full map SVG
      const fullSvg = document.getElementById('fullMapSvg');
      if (fullSvg) {
        // Remove old sector paths
        fullSvg.querySelectorAll('.map-sector').forEach(el => el.remove());
        // Insert new sector paths before the opponents group
        const oppGroup = document.getElementById('fullMapOpponents');
        for (let i = 0; i < sectorCount; i++) {
          const path = document.createElementNS(_SVG_NS, 'path');
          path.classList.add('map-sector');
          path.id = 'mapSector' + (i + 1);
          path.setAttribute('d', sectorPaths[i]);
          if (oppGroup) fullSvg.insertBefore(path, oppGroup);
          else fullSvg.appendChild(path);
        }
      }

      // Position start/finish marker at the first point of the path (LapDistPct=0)
      const sfMatch = svgPath.match(/^M\s*([\d.]+)[,\s]+([\d.]+)/);
      if (sfMatch) {
        const sfX = +sfMatch[1], sfY = +sfMatch[2];
        const fullSF = document.getElementById('fullMapSF');
        const zoomSF = document.getElementById('zoomMapSF');
        if (fullSF) {
          fullSF.setAttribute('transform', 'translate(' + sfX.toFixed(1) + ',' + sfY.toFixed(1) + ')');
          fullSF.style.display = '';
        }
        if (zoomSF) {
          zoomSF.setAttribute('transform', 'translate(' + sfX.toFixed(1) + ',' + sfY.toFixed(1) + ')');
          zoomSF.style.display = '';
        }
      }
    }

    // Update sector colors from live performance data (set by poll-engine)
    if (window._sectorData) {
      const sd = window._sectorData;
      for (let i = 1; i <= sd.sectorCount; i++) {
        const el = document.getElementById('mapSector' + i);
        if (!el) continue;
        if (i === sd.curSector) {
          el.setAttribute('stroke', _sectorActiveColor);
        } else {
          el.setAttribute('stroke', _sectorColors[sd.states[i - 1]] || 'transparent');
        }
      }
    }

    // Sanity: clamp coordinates to 0–100 SVG range
    playerX = Math.max(0, Math.min(100, playerX));
    playerY = Math.max(0, Math.min(100, playerY));

    // Snap player position to nearest track point when path is available
    // This keeps the demo car (and live car) visually on the track
    if (_trackPathCoords.length > 10) {
      var snap = _nearestTrackPoint(playerX, playerY);
      // Only snap if reasonably close (within ~6 SVG units) — prevents
      // warping from completely wrong coordinates
      if (snap.dist < 6) {
        playerX = snap.x;
        playerY = snap.y;
      }
    }

    // Smoothing: reject large jumps, low-pass filter coordinates
    if (!_mapHasInit) {
      _mapSmoothedX = playerX;
      _mapSmoothedY = playerY;
      _mapHasInit = true;
    } else {
      const dx = playerX - _mapSmoothedX;
      const dy = playerY - _mapSmoothedY;
      const jump = Math.sqrt(dx * dx + dy * dy);
      // If jump is huge (>20 SVG units), blend slowly (glitch recovery)
      const alpha = jump > 20 ? 0.08 : 0.45;
      _mapSmoothedX += dx * alpha;
      _mapSmoothedY += dy * alpha;
    }

    const sx = _mapSmoothedX;
    const sy = _mapSmoothedY;

    // Off-track detection: check distance from smoothed position to track path
    let isOffTrack = false;
    if (_trackPathCoords.length > 10) {
      var nearest = _nearestTrackPoint(sx, sy);
      isOffTrack = nearest.dist > _OFF_TRACK_DIST;
    }

    // Update track line highlighting based on on/off-track state
    document.querySelectorAll('.map-track-outer').forEach(function(el) {
      el.classList.toggle('off-track', isOffTrack);
    });
    document.querySelectorAll('.map-track-inner').forEach(function(el) {
      el.classList.toggle('on-track', !isOffTrack);
    });

    // Update player dot
    const fullPlayer = document.getElementById('fullMapPlayer');
    const zoomPlayer = document.getElementById('zoomMapPlayer');
    if (fullPlayer) {
      fullPlayer.setAttribute('cx', sx.toFixed(1));
      fullPlayer.setAttribute('cy', sy.toFixed(1));
    }
    if (zoomPlayer) {
      zoomPlayer.setAttribute('cx', sx.toFixed(1));
      zoomPlayer.setAttribute('cy', sy.toFixed(1));
    }

    // Update track glow effect following player position
    const glowFullSvg = document.getElementById('fullMapSvg');
    const glowZoomSvg = document.getElementById('zoomMapSvg');
    if (glowFullSvg) _updateTrackGlow(glowFullSvg, sx, sy);
    if (glowZoomSvg) _updateTrackGlow(glowZoomSvg, sx, sy);

    // G-force trail — read current G from datastream globals
    const latG  = window._ambientLatG  || 0;
    const longG = window._ambientLongG || 0;
    const totalG = Math.sqrt(latG * latG + longG * longG);

    // Sample position into ring buffer (every frame)
    _mapTrailX[_mapTrailIdx] = sx;
    _mapTrailY[_mapTrailIdx] = sy;
    _mapTrailG[_mapTrailIdx] = totalG;
    _mapTrailIdx = (_mapTrailIdx + 1) % _MAP_TRAIL_LEN;
    _mapTrailCount++;

    // Ensure trail SVG groups exist and render
    // Full map: trail as sibling before player dot
    if (!_fullMapTrailEl)  _fullMapTrailEl  = _ensureTrailGroup('fullMapSvg', 'fullMapPlayer');
    // Zoom map: trail INSIDE the rotate group so it rotates with the track
    if (!_zoomMapTrailEl) _zoomMapTrailEl = _ensureTrailGroup('zoomMapRotateGroup', 'zoomMapOpponents');
    _renderMapTrail(_fullMapTrailEl, 3);
    _renderMapTrail(_zoomMapTrailEl, 1.8);

    // Update zoom map — player always centered, track rotates so
    // driving direction always points UP. Zoom in when slow (corners),
    // zoom out when fast (straights) for a dynamic camera effect.
    const zoomSvg = document.getElementById('zoomMapSvg');
    if (zoomSvg) {
      const spd = typeof speedMph === 'number' ? speedMph : 0;
      // Speed-based zoom bands (zoom% where 100% = dot fills panel, 0% = full map):
      //   0-30 mph  → 75%    30-75 mph → 60%    75+ mph → 50%
      // Convert zoom% to SVG viewBox radius: r = 50 - zoom% * 0.46
      var zoomPct;
      if (spd < 30)       zoomPct = 75;
      else if (spd < 75)  zoomPct = 75 - (spd - 30) / 45 * 15;   // 75% → 60%
      else                zoomPct = 60 - Math.min((spd - 75) / 75, 1.0) * 10; // 60% → 50%
      const targetZR = 50 - zoomPct * 0.46;
      _mapZoomRadius += (targetZR - _mapZoomRadius) * 0.15;
      const zr = _mapZoomRadius;

      // ViewBox always centered on player — NO clamping, overflow="visible"
      // handles content outside the 0-100 range. Player is always at center.
      const vx = sx - zr;
      const vy = sy - zr;
      zoomSvg.setAttribute('viewBox', vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + (zr * 2).toFixed(1) + ' ' + (zr * 2).toFixed(1));

      // Clear any legacy CSS rotation on the SVG element
      zoomSvg.style.transform = '';
      zoomSvg.style.transformOrigin = '';

      // Rotate the inner group around the player's SVG coordinate so
      // the driving direction always points up. Player dot is outside
      // the group so it stays upright and visually centered.
      if (typeof headingDeg === 'number') {
        let diff = headingDeg - _mapSmoothedHeading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        // Dead-zone: ignore sub-degree jitter
        if (Math.abs(diff) < 0.5) diff = 0;
        _mapSmoothedHeading += diff * 0.15;
        _mapSmoothedHeading = ((_mapSmoothedHeading % 360) + 360) % 360;

        const rotGrp = document.getElementById('zoomMapRotateGroup');
        if (rotGrp) {
          rotGrp.setAttribute('transform',
            'rotate(' + (-_mapSmoothedHeading).toFixed(2) + ',' + sx.toFixed(1) + ',' + sy.toFixed(1) + ')');
        }
      }
    }

    // Parse and render opponents
    const fullG = document.getElementById('fullMapOpponents');
    const zoomG = document.getElementById('zoomMapOpponents');
    if (!fullG || !zoomG) return;

    // Parse "x,y,pit;x,y,pit;..." format
    const parts = opponentStr ? opponentStr.split(';') : [];
    const count = Math.min(parts.length, _MAP_MAX_OPPONENTS);

    // Ensure we have enough circle elements (create/remove as needed)
    _ensureOpponentDots(fullG, count, 2.5);
    _ensureOpponentDots(zoomG, count, 1.5);

    // Update positions
    const fullDots = fullG.children;
    const zoomDots = zoomG.children;
    for (let i = 0; i < count; i++) {
      const seg = parts[i].split(',');
      if (seg.length < 2) continue;
      // Clamp opponent coords to 0–100
      const ox = Math.max(0, Math.min(100, +seg[0]));
      const oy = Math.max(0, Math.min(100, +seg[1]));
      const inPit = seg[2] === '1';

      fullDots[i].setAttribute('cx', ox);
      fullDots[i].setAttribute('cy', oy);
      fullDots[i].style.display = inPit ? 'none' : '';
      fullDots[i].classList.toggle('close', _isClose(sx, sy, ox, oy));
      // Add pulse animation for nearby opponents (~20% track proximity)
      fullDots[i].classList.toggle('map-opponent-near', _isNear(sx, sy, ox, oy));

      zoomDots[i].setAttribute('cx', ox);
      zoomDots[i].setAttribute('cy', oy);
      zoomDots[i].style.display = inPit ? 'none' : '';
      zoomDots[i].classList.toggle('close', _isClose(sx, sy, ox, oy));
      // Add pulse animation for nearby opponents (~20% track proximity)
      zoomDots[i].classList.toggle('map-opponent-near', _isNear(sx, sy, ox, oy));
    }
  }

  function _ensureOpponentDots(parent, count, radius) {
    while (parent.children.length < count) {
      const c = document.createElementNS(_SVG_NS, 'circle');
      c.classList.add('map-opponent');
      c.setAttribute('r', radius);
      parent.appendChild(c);
    }
    while (parent.children.length > count) {
      parent.removeChild(parent.lastChild);
    }
  }

  function _isClose(px, py, ox, oy) {
    const dx = px - ox, dy = py - oy;
    return (dx * dx + dy * dy) < 64; // ~8 SVG units
  }

  function _isNear(px, py, ox, oy) {
    // Proximity pulse: ~20% of track (distance ~20 SVG units = ~400 units squared)
    const dx = px - ox, dy = py - oy;
    return (dx * dx + dy * dy) < 400; // ~20 SVG units
  }

  function _updateTrackGlow(svgEl, px, py) {
    // Create or update a radial gradient glow that follows player position
    let glow = svgEl.getElementById('trackPlayerGlow');
    let grad = svgEl.getElementById('trackGlowGrad');

    if (!glow) {
      // Create radial gradient definition once
      const defs = svgEl.querySelector('defs') || (() => {
        const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(d, svgEl.firstChild);
        return d;
      })();

      grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
      grad.id = 'trackGlowGrad';
      // Bright white-ish core that fades to brand color at edges
      const stopCore = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopCore.setAttribute('offset', '0%');
      stopCore.setAttribute('stop-color', 'hsl(0,0%,100%)');
      stopCore.setAttribute('stop-opacity', '0.45');
      grad.appendChild(stopCore);

      const stopMid = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopMid.setAttribute('offset', '35%');
      stopMid.setAttribute('stop-color', 'var(--map-player-color, hsl(185,70%,55%))');
      stopMid.setAttribute('stop-opacity', '0.25');
      grad.appendChild(stopMid);

      const stopOuter = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopOuter.setAttribute('offset', '100%');
      stopOuter.setAttribute('stop-color', 'var(--map-player-color, hsl(185,70%,55%))');
      stopOuter.setAttribute('stop-opacity', '0');
      grad.appendChild(stopOuter);

      defs.appendChild(grad);

      // Create glow circle overlay — tight radius, pulsing via CSS
      glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glow.id = 'trackPlayerGlow';
      glow.setAttribute('r', '7');
      glow.setAttribute('fill', 'url(#trackGlowGrad)');
      glow.style.pointerEvents = 'none';
      glow.style.mixBlendMode = 'screen';
      glow.style.animation = 'map-glow-pulse 2s ease-in-out infinite';

      // Insert before dots so it's behind them
      const dotsGroup = svgEl.querySelector('.map-opponent') || svgEl.lastChild;
      if (dotsGroup && dotsGroup.parentNode) {
        dotsGroup.parentNode.insertBefore(glow, dotsGroup);
      } else {
        svgEl.appendChild(glow);
      }
    }

    // Update glow position to follow player
    glow.setAttribute('cx', px.toFixed(1));
    glow.setAttribute('cy', py.toFixed(1));
  }

  // ═══ EXPOSE ALL FUNCTIONS TO WINDOW ═══
