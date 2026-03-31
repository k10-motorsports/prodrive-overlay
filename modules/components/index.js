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

// Future phase 1 components:
// import './tire-grid.js';
// import './position-card.js';
// import './gap-display.js';
// import './sector-indicator.js';
// import './incidents-panel.js';
// import './race-control-banner.js';
// import './grid-module.js';
// import './race-end-screen.js';
// import './pit-limiter.js';
// import './ambient-light.js';
// import './race-timeline.js';

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

  // Phase 1 entries will be added here as components are imported

  // Phase 2 entries
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
