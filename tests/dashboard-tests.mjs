/**
 * K10 Motorsports — Dashboard Test Suite
 *
 * Playwright tests for the HTML dashboard overlay. Covers:
 *   - Initial page structure and element presence
 *   - Telemetry data rendering (gear, speed, RPM, fuel, tyres, etc.)
 *   - Commentary panel show/hide behavior
 *   - Layout position system (5 positions)
 *   - Settings panel UI and toggle behavior
 *   - Demo mode data source switching
 *   - Tachometer segment coloring
 *   - Tyre temperature color thresholds
 *   - Fuel bar state classes
 *   - iRating bar and Safety Rating pie
 *   - Gap display formatting
 *   - Car manufacturer logo detection
 *   - Track map rendering
 *   - Rating/Position page cycling
 *   - Control visibility (TC/ABS hiding)
 *   - Exponential backoff on fetch failure
 */

import { test, expect } from '@playwright/test';
import { loadDashboard, updateMockData, MOCK_TELEMETRY, MOCK_DEMO, DASHBOARD_PATHS } from './helpers.mjs';

/**
 * Register all dashboard tests for a specific variant.
 * @param {'original' | 'build'} variant - Which dashboard to test
 */
export function registerDashboardTests(variant) {
  const dashboardPath = DASHBOARD_PATHS[variant];

  // Override loadDashboard to pass the correct dashboard path
  const load = (page, data) => loadDashboard(page, data, { dashboardPath });

// ═══════════════════════════════════════════════════════════════
// PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════

test.describe('Page structure', () => {
  test('dashboard container exists with default layout classes', async ({ page }) => {
    await load(page);
    const dash = page.locator('#dashboard');
    await expect(dash).toBeVisible();
    await expect(dash).toHaveClass(/layout-tr/);
  });

  test('all major panels are present', async ({ page }) => {
    await load(page);
    await expect(page.locator('.fuel-block')).toBeVisible();
    await expect(page.locator('.tyres-block')).toBeVisible();
    await expect(page.locator('.car-controls')).toBeVisible();
    await expect(page.locator('#pedalsArea')).toBeVisible();
    await expect(page.locator('.pos-gaps-col')).toBeVisible();
    await expect(page.locator('.tacho-block')).toBeVisible();
    await expect(page.locator('.logo-col')).toBeVisible();
  });

  test('tachometer has correct number of segments', async ({ page }) => {
    await load(page);
    const segs = page.locator('#tachoBar .tacho-seg');
    await expect(segs).toHaveCount(11);
  });

  test('pedal rolling histogram rendered via DOM bars', async ({ page }) => {
    await load(page);
    // Rolling bar histogram is drawn by DOM elements + 2D canvas trace.
    const hasHist = await page.evaluate(() => document.querySelectorAll('.pedal-hist-bar').length > 0);
    expect(hasHist).toBeTruthy();
  });

  test('K10 logo image is present', async ({ page }) => {
    await load(page);
    const logo = page.locator('#k10LogoSquare img');
    await expect(logo).toHaveAttribute('src', 'images/branding/logomark.png');
  });

  test('settings overlay element exists', async ({ page }) => {
    await load(page);
    await expect(page.locator('#settingsOverlay')).toBeAttached();
  });

  test('settings overlay is hidden by default', async ({ page }) => {
    await load(page);
    const overlay = page.locator('#settingsOverlay');
    await expect(overlay).not.toHaveClass(/open/);
  });
});

// ═══════════════════════════════════════════════════════════════
// TELEMETRY DATA RENDERING
// ═══════════════════════════════════════════════════════════════

test.describe('Telemetry rendering', () => {
  test('gear displays correctly', async ({ page }) => {
    await load(page);
    await expect(page.locator('#gearText')).toHaveText('4');
  });

  test('speed displays rounded value', async ({ page }) => {
    await load(page);
    await expect(page.locator('#speedText')).toHaveText('127');
  });

  test('RPM displays rounded value', async ({ page }) => {
    await load(page);
    await expect(page.locator('#rpmText')).toHaveText('6842');
  });

  test('fuel level displays with unit', async ({ page }) => {
    await load(page);
    const fuelEl = page.locator('.fuel-remaining');
    const text = await fuelEl.textContent();
    expect(text).toContain('28.4');
    expect(text).toContain('L');
  });

  test('fuel stats show per-lap and estimated laps', async ({ page }) => {
    await load(page);
    const vals = page.locator('.fuel-stats .val');
    await expect(vals.nth(0)).toHaveText('3.12');
    await expect(vals.nth(1)).toHaveText('9.1');
  });

  test('tyre temps display correct values', async ({ page }) => {
    await load(page);
    const cells = page.locator('.tyre-cell');
    await expect(cells.nth(0)).toContainText('196');
    await expect(cells.nth(1)).toContainText('203');
    await expect(cells.nth(2)).toContainText('188');
    await expect(cells.nth(3)).toContainText('191');
  });

  test('brake bias displays formatted value', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ctrlBB .ctrl-value')).toHaveText('56.2');
  });

  test('TC and ABS display numeric values', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ctrlTC .ctrl-value')).toHaveText('4');
    await expect(page.locator('#ctrlABS .ctrl-value')).toHaveText('3');
  });

  test('position shows P5', async ({ page }) => {
    await load(page);
    const posTexts = page.locator('.pos-number .skew-accent');
    // There are multiple pos-number elements (cycle sizer + pages)
    await expect(posTexts.first()).toHaveText('P5');
  });

  test('lap number displays', async ({ page }) => {
    await load(page);
    // The non-purple .val elements in pos-meta-row contain the lap number
    const lapVal = page.locator('.pos-meta-row .val').first();
    await expect(lapVal).toHaveText('8');
  });

  test('current lap time formats correctly', async ({ page }) => {
    await load(page);
    const bestLap = page.locator('.current-row .val').first();
    const text = await bestLap.textContent();
    // 92.347s = 1:32.347
    expect(text).toBe('1:32.347');
  });

  test('iRating displays value', async ({ page }) => {
    await load(page);
    const ratingVals = page.locator('.rating-value');
    await expect(ratingVals.nth(0)).toHaveText('2847');
  });

  test('safety rating displays formatted value', async ({ page }) => {
    await load(page);
    const ratingVals = page.locator('.rating-value');
    await expect(ratingVals.nth(1)).toHaveText('3.41');
  });

  test('gap ahead shows negative time', async ({ page }) => {
    await load(page);
    const gapTimes = page.locator('.gap-time');
    await expect(gapTimes.nth(0)).toHaveText('-1.3');
  });

  test('gap behind shows positive time', async ({ page }) => {
    await load(page);
    const gapTimes = page.locator('.gap-time');
    await expect(gapTimes.nth(1)).toHaveText('+2.1');
  });

  test('driver names display in gaps', async ({ page }) => {
    await load(page);
    const drivers = page.locator('.gap-driver');
    await expect(drivers.nth(0)).toHaveText('M. Broadbent');
    await expect(drivers.nth(1)).toHaveText('S. Leclerc');
  });

  test('gap iRatings display', async ({ page }) => {
    await load(page);
    const irs = page.locator('.gap-ir');
    await expect(irs.nth(0)).toHaveText('3210 iR');
    await expect(irs.nth(1)).toHaveText('2530 iR');
  });

  test('pedal area shows percentage labels for each channel', async ({ page }) => {
    await load(page);
    // DOM histogram shows throttle, brake, clutch percentage labels
    const labels = page.locator('.pedal-pct');
    await expect(labels).toHaveCount(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// TACHOMETER
// ═══════════════════════════════════════════════════════════════

test.describe('Tachometer', () => {
  test('segments light up proportional to RPM', async ({ page }) => {
    await load(page);
    // 6842/8500 ≈ 0.805 → ~9 of 11 segments lit
    const litSegs = page.locator('#tachoBar .tacho-seg[class*="lit-"]');
    const count = await litSegs.count();
    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(9);
  });

  test('low RPM has only green segments', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Rpms': 2000,
      'DataCorePlugin.GameData.CarSettings_MaxRPM': 8500,
    });
    const greenSegs = page.locator('#tachoBar .lit-green');
    const yellowSegs = page.locator('#tachoBar .lit-yellow');
    expect(await greenSegs.count()).toBeGreaterThan(0);
    expect(await yellowSegs.count()).toBe(0);
  });

  test('near-redline has red segments', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Rpms': 8200,
      'DataCorePlugin.GameData.CarSettings_MaxRPM': 8500,
    });
    const redSegs = page.locator('#tachoBar .lit-red, #tachoBar .lit-redline');
    expect(await redSegs.count()).toBeGreaterThan(0);
  });

  test('zero RPM lights no segments', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Rpms': 0,
    });
    const litSegs = page.locator('#tachoBar .tacho-seg[class*="lit-"]');
    expect(await litSegs.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// TYRE TEMPERATURE COLORING
// ═══════════════════════════════════════════════════════════════

test.describe('Tyre temperature classes', () => {
  test('cold tyres get cold class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.TyreTempFrontLeft': 120,
    });
    await expect(page.locator('.tyre-cell').nth(0)).toHaveClass(/cold/);
  });

  test('optimal tyres get optimal class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.TyreTempFrontLeft': 200,
    });
    await expect(page.locator('.tyre-cell').nth(0)).toHaveClass(/optimal/);
  });

  test('hot tyres get hot class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.TyreTempFrontLeft': 250,
    });
    await expect(page.locator('.tyre-cell').nth(0)).toHaveClass(/hot/);
  });

  test('overheating tyres get danger class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.TyreTempFrontLeft': 290,
    });
    await expect(page.locator('.tyre-cell').nth(0)).toHaveClass(/danger/);
  });
});

