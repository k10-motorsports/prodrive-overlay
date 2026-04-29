#!/usr/bin/env node
// rcpdv-bundle — combine an existing video + .telemetry.jsonl into a .rcpdv
// bundle that the Pro Drive editor can consume. Useful for retrofitting
// sessions recorded before the bundle pipeline shipped, and for testing
// the editor while the Windows side of the share/transfer flow is in
// progress.
//
// Usage:
//   bin/rcpdv-bundle.js <video> [options]
//   npx rcpdv-bundle <video> [options]
//
// Run with --help for the full option list.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const bundleWriter = require('../modules/js/bundle-writer');

// Resolve the bundled ffmpeg lazily — only used when probing video
// metadata. The CLI still works (with `--no-probe`) on machines that
// don't have ffmpeg-static installed.
let _ffmpegPath;
function getFfmpegPath() {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  try {
    let p = require('ffmpeg-static');
    if (p && p.includes('app.asar')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    _ffmpegPath = p || null;
  } catch (_) {
    _ffmpegPath = null;
  }
  return _ffmpegPath;
}

// ── CLI parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    video: null,
    telemetry: null,
    output: null,
    title: null,
    track: null,
    car: null,
    series: null,
    sessionType: null,
    userId: null,
    skipProbe: false,
    quiet: false,
    help: false,
    deleteIntermediates: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': out.help = true; break;
      case '-q': case '--quiet': out.quiet = true; break;
      case '--no-probe': out.skipProbe = true; break;
      case '--delete-source': out.deleteIntermediates = true; break;
      case '-t': case '--telemetry': out.telemetry = argv[++i]; break;
      case '-o': case '--out': case '--output': out.output = argv[++i]; break;
      case '--title': out.title = argv[++i]; break;
      case '--track': out.track = argv[++i]; break;
      case '--car': out.car = argv[++i]; break;
      case '--series': out.series = argv[++i]; break;
      case '--session-type': out.sessionType = argv[++i]; break;
      case '--user': out.userId = argv[++i]; break;
      default:
        if (a.startsWith('-')) {
          process.stderr.write(`unknown option: ${a}\n`);
          process.exit(2);
        }
        if (!out.video) out.video = a;
        else {
          process.stderr.write(`unexpected positional argument: ${a}\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

function showHelp() {
  process.stdout.write(`rcpdv-bundle — wrap an existing video + telemetry sidecar into a .rcpdv

Usage:
  rcpdv-bundle <video> [options]

Inputs:
  <video>                    .mp4 / .webm / .mov source file
  -t, --telemetry <path>     Sidecar .telemetry.jsonl
                             (default: <video>.telemetry.jsonl alongside the video)
  -o, --out <path>           Output .rcpdv path
                             (default: <video-without-extension>.rcpdv next to the video)

Race metadata (override the sidecar header — empty string blanks a field):
      --title <string>       Display title
      --track <string>       Track name
      --car <string>         Car model
      --series <string>      Series name
      --session-type <type>  practice | qualify | race
      --user <id>            User id (e.g. discord:123)

Options:
      --no-probe             Skip ffmpeg probe; video duration / resolution stay 0
      --delete-source        Remove the source video + sidecar after a successful bundle
  -q, --quiet                Suppress success output (errors still print)
  -h, --help                 Show this help

Exit codes:
  0  Success
  1  Bundle failed (file missing, sidecar malformed, ffmpeg not on PATH, etc.)
  2  Bad CLI arguments

Examples:
  rcpdv-bundle ~/Videos/lemans.mp4
  rcpdv-bundle session.mp4 --track "Spa-Francorchamps GP" --car "BMW M Hybrid V8"
  rcpdv-bundle session.mp4 -t /tmp/session.jsonl -o ~/Documents/RaceCor/sessions/session.rcpdv
`);
}

// ── Pre-flight checks ────────────────────────────────────────

function fail(message, code) {
  process.stderr.write(`rcpdv-bundle: ${message}\n`);
  process.exit(code != null ? code : 1);
}

function defaultSidecarFor(videoPath) {
  return videoPath.replace(/\.(mp4|webm|mov|m4v)$/i, '.telemetry.jsonl');
}

function defaultOutputFor(videoPath) {
  return videoPath.replace(/\.(mp4|webm|mov|m4v)$/i, '') + '.rcpdv';
}

// ── ffmpeg probe ─────────────────────────────────────────────
// We read stderr because `ffmpeg -i` prints stream info there and
// exits non-zero (no output file specified). That's fine — we only
// want the metadata, not a transcode.

function probeVideoViaFfmpeg(videoPath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) return null;
  const result = spawnSync(ffmpeg, ['-i', videoPath, '-hide_banner'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  // ffmpeg always exits 1 here ("At least one output file must be specified")
  // — the metadata we want is in stderr.
  const out = (result.stderr || '') + '\n' + (result.stdout || '');

  const probed = { duration: 0, width: 0, height: 0, frameRate: 0, codec: 'h264' };

  const durMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durMatch) {
    const h = parseInt(durMatch[1], 10);
    const m = parseInt(durMatch[2], 10);
    const s = parseFloat(durMatch[3]);
    probed.duration = h * 3600 + m * 60 + s;
  }

  // Stream line example:
  //   Stream #0:0(eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 5800 kb/s, 60 fps, 60 tbr, ...
  const streamMatch = out.match(/Stream\s*#\d+:\d+(?:\([^)]*\))?:\s*Video:\s*([^\s,]+)[^,]*?,[^,]+?,\s*(\d+)x(\d+)/);
  if (streamMatch) {
    probed.codec = streamMatch[1].toLowerCase();
    probed.width = parseInt(streamMatch[2], 10) || 0;
    probed.height = parseInt(streamMatch[3], 10) || 0;
  }

  const fpsMatch = out.match(/(\d+(?:\.\d+)?)\s*fps/);
  if (fpsMatch) {
    probed.frameRate = parseFloat(fpsMatch[1]);
  }

  return probed;
}

// ── Sidecar header tolerance ─────────────────────────────────
// bundle-writer.js requires the sidecar's first line to be a header
// row (`_type: 'header'`). For older recordings that don't have one,
// synthesize a header into a temp file using CLI args + defaults.

function ensureSidecarHasHeader(sidecarPath, args) {
  const text = fs.readFileSync(sidecarPath, 'utf8');
  const firstNewline = text.indexOf('\n');
  if (firstNewline < 0) {
    fail(`sidecar is empty: ${sidecarPath}`);
  }
  const firstLine = text.slice(0, firstNewline);
  let firstObj;
  try { firstObj = JSON.parse(firstLine); } catch (_) { firstObj = null; }
  if (firstObj && firstObj._type === 'header') {
    return { path: sidecarPath, isTemp: false };
  }

  const synthesized = {
    _type: 'header',
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    car: args.car ?? null,
    track: args.track ?? null,
    gameId: null,
    isDemo: false,
  };
  const tmpPath = path.join(
    require('os').tmpdir(),
    `rcpdv-cli-${Date.now()}.telemetry.jsonl`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(synthesized) + '\n' + text);
  return { path: tmpPath, isTemp: true };
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { showHelp(); process.exit(0); }
  if (!args.video) { showHelp(); process.exit(2); }

  const videoPath = path.resolve(args.video);
  if (!fs.existsSync(videoPath)) fail(`video not found: ${videoPath}`);

  const telemetryRaw = path.resolve(args.telemetry || defaultSidecarFor(videoPath));
  if (!fs.existsSync(telemetryRaw)) {
    fail(`sidecar not found: ${telemetryRaw}\n`
       + `       (try -t <path> if your .telemetry.jsonl lives elsewhere)`);
  }

  const outputPath = path.resolve(args.output || defaultOutputFor(videoPath));

  // Make sure the sidecar has a header line; synthesize one for old recordings.
  const sidecarHandle = ensureSidecarHasHeader(telemetryRaw, args);

  // Probe video metadata so the bundle header carries useful values.
  let probed = null;
  if (!args.skipProbe) {
    probed = probeVideoViaFfmpeg(videoPath);
    if (!probed && !args.quiet) {
      process.stderr.write(`rcpdv-bundle: warning — could not probe video metadata`
                         + ` (ffmpeg not found). Continuing without it.\n`);
    }
  }

  // Build race overrides — only include fields the user actually set.
  const raceOverrides = {};
  if (args.title       != null) raceOverrides.title       = args.title       || null;
  if (args.track       != null) raceOverrides.track       = args.track       || null;
  if (args.car         != null) raceOverrides.car         = args.car         || null;
  if (args.series      != null) raceOverrides.series      = args.series      || null;
  if (args.sessionType != null) raceOverrides.sessionType = args.sessionType || null;

  let result;
  try {
    result = bundleWriter.writeBundle({
      mp4Path: videoPath,
      telemetryPath: sidecarHandle.path,
      outputPath: outputPath,
      appInfo: {
        app: 'rcpdv-bundle-cli',
        version: require('../package.json').version,
        platform: process.platform,
      },
      race: raceOverrides,
      video: probed || undefined,
      userId: args.userId,
    });
  } catch (err) {
    if (sidecarHandle.isTemp) try { fs.unlinkSync(sidecarHandle.path); } catch (_) {}
    fail(err.message || String(err));
  }

  if (sidecarHandle.isTemp) {
    try { fs.unlinkSync(sidecarHandle.path); } catch (_) {}
  }

  if (args.deleteIntermediates) {
    try { fs.unlinkSync(videoPath); } catch (_) {}
    try { fs.unlinkSync(telemetryRaw); } catch (_) {}
  }

  if (!args.quiet) {
    const mb = (result.totalBytes / 1024 / 1024).toFixed(1);
    process.stdout.write(
      `wrote ${result.outputPath}\n` +
      `  bundle  ${result.bundleId}\n` +
      `  size    ${mb} MB\n` +
      `  frames  ${result.frameCount}\n`
    );
  }
}

main();
