/**
 * @element racecor-fuel-gauge
 * @description Fuel level display with consumption rate and pit window estimate.
 *
 * Shows current fuel level, consumption per lap, and estimated laps remaining.
 * Includes color-coded fuel bar (green → yellow → red) based on fuel quantity.
 *
 * @property {number} fuelLevel - Current fuel (0-100%)
 * @property {number} fuelPerLap - Fuel consumption per lap
 * @property {number} fuelLapsRemaining - Estimated laps with current fuel
 * @description Fuel level display with remaining liters, consumption rate, and pit window estimate.
 *
 * Accepts telemetry data via `updateData(snapshot)` method, called from poll-engine
 * or subscribed to `telemetry-update` custom events. Renders using Shadow DOM for
 * scoped styles while inheriting theme variables from :root.
 *
 * @attribute none (uses properties instead)
 *
 * @property {number} fuelLevel - Current fuel in liters (default: 0)
 * @property {number} maxFuel - Max tank capacity in liters (default: 0)
 * @property {number} fuelPerLap - Consumption rate in L/lap (default: 0)
 * @property {number} lapsRemaining - Estimated laps until empty (default: 0)
 *
 * @fires none (no custom events)
 *
 * @slot default (not used, Shadow DOM only)
 *
 * @example
 * <racecor-fuel-gauge></racecor-fuel-gauge>
 *
 * <script>
 *   const gauge = document.querySelector('racecor-fuel-gauge');
 *
 *   // Option 1: Subscribe to telemetry events
 *   window.addEventListener('telemetry-update', (e) => {
 *     gauge.updateData(e.detail);  // detail is the snapshot object
 *   });
 *
 *   // Option 2: Direct data update (used by poll-engine)
 *   gauge.updateData(latestSnapshot);
 * </script>
 */

(function() {
  'use strict';

  class RaceCorFuelGauge extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this._fuelLevel = 0;
      this._fuelPerLap = 0;
      this._fuelLapsRemaining = 0;

      this._fuelBarEl = null;
      this._levelEl = null;
      this._perLapEl = null;
      this._lapsEl = null;

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

    get fuelLevel() { return this._fuelLevel; }
    set fuelLevel(val) { this._fuelLevel = Math.max(0, Math.min(100, +val || 0)); }

    get fuelPerLap() { return this._fuelPerLap; }
    set fuelPerLap(val) { this._fuelPerLap = +val || 0; }

    get fuelLapsRemaining() { return this._fuelLapsRemaining; }
    set fuelLapsRemaining(val) { this._fuelLapsRemaining = +val || 0; }

    updateData(snapshot) {
      if (!snapshot) return;

      const pre = 'K10Motorsports.Plugin.DS.';
      this._fuelLevel = +snapshot[pre + 'FuelPct'] || 0;
      this._fuelPerLap = +snapshot[pre + 'FuelPerLapFormatted'] || 0;
      this._fuelLapsRemaining = +snapshot[pre + 'FuelLapsRemaining'] || 0;

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
          }

          .fg-panel {
            display: flex;
            flex-direction: column;
            gap: var(--gap);
            padding: var(--pad);
          }

          .fg-bar-wrapper {
            position: relative;
            height: 20px;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
            overflow: hidden;
          }

          .fg-bar {
            height: 100%;
            background: linear-gradient(to right, var(--green), var(--amber), var(--red));
            transition: width 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-right: 4px;
            font-size: 11px;
            font-weight: var(--fw-bold);
            color: var(--bg);
          }

          .fg-readout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--gap);
          }

          .fg-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 6px;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: var(--corner-r);
          }

          .fg-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .fg-value {
            font-size: var(--fs-sm);
            font-family: var(--ff-mono);
            font-weight: var(--fw-semi);
            color: var(--text-primary);
          }
        </style>

        <div class="fg-panel">
          <div class="fg-bar-wrapper">
            <div class="fg-bar" id="fgBar" style="width: 50%;"></div>
          </div>

          <div class="fg-readout">
            <div class="fg-item">
              <div class="fg-label">Current</div>
              <div class="fg-value" id="fgLevel">—</div>
            </div>
            <div class="fg-item">
              <div class="fg-label">Per Lap</div>
              <div class="fg-value" id="fgPerLap">—</div>
            </div>
            <div class="fg-item">
              <div class="fg-label">Laps Left</div>
              <div class="fg-value" id="fgLaps">—</div>
            </div>
            <div class="fg-item">
              <div class="fg-label">Status</div>
              <div class="fg-value" id="fgStatus">Good</div>
            </div>
          </div>
        </div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    _cacheElements() {
      if (!this.shadowRoot) return;
      this._fuelBarEl = this.shadowRoot.querySelector('#fgBar');
      this._levelEl = this.shadowRoot.querySelector('#fgLevel');
      this._perLapEl = this.shadowRoot.querySelector('#fgPerLap');
      this._lapsEl = this.shadowRoot.querySelector('#fgLaps');
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

    render() {
      if (this._fuelBarEl) {
        this._fuelBarEl.style.width = Math.min(100, this._fuelLevel) + '%';
        this._fuelBarEl.textContent = Math.round(this._fuelLevel) + '%';
      }

      if (this._levelEl) this._levelEl.textContent = Math.round(this._fuelLevel) + '%';
      if (this._perLapEl) this._perLapEl.textContent = this._fuelPerLap > 0 ? this._fuelPerLap.toFixed(1) + 'L' : '—';
      if (this._lapsEl) {
        this._lapsEl.textContent = this._fuelLapsRemaining > 0 && this._fuelLapsRemaining < 99
          ? this._fuelLapsRemaining.toFixed(1)
          : '—';
      }
    }
  }

  customElements.define('racecor-fuel-gauge', RaceCorFuelGauge);
})();