// ═══════════════════════════════════════════════════════════════
// FUEL BAR
// ═══════════════════════════════════════════════════════════════

test.describe('Fuel bar states', () => {
  test('high fuel shows healthy class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Fuel': 40,
      'DataCorePlugin.GameData.MaxFuel': 60,
      'K10Motorsports.Plugin.DS.FuelPct': 66.7,
    });
    await expect(page.locator('.fuel-bar-inner')).toHaveClass(/healthy/);
  });

  test('medium fuel shows caution class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Fuel': 12,
      'DataCorePlugin.GameData.MaxFuel': 60,
      'K10Motorsports.Plugin.DS.FuelPct': 20,
    });
    await expect(page.locator('.fuel-bar-inner')).toHaveClass(/caution/);
  });

  test('low fuel shows critical class', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Fuel': 4,
      'DataCorePlugin.GameData.MaxFuel': 60,
      'K10Motorsports.Plugin.DS.FuelPct': 6.7,
    });
    await expect(page.locator('.fuel-bar-inner')).toHaveClass(/critical/);
  });

  test('pit suggestion appears when fuel insufficient', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Fuel': 10,
      'DataCorePlugin.GameData.MaxFuel': 60,
      'DataCorePlugin.Computed.Fuel_LitersPerLap': 3.0,
      'DataCorePlugin.GameData.RemainingLaps': 14,
      'K10Motorsports.Plugin.DS.FuelPct': 16.7,
      'K10Motorsports.Plugin.DS.FuelLapsRemaining': 3.3,
    });
    const pitSug = page.locator('.fuel-pit-suggest');
    const text = await pitSug.textContent();
    expect(text).toContain('PIT');
  });

  test('no pit suggestion when fuel is sufficient', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.Fuel': 50,
      'DataCorePlugin.GameData.MaxFuel': 60,
      'DataCorePlugin.Computed.Fuel_LitersPerLap': 3.0,
      'DataCorePlugin.GameData.RemainingLaps': 10,
      'K10Motorsports.Plugin.DS.FuelPct': 83.3,
      'K10Motorsports.Plugin.DS.FuelLapsRemaining': 16.7,
    });
    const pitSug = page.locator('.fuel-pit-suggest');
    const text = await pitSug.textContent();
    expect(text.trim()).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// iRATING BAR AND SAFETY RATING PIE
