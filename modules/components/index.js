/**
 * RaceCor Web Components Library
 *
 * Barrel export for all web components used in the overlay and web app.
 * Import this file to auto-register all components.
 *
 * @example
 * // In dashboard.html
 * <script type="module">
 *   import './modules/components/index.js';
 * </script>
 *
 * // Now use components
 * <racecor-fuel-gauge></racecor-fuel-gauge>
 * <racecor-tire-grid></racecor-tire-grid>
 */

// ══════════════════════════════════════════════════════════════
// PHASE 1: SIMPLE DOM COMPONENTS
// ══════════════════════════════════════════════════════════════

// Fuel gauge with consumption stats and pit window estimate
import './fuel-gauge.js';

// Tire temperature and wear grid (2x2 layout)
import './tire-grid.js';

// Gap ahead/behind with driver names and iRatings
import './gap-display.js';

// Position card with cycling rating page
import './position-card.js';

// Race control message banner with animated stripes
import './race-control.js';

// Race end results screen
import './race-end.js';

// Incident counter with penalty/DQ thresholds
import './incidents.js';

// Position history heat-map strip
import './race-timeline.js';

// ══════════════════════════════════════════════════════════════
// PHASE 2: CANVAS & MODERATE COMPONENTS
// ══════════════════════════════════════════════════════════════

// Future phase 2 components:
// import './leaderboard.js';
// import './datastream.js';
// import './pedal-curves.js';
// import './pitbox.js';
// import './spotter.js';
// import './commentary.js';
// import './dashboard.js';
// import './panel-container.js';

// ══════════════════════════════════════════════════════════════
// PHASE 3: COMPLEX & WEBGL COMPONENTS
// ══════════════════════════════════════════════════════════════

// Future phase 3 components:
// import './tachometer.js';
// import './webgl-fx.js';
// import './drive-hud.js';
// import './driver-profile.js';
// import './commentary-viz.js';

// ══════════════════════════════════════════════════════════════
// COMPONENT REGISTRY
// ══════════════════════════════════════════════════════════════

/**
 * Global component registry for runtime discovery and metadata.
 * Used by poll-engine and other systems to know which components are available.
 *
 * @type {Object<string, {componentClass: Function, type: string, phase: number}>}
 */
window._componentRegistry = window._componentRegistry || {
  'racecor-fuel-gauge': {
    componentClass: customElements.get('racecor-fuel-gauge'),
    type: 'dom',
    phase: 1,
    description: 'Fuel level display with consumption and pit window'
  },
  'racecor-tire-grid': {
    componentClass: customElements.get('racecor-tire-grid'),
    type: 'dom',
    phase: 1,
    description: 'Tire temperature and wear 2x2 grid'
  },
  'racecor-gap-display': {
    componentClass: customElements.get('racecor-gap-display'),
    type: 'dom',
    phase: 1,
    description: 'Gap ahead/behind with driver info'
  },
  'racecor-position-card': {
    componentClass: customElements.get('racecor-position-card'),
    type: 'dom',
    phase: 1,
    description: 'Position and rating display with cycling pages'
  },
  'racecor-race-control': {
    componentClass: customElements.get('racecor-race-control'),
    type: 'dom',
    phase: 1,
    description: 'Race control flag banner with animated stripes'
  },
  'racecor-race-end': {
    componentClass: customElements.get('racecor-race-end'),
    type: 'dom',
    phase: 1,
    description: 'Race end results screen'
  },
  'racecor-incidents': {
    componentClass: customElements.get('racecor-incidents'),
    type: 'dom',
    phase: 1,
    description: 'Incident counter with penalty/DQ thresholds'
  },
  'racecor-race-timeline': {
    componentClass: customElements.get('racecor-race-timeline'),
    type: 'canvas',
    phase: 1,
    description: 'Position history heat-map strip'
  },

  // Phase 2 entries will be added here as components are imported
  // 'racecor-leaderboard': { ... },
  // 'racecor-datastream': { ... },

  // Phase 3 entries
  // 'racecor-tachometer': { ... },
};

/**
 * Helper function to log registered components (for debugging).
 * @example window._logComponents()
 */
window._logComponents = function() {
  console.group('[K10] Registered Web Components');
  Object.entries(window._componentRegistry).forEach(([tag, info]) => {
    console.log(`  ${tag} (${info.type}, phase ${info.phase})`);
  });
  console.groupEnd();
};

console.log('[K10 Web Components] Loaded. Call window._logComponents() to see registered components.');
