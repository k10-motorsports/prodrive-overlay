#!/usr/bin/env node
/**
 * K10 Motorsports — Stream Deck Profile Generator
 *
 * Generates a .streamDeckProfile directory that can be double-clicked
 * to import into the Elgato Stream Deck software.
 *
 * Usage: node generate-profile.js
 * Output: K10 Motorsports.streamDeckProfile/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── UUID generation ──
function uuid() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-').toUpperCase();
}

// ── Action builders ──
function hotkey(title, keyCode, modifiers, iconBase64) {
  return {
    'Name': 'Hotkey',
    'Settings': {
      'HotKeys': [{
        'KeyCmd': false,
        'KeyCtrl': modifiers.includes('ctrl'),
        'KeyModifiers': modifiers.reduce((acc, m) => {
          if (m === 'ctrl') return acc | 2;
          if (m === 'shift') return acc | 1;
          if (m === 'alt') return acc | 4;
          return acc;
        }, 0),
        'KeyOption': false,
        'KeyShift': modifiers.includes('shift'),
        'NativeCode': keyCode,
        'QTKeyCode': 0,
        'VKeyCode': keyCode,
      }],
    },
    'State': 0,
    'States': [{
      'FFamily': '',
      'FSize': '10',
      'FStyle': '',
      'FUnderline': 'off',
      'Image': iconBase64 || '',
      'ShowTitle': true,
      'Title': title,
      'TitleAlignment': 'bottom',
      'TitleColor': '#ffffff',
      'TitleShow': '',
    }],
    'UUID': 'com.elgato.streamdeck.system.hotkey',
  };
}

// Windows virtual key codes
const VK = {
  S: 0x53, H: 0x48, R: 0x52, G: 0x47, Q: 0x51,
  D: 0x44, M: 0x4D, I: 0x49, V: 0x56, F: 0x46,
  UP: 0x26, DOWN: 0x28,
};

// ── Read icon SVGs and convert to base64 data URIs ──
function loadIcon(name) {
  const iconPath = path.join(__dirname, 'icons', name + '.svg');
  try {
    const svg = fs.readFileSync(iconPath, 'utf8');
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  } catch (e) {
    return '';
  }
}

// ── Button layout (5 columns x 3 rows for Stream Deck Classic) ──
// Row 0 (top):     Settings | Show/Hide | Drive Mode | Profile  | iRating
// Row 1 (middle):  Zoom +   | Zoom -    | Reset Map  | Demo     | Cycle Rating
// Row 2 (bottom):  Green Scr| Cycle Logo| Leaderboard| Fullscr  | Quit
const buttons = [
  // Row 0
  [
    { title: 'Settings',    key: VK.S, mods: ['ctrl', 'shift'], icon: 'settings' },
    { title: 'Show/Hide',   key: VK.H, mods: ['ctrl', 'shift'], icon: 'show-hide' },
    { title: 'Drive Mode',  key: VK.F, mods: ['ctrl', 'shift'], icon: 'drive-mode' },
    { title: 'Profile',     key: VK.V, mods: ['ctrl', 'shift'], icon: 'profile' },
    { title: 'iRating',     key: VK.I, mods: ['ctrl', 'shift'], icon: 'iracing' },
  ],
  // Row 1
  [
    { title: 'Zoom +',      key: 0xBB, mods: ['ctrl', 'shift'], icon: 'zoom-up' },    // = key (plus)
    { title: 'Zoom -',      key: 0xBD, mods: ['ctrl', 'shift'], icon: 'zoom-down' },  // - key (minus)
    { title: 'Reset Map',   key: VK.M, mods: ['ctrl', 'shift'], icon: 'reset-map' },
    { title: 'Demo',        key: VK.D, mods: ['ctrl', 'shift'], icon: 'demo' },
    { title: 'Cycle Rating',key: VK.R, mods: ['ctrl'],          icon: 'cycle-rating' },
  ],
  // Row 2
  [
    { title: 'Green Screen', key: VK.G, mods: ['ctrl', 'shift'], icon: 'green-screen' },
    { title: 'Cycle Logo',   key: 0x4C, mods: ['ctrl'],          icon: 'cycle-logo' }, // L key
    { title: 'Leaderboard',  key: 0x42, mods: ['ctrl', 'shift'], icon: 'leaderboard' }, // B key
    { title: 'Fullscreen',   key: 0x7A, mods: [],                icon: 'fullscreen' },  // F11
    { title: 'Quit',         key: VK.Q, mods: ['ctrl', 'shift'], icon: 'quit' },
  ],
];

// ── Build the profile ──
const profileUUID = uuid();

const actions = {};
buttons.forEach((row, rowIdx) => {
  row.forEach((btn, colIdx) => {
    const coord = `${colIdx},${rowIdx}`;
    actions[coord] = hotkey(btn.title, btn.key, btn.mods, loadIcon(btn.icon));
  });
});

const manifest = {
  'Controllers': [{
    'Actions': actions,
    'Type': 'Keypad',
  }],
};

const topLevel = {
  'AppIdentifier': '',
  'Device': {
    'Model': 0,
    'UUID': '',
  },
  'Dpi': 2,
  'Name': 'K10 Motorsports',
  'Pages': {
    'Current': profileUUID,
    'Pages': [profileUUID],
  },
  'Version': '2.0',
};

// ── Write the .streamDeckProfile directory ──
const profileDir = path.join(__dirname, 'K10 Motorsports.streamDeckProfile');
const pageDir = path.join(profileDir, profileUUID);

// Clean if exists
if (fs.existsSync(profileDir)) {
  fs.rmSync(profileDir, { recursive: true });
}

fs.mkdirSync(pageDir, { recursive: true });
fs.writeFileSync(path.join(profileDir, 'manifest.json'), JSON.stringify(topLevel, null, 2));
fs.writeFileSync(path.join(pageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('Generated: ' + profileDir);
console.log('');
console.log('To install:');
console.log('  1. Double-click "K10 Motorsports.streamDeckProfile"');
console.log('  2. The Stream Deck software will import it automatically');
console.log('');
console.log('Button layout (5x3 for Stream Deck Classic):');
console.log('');
console.log('  ┌──────────┬──────────┬──────────┬──────────┬──────────┐');
console.log('  │ Settings  │ Show/Hide│Drive Mode│ Profile  │ iRating  │');
console.log('  │ Ctrl+Sh+S │ Ctrl+Sh+H│ Ctrl+Sh+F│ Ctrl+Sh+V│ Ctrl+Sh+I│');
console.log('  ├──────────┼──────────┼──────────┼──────────┼──────────┤');
console.log('  │ Zoom +   │ Zoom -   │Reset Map │  Demo    │Cycle Rate│');
console.log('  │ Ctrl+Sh+=│ Ctrl+Sh+-│ Ctrl+Sh+M│ Ctrl+Sh+D│  Ctrl+R  │');
console.log('  ├──────────┼──────────┼──────────┼──────────┼──────────┤');
console.log('  │Green Scrn│Cycle Logo│Leaderboard│Fullscreen│   Quit   │');
console.log('  │ Ctrl+Sh+G│  Ctrl+L  │ Ctrl+Sh+B│   F11    │ Ctrl+Sh+Q│');
console.log('  └──────────┴──────────┴──────────┴──────────┴──────────┘');