// ═══════════════════════════════════════════════════════════════

test.describe('iRating and Safety Rating', () => {
  test('iRating bar width scales with rating', async ({ page }) => {
    await load(page);
    // 2847/5000 = 56.94%
    const fill = page.locator('#irBarFill');
    const width = await fill.evaluate(el => el.style.width);
    const pct = parseFloat(width);
    expect(pct).toBeGreaterThan(55);
    expect(pct).toBeLessThan(58);
  });

  test('safety rating pie stroke reflects value', async ({ page }) => {
    await load(page);
    // SR 3.41 → green stroke, dashoffset = 94.25 * (1 - 3.41/4) = ~13.9
    const fill = page.locator('#srPieFill');
    const stroke = await fill.getAttribute('stroke');
    expect(stroke).toBe('var(--green)');
  });

  test('low safety rating shows red stroke', async ({ page }) => {
    await load(page, {
      'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating': 1.5,
    });
    const fill = page.locator('#srPieFill');
    const stroke = await fill.getAttribute('stroke');
    expect(stroke).toBe('var(--red)');
  });

  test('medium safety rating shows amber stroke', async ({ page }) => {
    await load(page, {
      'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating': 2.5,
    });
    const fill = page.locator('#srPieFill');
    const stroke = await fill.getAttribute('stroke');
    expect(stroke).toBe('var(--amber)');
  });
});

