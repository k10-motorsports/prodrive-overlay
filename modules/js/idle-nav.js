// ═══════════════════════════════════════════════════════════════
// IDLE NAVIGATION BAR
// Horizontal action-button strip extending left from the idle logo.
// Visible only in idle state (driver not in car). Logo click toggles
// the bar open/closed. Buttons fire IPC or toggle settings.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var _navBar = null;
  var _idleLogo = null;
  var _expanded = false;

  document.addEventListener('DOMContentLoaded', function () {
    _idleLogo = document.getElementById('idleLogo');
    _navBar = document.getElementById('idleNavBar');
    if (!_idleLogo || !_navBar) return;

    // Logo click toggles the nav bar
    _idleLogo.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_expanded) {
        collapse();
      } else {
        expand();
      }
    });

    // Button click handler (delegated)
    _navBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.idle-nav-button');
      if (!btn) return;
      e.stopPropagation();
      var action = btn.dataset.action;
      handleNavClick(action);
    });

    // Click outside to close
    document.addEventListener('click', function (e) {
      if (!_expanded) return;
      var isNavClick = e.target.closest('.idle-logo, .idle-nav-bar');
      if (!isNavClick) {
        collapse();
      }
    });

    // Collapse when leaving idle state
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'class') {
          var isIdle = document.body.classList.contains('idle-state');
          if (!isIdle && _expanded) {
            collapse();
          }
        }
      });
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  });

  function expand() {
    if (!_navBar || !_idleLogo) return;
    _expanded = true;
    _navBar.classList.add('nav-expanded');
    _idleLogo.classList.add('nav-active');
  }

  function collapse() {
    if (!_navBar || !_idleLogo) return;
    _expanded = false;
    _navBar.classList.remove('nav-expanded');
    _idleLogo.classList.remove('nav-active');
  }

  function handleNavClick(action) {
    // Disable all nav buttons during IPC call to prevent double-clicks
    var buttons = document.querySelectorAll('.idle-nav-button');
    buttons.forEach(function (btn) {
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.5';
    });

    // Collapse nav bar after clicking (settings stays open)
    if (action !== 'settings') {
      collapse();
    }

    function enableButtons() {
      buttons.forEach(function (btn) {
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
      });
    }

    switch (action) {
      case 'settings':
        // Toggle settings via existing flow — request interactive mode
        if (window.k10 && window.k10.requestInteractive) {
          window.k10.requestInteractive();
        }
        if (typeof window.toggleSettings === 'function') {
          window.toggleSettings();
        }
        collapse();
        enableButtons();
        break;

      case 'webapp':
        if (window.k10 && window.k10.openDashboard) {
          window.k10.openDashboard();
          enableButtons();
        }
        break;

      case 'moza':
        if (window.k10 && window.k10.openMozaManager) {
          window.k10.openMozaManager();
          enableButtons();
        }
        break;

      default:
        console.warn('[IdleNav] Unknown action:', action);
        enableButtons();
    }
  }

  // Public API for other modules
  window.collapseIdleNav = collapse;
  window.expandIdleNav = expand;
})();
