// ═══════════════════════════════════════════════════════════════
// RaceCor Overlay — Stream Deck Plugin
// Bridges Stream Deck button presses → HTTP action API on the
// overlay's built-in LAN server (localhost:9090).
// ═══════════════════════════════════════════════════════════════

/* global WebSocket, XMLHttpRequest */

(function () {
  'use strict';

  // ── Configuration ──
  var DEFAULT_PORT = 9090;

  // ── UUID → action name mapping ──
  // Each action's UUID suffix maps to the HTTP action endpoint name.
  var UUID_TO_ACTION = {
    'com.racecor.overlay.toggle-settings':       'toggle-settings',
    'com.racecor.overlay.toggle-visibility':      'toggle-overlay',
    'com.racecor.overlay.toggle-drive-mode':      'toggle-drive-mode',
    'com.racecor.overlay.toggle-driver-profile':  'toggle-driver-profile',
    'com.racecor.overlay.toggle-rating-editor':   'toggle-rating-editor',
    'com.racecor.overlay.zoom-in':                'zoom-in',
    'com.racecor.overlay.zoom-out':               'zoom-out',
    'com.racecor.overlay.reset-trackmap':         'reset-trackmap',
    'com.racecor.overlay.restart-demo':           'restart-demo',
    'com.racecor.overlay.cycle-rating':           'cycle-rating',
    'com.racecor.overlay.toggle-green-screen':    'toggle-greenscreen',
    'com.racecor.overlay.cycle-car-logo':         'cycle-car-logo',
    'com.racecor.overlay.toggle-leaderboard':     'toggle-leaderboard',
    'com.racecor.overlay.toggle-recording':       'toggle-recording',
    'com.racecor.overlay.save-replay-buffer':     'save-replay-buffer',
    'com.racecor.overlay.pitbox-next-tab':        'pitbox-next-tab',
    'com.racecor.overlay.pitbox-prev-tab':        'pitbox-prev-tab',
    'com.racecor.overlay.dismiss-commentary':     'dismiss-commentary',
    'com.racecor.overlay.preset-broadcast':       'preset-broadcast',
    'com.racecor.overlay.preset-practice':        'preset-practice',
    'com.racecor.overlay.preset-qualifying':      'preset-qualifying',
    'com.racecor.overlay.quit':                   'quit',
  };

  // ── State ──
  var ws = null;
  var pluginUUID = '';
  var registeredContexts = {};   // context → { uuid, settings }
  var overlayPort = DEFAULT_PORT;

  // ── Stream Deck WebSocket connection ──
  function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    pluginUUID = inPluginUUID;

    ws = new WebSocket('ws://127.0.0.1:' + inPort);

    ws.onopen = function () {
      // Register the plugin with Stream Deck
      ws.send(JSON.stringify({
        event: inRegisterEvent,
        uuid: inPluginUUID,
      }));
    };

    ws.onmessage = function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      switch (msg.event) {
        case 'keyUp':
          onKeyUp(msg);
          break;
        case 'willAppear':
          onWillAppear(msg);
          break;
        case 'willDisappear':
          onWillDisappear(msg);
          break;
        case 'didReceiveSettings':
          onDidReceiveSettings(msg);
          break;
      }
    };

    ws.onclose = function () {
      // Attempt reconnect after 5s
      setTimeout(function () {
        connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo);
      }, 5000);
    };
  }

  // ── Event handlers ──

  function onKeyUp(msg) {
    var actionUUID = msg.action;
    var actionName = UUID_TO_ACTION[actionUUID];
    if (!actionName) return;

    // Read per-instance port override if set
    var ctx = registeredContexts[msg.context];
    var port = (ctx && ctx.settings && ctx.settings.port) || overlayPort;

    fireAction(actionName, port, msg.context);
  }

  function onWillAppear(msg) {
    var settings = (msg.payload && msg.payload.settings) || {};
    registeredContexts[msg.context] = {
      uuid: msg.action,
      settings: settings,
    };
  }

  function onWillDisappear(msg) {
    delete registeredContexts[msg.context];
  }

  function onDidReceiveSettings(msg) {
    var settings = (msg.payload && msg.payload.settings) || {};
    if (registeredContexts[msg.context]) {
      registeredContexts[msg.context].settings = settings;
    }
  }

  // ── HTTP action dispatch ──

  function fireAction(actionName, port, context) {
    var url = 'http://127.0.0.1:' + port + '/api/action/' + actionName;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 3000;

    xhr.onload = function () {
      // Flash green briefly on success (show alert on fail)
      if (xhr.status === 200) {
        showOk(context);
      } else {
        showAlert(context);
      }
    };

    xhr.onerror = function () {
      showAlert(context);
    };

    xhr.ontimeout = function () {
      showAlert(context);
    };

    xhr.send();
  }

  // ── Stream Deck feedback ──

  function showOk(context) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      event: 'showOk',
      context: context,
    }));
  }

  function showAlert(context) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      event: 'showAlert',
      context: context,
    }));
  }

  // ── Expose the global connect function that Stream Deck calls ──
  window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

})();