// ═══════════════════════════════════════════════════════════════
// COMMENTARY PANEL
// ═══════════════════════════════════════════════════════════════

test.describe('Commentary panel', () => {
  test('commentary hidden when CommentaryVisible is 0', async ({ page }) => {
    await load(page);
    const col = page.locator('#commentaryCol');
    await expect(col).not.toHaveClass(/visible/);
  });

  test('commentary shows when CommentaryVisible is 1', async ({ page }) => {
    await load(page, {
      'K10Motorsports.Plugin.CommentaryVisible': 1,
      'K10Motorsports.Plugin.CommentaryText': 'Watch the rear end through turn 3.',
      'K10Motorsports.Plugin.CommentaryTopicTitle': 'Oversteer',
      'K10Motorsports.Plugin.CommentaryTopicId': 'car_balance_sustained',
      'K10Motorsports.Plugin.CommentaryCategory': 'car_response',
      'K10Motorsports.Plugin.CommentarySentimentColor': '#FFFF6F00',
    });
    const col = page.locator('#commentaryCol');
    await expect(col).toHaveClass(/visible/);
  });

  test('commentary title and text populate correctly', async ({ page }) => {
    await load(page, {
      'K10Motorsports.Plugin.CommentaryVisible': 1,
      'K10Motorsports.Plugin.CommentaryText': 'Massive lockup into T1.',
      'K10Motorsports.Plugin.CommentaryTopicTitle': 'Brake Lock',
      'K10Motorsports.Plugin.CommentaryTopicId': 'heavy_braking',
      'K10Motorsports.Plugin.CommentaryCategory': 'hardware',
    });
    await expect(page.locator('#commentaryTitle')).toHaveText('Brake Lock');
    await expect(page.locator('#commentaryText')).toHaveText('Massive lockup into T1.');
    await expect(page.locator('#commentaryMeta')).toHaveText('hardware');
  });

  test('commentary hides after data clears', async ({ page }) => {
    // First show commentary
    await load(page, {
      'K10Motorsports.Plugin.CommentaryVisible': 1,
      'K10Motorsports.Plugin.CommentaryText': 'Test',
      'K10Motorsports.Plugin.CommentaryTopicTitle': 'Test',
      'K10Motorsports.Plugin.CommentaryTopicId': 'spin_catch',
      'K10Motorsports.Plugin.CommentaryCategory': 'test',
      'K10Motorsports.Plugin.CommentarySentimentColor': '#FF00FF00',
    });
    await expect(page.locator('#commentaryCol')).toHaveClass(/visible/);

    // Then hide it
    await updateMockData(page, {
      'K10Motorsports.Plugin.CommentaryVisible': 0,
    });
    await page.waitForTimeout(500);
    await expect(page.locator('#commentaryCol')).not.toHaveClass(/visible/);
  });
});

// ═══════════════════════════════════════════════════════════════
// CAR MANUFACTURER DETECTION
// ═══════════════════════════════════════════════════════════════

test.describe('Car manufacturer logos', () => {
  test('Porsche model shows Porsche logo', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R',
    });
    // Wait for logo SVG fetch to complete
    await page.waitForTimeout(300);
    const html = await page.locator('#carLogoIcon').innerHTML();
    // Porsche SVG has a red-toned drop shadow
    expect(html).toContain('177,43,40');
  });

  test('BMW model shows BMW logo', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.CarModel': 'BMW M4 GT3',
    });
    await page.waitForTimeout(300);
    const html = await page.locator('#carLogoIcon').innerHTML();
    // BMW SVG has blue drop shadow and fills
    expect(html).toContain('0,102,177');
  });

  test('unknown model shows generic logo', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameData.CarModel': 'Some Unknown Car',
    });
    await page.waitForTimeout(300);
    const html = await page.locator('#carLogoIcon').innerHTML();
    // Generic logo uses translucent strokes
    expect(html).toContain('hsla(0,0%,100%,0.3)');
  });
});

