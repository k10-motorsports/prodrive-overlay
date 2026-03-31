/**
 * @element racecor-driver-profile
 * @description Driver analytics panel with iRating/SR trends and session statistics.
 *
 * Shows:
 * - Driver name, license class (color-coded), member since date
 * - iRating chart (Canvas-based trend line)
 * - Safety Rating chart (Canvas-based trend line with license tiers)
 * - Session stats: laps completed, incidents, best lap time
 * - Car heatmap (frequency-based intensity visualization)
 *
 * Property-based updates for all rating data. Canvas charts render from history data.
 * Color-coded license classes (R, D, C, B, A, P) with brand-specific meanings.
 *
 * @property {string} driverName - Driver name / iRacing username
 * @property {string} licenseClass - Current license ('R', 'D', 'C', 'B', 'A', 'P')
 * @property {number} irating - Current iRating numeric value
 * @property {number} safetyRating - Current Safety Rating (0-4.0)
 * @property {Array<number>} iratingHistory - iRating trend history
 * @property {Array<number>} srHistory - Safety Rating trend history
 * @property {Object} stats - Session stats { lapsCompleted, incidents, bestLap }
 */

(function() {
  'use strict';

  class RaceCorDriverProfile extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._driverName = '';
      this._licenseClass = '';
      this._irating = 0;
      this._safetyRating = 0;
      this._iratingHistory = [];
      this._srHistory = [];
      this._stats = { lapsCompleted: 0, incidents: 0, bestLap: 0 };

      this._nameEl = null;
      this._licenseEl = null;
      this._iratingEl = null;
      this._srEl = null;
      this._statsEl = null;
      this._irChartCanvas = null;
      this._srChartCanvas = null;
      this._irChartCtx = null;
      this._srChartCtx = null;

      this._telemetryHandler = null;
    }

    connectedCallback() {
      this._renderTemplate();
      this._cacheElements();
      this._subscribeToData();
      this.render();
    }

    disconnectedCallback() {
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }
    }

    get driverName() { return this._driverName; }
    set driverName(val) { this._driverName = String(val || ''); }

    get licenseClass() { return this._licenseClass; }
    set licenseClass(val) { this._licenseClass = String(val || ''); }

    get irating() { return this._irating; }
    set irating(val) { this._irating = +val || 0; }

    get safetyRating() { return this._safetyRating; }
    set safetyRating(val) { this._safetyRating = +val || 0; }

    get iratingHistory() { return this._iratingHistory; }
    set iratingHistory(val) { this._iratingHistory = Array.isArray(val) ? val : []; }

    get srHistory() { return this._srHistory; }
    set srHistory(val) { this._srHistory = Array.isArray(val) ? val : []; }

    get stats() { return this._stats; }
    set stats(val) {
      if (val && typeof val === 'object') {
        this._stats = {
          lapsCompleted: +val.lapsCompleted || 0,
          incidents: +val.incidents || 0,
          bestLap: +val.bestLap || 0
        };
      }
    }

    updateData(snapshot) {
      if (!snapshot) return;

      const dsPre = 'K10Motorsports.Plugin.DS.';
      const gameDataPre = 'DataCorePlugin.GameData.';

      this._irating = +snapshot[dsPre + 'iRating'] || window._manualIRating || 0;
      this._safetyRating = +snapshot[dsPre + 'SafetyRating'] || window._manualSafetyRating || 0;
      this._licenseClass = snapshot[dsPre + 'License'] || window._manualLicense || '';

      this._stats.lapsCompleted = +snapshot[dsPre + 'CompletedLaps'] || 0;
      this._stats.incidents = +snapshot[dsPre + 'IncidentCount'] || 0;
      this._stats.bestLap = +snapshot[gameDataPre + 'BestLapTime'] || 0;

      this.render();
    }

    _renderTemplate() {
      if (!this.shadowRoot) return;

      const template = document.createElement('template');
      template.innerHTML = `
        <style>
          :host {
            display: block;
            font-family: var(--ff);
            color: var(--text-primary);
            padding: 12px;
            background: hsla(0, 0%, 8%, 0.90);
          }

          .dp-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .dp-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 8px;
            border-bottom: 1px solid hsla(0, 0%, 100%, 0.12);
          }

          .dp-driver-name {
            font-size: 16px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .dp-license {
            font-size: 12px;
            font-weight: 700;
            padding: 4px 8px;
            background: hsla(0, 0%, 100%, 0.1);
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .dp-ratings {
            display: flex;
            gap: 12px;
          }

          .dp-rating-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .dp-rating-label {
            font-size: 11px;
            font-weight: 700;
            color: hsla(0, 0%, 100%, 0.35);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .dp-rating-value {
            font-size: 18px;
            font-weight: 700;
            font-family: var(--ff-mono);
            font-variant-numeric: tabular-nums;
          }

          .dp-charts {
            display: flex;
            gap: 8px;
          }

          .dp-chart {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .dp-chart-label {
            font-size: 10px;
            font-weight: 700;
            color: hsla(0, 0%, 100%, 0.35);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          canvas {
            background: hsla(0, 0%, 100%, 0.03);
            border: 1px solid hsla(0, 0%, 100%, 0.08);
            border-radius: 4px;
          }

          .dp-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }

          .dp-stat {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 8px;
            background: hsla(0, 0%, 100%, 0.02);
            border: 1px solid hsla(0, 0%, 100%, 0.08);
            border-radius: 4px;
            text-align: center;
          }

          .dp-stat-label {
            font-size: 10px;
            font-weight: 700;
            color: hsla(0, 0%, 100%, 0.35);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .dp-stat-value {
            font-size: 14px;
            font-weight: 700;
            font-family: var(--ff-mono);
            font-variant-numeric: tabular-nums;
          }
        </style>

        <div class="dp-container">
          <div class="dp-header">
            <div class="dp-driver-name" id="dpName">Driver</div>
            <div class="dp-license" id="dpLicense">—</div>
          </div>

          <div class="dp-ratings">
            <div class="dp-rating-item">
              <div class="dp-rating-label">iRating</div>
              <div class="dp-rating-value" id="dpIRating">—</div>
            </div>
            <div class="dp-rating-item">
              <div class="dp-rating-label">Safety</div>
              <div class="dp-rating-value" id="dpSafety">—</div>
            </div>
          </div>

          <div class="dp-charts">
            <div class="dp-chart">
              <div class="dp-chart-label">iRating Trend</div>
              <canvas id="dpIRChart" width="120" height="60"></canvas>
            </div>
            <div class="dp-chart">
              <div class="dp-chart-label">Safety Trend</div>
              <canvas id="dpSRChart" width="120" height="60"></canvas>
            </div>
          </div>

          <div class="dp-stats">
            <div class="dp-stat">
              <div class="dp-stat-label">Laps</div>
              <div class="dp-stat-value" id="dpLaps">0</div>
            </div>
            <div class="dp-stat">
              <div class="dp-stat-label">Incidents</div>
              <div class="dp-stat-value" id="dpIncidents">0</div>
            </div>
            <div class="dp-stat">
              <div class="dp-stat-label">Best Lap</div>
              <div class="dp-stat-value" id="dpBestLap">—</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._nameEl = this.shadowRoot.querySelector('#dpName');
      this._licenseEl = this.shadowRoot.querySelector('#dpLicense');
      this._iratingEl = this.shadowRoot.querySelector('#dpIRating');
      this._srEl = this.shadowRoot.querySelector('#dpSafety');
      this._statsEl = this.shadowRoot.querySelector('#dpLaps');

      this._irChartCanvas = this.shadowRoot.querySelector('#dpIRChart');
      this._srChartCanvas = this.shadowRoot.querySelector('#dpSRChart');
      this._irChartCtx = this._irChartCanvas?.getContext('2d') || null;
      this._srChartCtx = this._srChartCanvas?.getContext('2d') || null;
    }

    _subscribeToData() {
      if (!window) return;
      this._telemetryHandler = (event) => {
        if (event.detail && event.detail.snapshot) {
          this.updateData(event.detail.snapshot);
        }
      };
      window.addEventListener('telemetry-update', this._telemetryHandler);
    }

    _licenseColor(lic) {
      const colors = {
        'R': 'hsl(0,65%,55%)',
        'D': 'hsl(24,85%,58%)',
        'C': 'hsl(48,80%,58%)',
        'B': 'hsl(130,55%,52%)',
        'A': 'hsl(210,70%,60%)',
        'P': 'hsl(270,60%,58%)'
      };
      return colors[lic] || 'hsla(0,0%,100%,0.5)';
    }

    _licenseLabel(lic) {
      const labels = {
        'R': 'Rookie',
        'D': 'Class D',
        'C': 'Class C',
        'B': 'Class B',
        'A': 'Class A',
        'P': 'Pro'
      };
      return labels[lic] || '—';
    }

    _fmtTime(seconds) {
      if (!seconds || seconds <= 0) return '—';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return (m > 0 ? m + ':' : '') + (m > 0 && s < 10 ? '0' : '') + s.toFixed(2);
    }

    _drawIRChart() {
      if (!this._irChartCtx || !this._irChartCanvas) return;

      const ctx = this._irChartCtx;
      const w = this._irChartCanvas.width;
      const h = this._irChartCanvas.height;

      ctx.clearRect(0, 0, w, h);

      if (this._iratingHistory.length < 2) {
        ctx.fillStyle = 'hsla(0,0%,100%,0.2)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('—', w / 2, h / 2);
        return;
      }

      const vals = this._iratingHistory.slice();
      const mn = Math.min(...vals) - 50;
      const mx = Math.max(...vals) + 50;
      const range = mx - mn || 1;
      const pad = 4;

      // Grid lines
      ctx.strokeStyle = 'hsla(0,0%,100%,0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 3; i++) {
        const y = pad + (h - pad * 2) * (i / 3);
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
      }

      // Line chart
      ctx.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        const y = pad + (1 - (vals[i] - mn) / range) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'hsl(260,60%,55%)';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    _drawSRChart() {
      if (!this._srChartCtx || !this._srChartCanvas) return;

      const ctx = this._srChartCtx;
      const w = this._srChartCanvas.width;
      const h = this._srChartCanvas.height;

      ctx.clearRect(0, 0, w, h);

      if (this._srHistory.length < 2) {
        ctx.fillStyle = 'hsla(0,0%,100%,0.2)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('—', w / 2, h / 2);
        return;
      }

      const vals = this._srHistory.slice();
      const pad = 4;

      // License tier lines
      ctx.strokeStyle = 'hsla(0,0%,100%,0.06)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= 4; i++) {
        const y = pad + (1 - i / 4.99) * (h - pad * 2);
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(w - pad, y);
        ctx.stroke();
      }

      // Line chart
      ctx.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        const y = pad + (1 - vals[i] / 4.99) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'hsl(145,60%,50%)';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    render() {
      // Update name and license
      if (this._nameEl) {
        this._nameEl.textContent = this._driverName || 'Driver';
      }
      if (this._licenseEl) {
        this._licenseEl.textContent = this._licenseClass ? this._licenseLabel(this._licenseClass) : '—';
        this._licenseEl.style.color = this._licenseColor(this._licenseClass);
      }

      // Update ratings
      if (this._iratingEl) {
        this._iratingEl.textContent = this._irating > 0 ? Math.round(this._irating).toLocaleString() : '—';
      }
      if (this._srEl) {
        this._srEl.textContent = this._safetyRating > 0 ? this._safetyRating.toFixed(2) : '—';
      }

      // Update stats
      const lapsEl = this.shadowRoot?.querySelector('#dpLaps');
      const incidentsEl = this.shadowRoot?.querySelector('#dpIncidents');
      const bestLapEl = this.shadowRoot?.querySelector('#dpBestLap');

      if (lapsEl) lapsEl.textContent = String(this._stats.lapsCompleted);
      if (incidentsEl) incidentsEl.textContent = String(this._stats.incidents);
      if (bestLapEl) bestLapEl.textContent = this._fmtTime(this._stats.bestLap);

      // Draw charts
      this._drawIRChart();
      this._drawSRChart();
    }
  }

  customElements.define('racecor-driver-profile', RaceCorDriverProfile);
})();
