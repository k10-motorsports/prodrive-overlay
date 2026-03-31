/**
 * @element racecor-fuel-gauge
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

      // ── Internal state ──────────────────────────────────────────
      this._fuelLevel = 0;
      this._maxFuel = 0;
      this._fuelPerLap = 0;
      this._lapsRemaining = 0;
      this._prevFuelPct = -1;
      this._isImperial = false;

      // ── Cached element references (set in _render) ──────────────
      this._elFuelRemaining = null;
      this._elBar = null;
      this._elStats = null;
      this._elPitSuggest = null;

      // ── Event handler (for cleanup in disconnectedCallback) ────
      this._telemetryHandler = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ LIFECYCLE HOOKS                                            ║
    // ╚═══════════════════════════════════════════════════════════╝

    connectedCallback() {
      // Initialize Shadow DOM and cache elements
      this._renderTemplate();
      this._cacheElements();

      // Start listening for telemetry updates
      this._subscribeToData();

      // Render initial state
      this.render();
    }

    disconnectedCallback() {
      // Cleanup event listener
      if (this._telemetryHandler && window) {
        window.removeEventListener('telemetry-update', this._telemetryHandler);
        this._telemetryHandler = null;
      }

      // Clear element references
      this._elFuelRemaining = null;
      this._elBar = null;
      this._elStats = null;
      this._elPitSuggest = null;
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PROPERTIES                                                 ║
    // ╚═══════════════════════════════════════════════════════════╝

    get fuelLevel() { return this._fuelLevel; }
    set fuelLevel(val) { this._fuelLevel = parseFloat(val) || 0; }

    get maxFuel() { return this._maxFuel; }
    set maxFuel(val) { this._maxFuel = parseFloat(val) || 1; }

    get fuelPerLap() { return this._fuelPerLap; }
    set fuelPerLap(val) { this._fuelPerLap = parseFloat(val) || 0; }

    get lapsRemaining() { return this._lapsRemaining; }
    set lapsRemaining(val) { this._lapsRemaining = parseFloat(val) || 0; }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ PUBLIC API — updateData()                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    /**
     * Update component with telemetry data from poll-engine snapshot.
     *
     * @param {Object} snapshot - K10 Motorsports telemetry snapshot (full poll data)
     * @param {boolean} [isImperial=false] - Whether to display in gallons (imperial) or liters (metric)
     *
     * @example
     * // From poll-engine.js
     * const fuelComp = document.querySelector('racecor-fuel-gauge');
     * if (fuelComp) {
     *   fuelComp.updateData(p);  // p is _latestSnapshot
     * }
     */
    updateData(snapshot, isImperial = false) {
      if (!snapshot) return;

      this._isImperial = isImperial;

      // Determine data source prefix based on demo mode
      const _demo = snapshot._demo || +(snapshot['K10Motorsports.Plugin.DemoMode'] || 0);
      const dsPre = _demo ? 'K10Motorsports.Plugin.Demo.DS.' : 'K10Motorsports.Plugin.DS.';
      const gameKeyFuel = _demo ? 'K10Motorsports.Plugin.Demo.Fuel' : 'DataCorePlugin.GameData.Fuel';
      const gameKeyMaxFuel = _demo ? 'K10Motorsports.Plugin.Demo.MaxFuel' : 'DataCorePlugin.GameData.MaxFuel';

      // Extract raw values
      const fuelRaw = +(snapshot[gameKeyFuel] || 0);
      const maxFuelRaw = +(snapshot[gameKeyMaxFuel] || 0);
      const fuelPerLapRaw = +(snapshot[dsPre + 'FuelPerLap'] || 0);
      const lapsRemRaw = +(snapshot[dsPre + 'FuelLapsRemaining'] || 0);

      // Convert to imperial if needed
      const fuelConvert = isImperial ? 3.78541 : 1;
      this.fuelLevel = fuelRaw / fuelConvert;
      this.maxFuel = maxFuelRaw / fuelConvert;
      this.fuelPerLap = fuelPerLapRaw / fuelConvert;
      this.lapsRemaining = lapsRemRaw;

      // Trigger render update
      this.render();
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ RENDERING                                                  ║
    // ╚═══════════════════════════════════════════════════════════╝

    /**
     * Render the Shadow DOM template once during connectedCallback.
     * Sets up the scoped stylesheet and HTML structure.
     */
    _renderTemplate() {
      if (!this.shadowRoot) return;

      const template = document.createElement('template');
      template.innerHTML = `
        <style>
          /* ── Component host style ────────────────────────────────── */
          :host {
            display: block;
            background: var(--bg-panel);
            color: var(--text-primary);
            font-family: var(--ff);
            padding: var(--pad);
            border-radius: var(--corner-r);
            border: 1px solid var(--border);
          }

          /* ── Label (FUEL) ───────────────────────────────────────── */
          .fuel-label {
            font-size: var(--fs-xs);
            font-weight: var(--fw-bold);
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.05em;
            margin-bottom: 4px;
          }

          /* ── Fuel remaining amount (45.2 L) ────────────────────── */
          .fuel-remaining {
            font-size: var(--fs-lg);
            font-weight: var(--fw-semi);
            margin-bottom: 6px;
          }

          .unit {
            font-size: var(--fs-sm);
            font-weight: var(--fw-regular);
            color: var(--text-dim);
            margin-left: 2px;
          }

          /* ── Fuel bar (visual gradient) ──────────────────────── */
          .fuel-bar-outer {
            height: 8px;
            background: var(--bg);
            border-radius: 2px;
            overflow: hidden;
            margin-bottom: 6px;
            border: 1px solid var(--border);
          }

          .fuel-bar-inner {
            height: 100%;
            background: linear-gradient(to right, var(--green), var(--amber), var(--red));
            transition: width 0.2s ease;
            border-radius: 1px;
          }

          /* Flash animation when fuel level changes significantly */
          .fuel-bar-inner.flash {
            animation: fuelFlash 0.4s ease-out;
          }

          @keyframes fuelFlash {
            0% {
              box-shadow: inset 0 0 8px var(--green);
            }
            100% {
              box-shadow: none;
            }
          }

          /* ── Fuel stats row (Avg / Est) ────────────────────── */
          .fuel-stats {
            font-size: var(--fs-xs);
            color: var(--text-dim);
            display: flex;
            justify-content: space-between;
            gap: 4px;
            padding: 4px 0;
          }

          .fuel-stats .val {
            color: var(--text-primary);
            font-weight: var(--fw-semi);
          }

          /* ── Pit suggestion (PIT in ~3 laps) ────────────────── */
          .fuel-pit-suggest {
            font-size: var(--fs-xs);
            color: var(--amber);
            font-weight: var(--fw-semi);
            margin-top: 4px;
            display: none;
          }

          .fuel-pit-suggest:not(:empty) {
            display: block;
          }
        </style>

        <!-- Fuel Panel Content -->
        <div class="fuel-label">Fuel</div>
        <div class="fuel-remaining">— <span class="unit">L</span></div>
        <div class="fuel-bar-outer">
          <div class="fuel-bar-inner" style="width: 0%;"></div>
        </div>
        <div class="fuel-stats">
          <span>Avg <span class="val">—</span> L/lap</span>
          <span>Est <span class="val">—</span> laps</span>
        </div>
        <div class="fuel-pit-suggest"></div>
      `;

      this.shadowRoot.appendChild(template.content.cloneNode(true));
    }

    /**
     * Cache element references for fast DOM updates (avoid repeated querySelector).
     */
    _cacheElements() {
      if (!this.shadowRoot) return;

      this._elFuelRemaining = this.shadowRoot.querySelector('.fuel-remaining');
      this._elBar = this.shadowRoot.querySelector('.fuel-bar-inner');
      this._elStats = this.shadowRoot.querySelectorAll('.fuel-stats .val');
      this._elPitSuggest = this.shadowRoot.querySelector('.fuel-pit-suggest');
    }

    /**
     * Update DOM with current state. Called after updateData() or on property changes.
     * Uses cached element references for performance.
     */
    render() {
      // Calculate fuel percentage
      const fuelPct = this._maxFuel > 0 ? (this._fuelLevel / this._maxFuel) * 100 : 0;

      // ─── Update bar width ───────────────────────────────────────
      if (this._elBar) {
        this._elBar.style.width = Math.max(0, Math.min(100, fuelPct)) + '%';

        // Trigger flash animation on significant change (5% swing)
        if (this._prevFuelPct >= 0 && Math.abs(fuelPct - this._prevFuelPct) > 5) {
          this._elBar.classList.remove('flash');
          // Force reflow to retrigger animation
          void this._elBar.offsetHeight;
          this._elBar.classList.add('flash');
        }
        this._prevFuelPct = fuelPct;
      }

      // ─── Update remaining fuel text ──────────────────────────────
      if (this._elFuelRemaining) {
        if (this._fuelLevel > 0) {
          const unit = this._isImperial ? 'gal' : 'L';
          this._elFuelRemaining.innerHTML = this._fuelLevel.toFixed(1) + ` <span class="unit">${unit}</span>`;
        } else {
          const unit = this._isImperial ? 'gal' : 'L';
          this._elFuelRemaining.innerHTML = `— <span class="unit">${unit}</span>`;
        }
      }

      // ─── Update stats (Avg consumption, Est laps) ────────────────
      if (this._elStats && this._elStats.length >= 2) {
        if (this._fuelPerLap > 0) {
          this._elStats[0].textContent = this._fuelPerLap.toFixed(2);
        } else {
          this._elStats[0].textContent = '—';
        }

        if (this._lapsRemaining > 0.1) {
          this._elStats[1].textContent = this._lapsRemaining.toFixed(1);
        } else {
          this._elStats[1].textContent = '—';
        }
      }

      // ─── Pit suggestion ─────────────────────────────────────────
      if (this._elPitSuggest) {
        if (this._lapsRemaining > 0 && this._lapsRemaining < 20) {
          this._elPitSuggest.textContent = `PIT in ~${Math.ceil(this._lapsRemaining)} laps`;
        } else {
          this._elPitSuggest.textContent = '';
        }
      }
    }

    // ╔═══════════════════════════════════════════════════════════╗
    // ║ DATA SUBSCRIPTION                                          ║
    // ╚═══════════════════════════════════════════════════════════╝

    /**
     * Subscribe to telemetry updates from the poll-engine.
     *
     * Poll-engine fires 'telemetry-update' custom event with the latest snapshot.
     * This allows multiple components to react to the same data without direct coupling.
     */
    _subscribeToData() {
      this._telemetryHandler = (e) => {
        if (e && e.detail) {
          this.updateData(e.detail);
        }
      };

      if (window && window.addEventListener) {
        window.addEventListener('telemetry-update', this._telemetryHandler);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // REGISTRATION
  // ══════════════════════════════════════════════════════════════

  // Register the custom element
  if (window && window.customElements) {
    customElements.define('racecor-fuel-gauge', RaceCorFuelGauge);
  }

  // Export for use in module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RaceCorFuelGauge;
  }

})();