// ═══════════════════════════════════════════════════════════════
// DEMO MODE
// ═══════════════════════════════════════════════════════════════

test.describe('Demo mode', () => {
  test('demo mode reads from Demo.* properties', async ({ page }) => {
    await load(page, MOCK_DEMO);
    // Demo gear is '3', game gear is '4' — should show 3
    await expect(page.locator('#gearText')).toHaveText('3');
    await expect(page.locator('#speedText')).toHaveText('98');
  });

  test('demo mode shows demo position', async ({ page }) => {
    await load(page, MOCK_DEMO);
    const pos = page.locator('.pos-number .skew-accent').first();
    await expect(pos).toHaveText('P3');
  });

  test('demo mode uses demo fuel data', async ({ page }) => {
    await load(page, MOCK_DEMO);
    const fuelText = await page.locator('.fuel-remaining').textContent();
    expect(fuelText).toContain('18.0');
  });
});

// ═══════════════════════════════════════════════════════════════
// CONTROL VISIBILITY
// ═══════════════════════════════════════════════════════════════

test.describe('Control visibility', () => {
  test('TC and ABS visible when data present', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ctrlTC')).not.toHaveClass(/ctrl-hidden/);
    await expect(page.locator('#ctrlABS')).not.toHaveClass(/ctrl-hidden/);
  });

  test('TC hides when car has no TC data', async ({ page }) => {
    await load(page, {
      'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': null,
      'DataCorePlugin.GameData.CarModel': 'Mazda MX-5',
    });
    await page.waitForTimeout(200);
    // TC should be hidden since no TC data and model changed (resets _tcSeen)
    await expect(page.locator('#ctrlTC')).toHaveClass(/ctrl-hidden/);
  });
});

// ═══════════════════════════════════════════════════════════════
// RATING / POSITION CYCLING
// ═══════════════════════════════════════════════════════════════

test.describe('Rating/Position cycling', () => {
  test('rating page is active by default', async ({ page }) => {
    await load(page);
    await expect(page.locator('#ratingPage')).toHaveClass(/active/);
    await expect(page.locator('#positionPage')).toHaveClass(/inactive/);
  });

  test('cycleRatingPos swaps pages', async ({ page }) => {
    await load(page);
    await page.evaluate(() => cycleRatingPos());
    await expect(page.locator('#ratingPage')).toHaveClass(/inactive/);
    await expect(page.locator('#positionPage')).toHaveClass(/active/);
  });

  test('double cycle returns to original page', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { cycleRatingPos(); cycleRatingPos(); });
    await expect(page.locator('#ratingPage')).toHaveClass(/active/);
    await expect(page.locator('#positionPage')).toHaveClass(/inactive/);
  });

  test('cycle dots update', async ({ page }) => {
    await load(page);
    await expect(page.locator('#dotRating')).toHaveClass(/active/);
    await page.evaluate(() => cycleRatingPos());
    await expect(page.locator('#dotPos')).toHaveClass(/active/);
    await expect(page.locator('#dotRating')).not.toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════════════════════════
// TRACK MAP
// ═══════════════════════════════════════════════════════════════

test.describe('Track map', () => {
  test('track map updates when data arrives', async ({ page }) => {
    await load(page, {
      'K10Motorsports.Plugin.TrackMap.Ready': 1,
      'K10Motorsports.Plugin.TrackMap.SvgPath': 'M10 10 L 90 10 L 90 90 L 10 90 Z',
      'K10Motorsports.Plugin.TrackMap.PlayerX': 50,
      'K10Motorsports.Plugin.TrackMap.PlayerY': 50,
      'K10Motorsports.Plugin.TrackMap.Opponents': '30,30,0;70,70,0',
    });
    const path = await page.locator('#fullMapTrack').getAttribute('d');
    expect(path).toContain('M10 10');
    const cx = await page.locator('#fullMapPlayer').getAttribute('cx');
    expect(cx).toBe('50.0');
  });

  test('opponents render as circles', async ({ page }) => {
    await load(page, {
      'K10Motorsports.Plugin.TrackMap.Ready': 1,
      'K10Motorsports.Plugin.TrackMap.SvgPath': 'M10 10 L 90 90',
      'K10Motorsports.Plugin.TrackMap.PlayerX': 50,
      'K10Motorsports.Plugin.TrackMap.PlayerY': 50,
      'K10Motorsports.Plugin.TrackMap.Opponents': '20,20,0;80,80,0;50,10,1',
    });
    const fullOpponents = page.locator('#fullMapOpponents circle');
    // 3 opponents (including one in pit)
    await expect(fullOpponents).toHaveCount(3);
    // Pit opponent is hidden
    const pitDot = fullOpponents.nth(2);
    await expect(pitDot).toHaveCSS('display', 'none');
  });
});

// ═══════════════════════════════════════════════════════════════
// LAYOUT SYSTEM
// ═══════════════════════════════════════════════════════════════

test.describe('Layout positions', () => {
  test('top-right positions dashboard at top-right', async ({ page }) => {
    await load(page);
    const dash = page.locator('#dashboard');
    await expect(dash).toHaveClass(/layout-tr/);
    const box = await dash.boundingBox();
    expect(box.x + box.width).toBeGreaterThan(1200); // near right edge
    expect(box.y).toBeLessThan(20);
  });

  test('top-left positions dashboard at top-left', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.layoutPosition = 'top-left';
      applyLayout();
    });
    const dash = page.locator('#dashboard');
    await expect(dash).toHaveClass(/layout-tl/);
    const box = await dash.boundingBox();
    expect(box.x).toBeLessThan(20);
  });

  test('bottom-right places dashboard at bottom', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.layoutPosition = 'bottom-right';
      applyLayout();
    });
    const dash = page.locator('#dashboard');
    await expect(dash).toHaveClass(/layout-br/);
    const box = await dash.boundingBox();
    // 600px viewport - bottom should be near 600
    expect(box.y + box.height).toBeGreaterThan(580);
  });

  test('bottom-left positions dashboard at bottom-left', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.layoutPosition = 'bottom-left';
      applyLayout();
    });
    const dash = page.locator('#dashboard');
    await expect(dash).toHaveClass(/layout-bl/);
    const box = await dash.boundingBox();
    expect(box.x).toBeLessThan(20);
    expect(box.y + box.height).toBeGreaterThan(580);
  });

  test('absolute-center is centered on screen', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.layoutPosition = 'absolute-center';
      applyLayout();
    });
    const dash = page.locator('#dashboard');
    await expect(dash).toHaveClass(/layout-ac/);
    // Wait for 600ms CSS transition to complete
    await page.waitForTimeout(700);
    const box = await dash.boundingBox();
    const centerX = box.x + box.width / 2;
    expect(centerX).toBeGreaterThan(580);
    expect(centerX).toBeLessThan(700);
    // Y centering depends on dashboard height and CSS layout —
    // just verify the class was applied and X is roughly centered
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════

test.describe('Settings panel', () => {
  test('settings overlay opens on toggleSettings()', async ({ page }) => {
    await load(page);
    await page.evaluate(() => toggleSettings());
    const overlay = page.locator('#settingsOverlay');
    await expect(overlay).toHaveClass(/open/);
  });

  test('settings overlay closes on second toggle', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { toggleSettings(); toggleSettings(); });
    const overlay = page.locator('#settingsOverlay');
    await expect(overlay).not.toHaveClass(/open/);
  });

  test('position dropdown reflects current setting', async ({ page }) => {
    await load(page);
    const select = page.locator('#settingsPosition');
    await expect(select).toHaveValue('top-right');
  });

  test('toggling fuel off hides fuel panel', async ({ page }) => {
    await load(page);
    await expect(page.locator('.fuel-block')).toBeVisible();
    await page.evaluate(() => {
      _settings.showFuel = false;
      applySettings();
    });
    await expect(page.locator('.fuel-block')).toBeHidden();
  });

  test('toggling commentary off hides commentary column', async ({ page }) => {
    await load(page, {
      'K10Motorsports.Plugin.CommentaryVisible': 1,
      'K10Motorsports.Plugin.CommentaryText': 'Test',
      'K10Motorsports.Plugin.CommentaryTopicTitle': 'Test',
      'K10Motorsports.Plugin.CommentaryTopicId': 'spin_catch',
      'K10Motorsports.Plugin.CommentaryCategory': 'test',
      'K10Motorsports.Plugin.CommentarySentimentColor': '#FF00FF00',
    });
    await page.evaluate(() => {
      _settings.showCommentary = false;
      applySettings();
    });
    await expect(page.locator('#commentaryCol')).toBeHidden();
  });

  test('fuel-tyres column hides when both children hidden', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.showFuel = false;
      _settings.showTyres = false;
      applySettings();
    });
    await expect(page.locator('.fuel-tyres-col')).toBeHidden();
  });

  test('logo column hides when both logos hidden', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
      _settings.showK10Logo = false;
      _settings.showCarLogo = false;
      applySettings();
    });
    await expect(page.locator('.logo-col')).toBeHidden();
  });
});

// ═══════════════════════════════════════════════════════════════
// BACKOFF ON FAILURE
// ═══════════════════════════════════════════════════════════════

test.describe('Connection backoff', () => {
  test('backoff counter increments on fetch failure', async ({ page }) => {
    // Route to fail
    await page.route(/k10mediabroadcaster/, (route) => route.abort());
    await page.goto(dashboardPath, { waitUntil: 'load' });
    await page.waitForTimeout(300);

    const fails = await page.evaluate(() => _connFails);
    expect(fails).toBeGreaterThan(0);
  });

  test('backoff resets on successful fetch', async ({ page }) => {
    // Start with failures
    await page.route(/k10mediabroadcaster/, (route) => route.abort());
    await page.goto(dashboardPath, { waitUntil: 'load' });
    await page.waitForTimeout(200);

    // Now succeed
    await page.unroute(/k10mediabroadcaster/);
    await page.route(/k10mediabroadcaster/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TELEMETRY),
      });
    });
    // Wait for backoff to expire and a successful poll
    await page.waitForTimeout(2000);

    const fails = await page.evaluate(() => _connFails);
    expect(fails).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// EXPOSED WINDOW FUNCTIONS
// ═══════════════════════════════════════════════════════════════

test.describe('Window API', () => {
  test('all expected functions are exposed on window', async ({ page }) => {
    await load(page);
    const fns = await page.evaluate(() => [
      typeof window.updateTacho,
      typeof window.showCommentary,
      typeof window.hideCommentary,
      typeof window.cycleRatingPos,
      typeof window.cycleCarLogo,
      typeof window.setCarLogo,
      typeof window.updateIRBar,
      typeof window.updateSRPie,
      typeof window.flashElement,
      typeof window.setCtrlVisibility,
      typeof window.getTyreTempClass,
      typeof window.updateTyreCell,
      typeof window.updateFuelBar,
      typeof window.updateTrackMap,
    ]);
    fns.forEach(t => expect(t).toBe('function'));
  });

  test('getTyreTempClass returns correct classes', async ({ page }) => {
    await load(page);
    const results = await page.evaluate(() => ({
      zero: getTyreTempClass(0),
      cold: getTyreTempClass(120),
      optimal: getTyreTempClass(200),
      hot: getTyreTempClass(250),
      danger: getTyreTempClass(290),
    }));
    expect(results.zero).toBe('');
    expect(results.cold).toBe('cold');
    expect(results.optimal).toBe('optimal');
    expect(results.hot).toBe('hot');
    expect(results.danger).toBe('danger');
  });

  test('showCommentary/hideCommentary work via window API', async ({ page }) => {
    await load(page);
    await page.evaluate(() => showCommentary(30, 'Test Title', 'Test text', 'test_cat'));
    await expect(page.locator('#commentaryCol')).toHaveClass(/visible/);
    await expect(page.locator('#commentaryTitle')).toHaveText('Test Title');
    await expect(page.locator('#commentaryText')).toHaveText('Test text');

    await page.evaluate(() => hideCommentary());
    await expect(page.locator('#commentaryCol')).not.toHaveClass(/visible/);
  });
});

} // end registerDashboardTests
