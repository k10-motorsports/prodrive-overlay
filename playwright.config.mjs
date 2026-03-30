import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 600 },
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  projects: [
    // Primary dashboard (dashboard-build.html — vanilla TypeScript build)
    {
      name: 'dashboard',
      testDir: './tests/build',
      testMatch: /dashboard\.spec\.mjs$/,
    },
    // Vanilla build parity tests (dashboard-build.html vs gold standard)
    {
      name: 'vanilla-parity',
      testDir: './tests/build',
      testMatch: /vanilla-parity\.mjs$/,
    },
    // Non-dashboard tests (Discord OAuth, etc.)
    {
      name: 'unit',
      testDir: './tests/unit',
    },
    // Legacy: original dashboard.html (opt-in, not run by default)
    {
      name: 'original',
      testDir: './tests/original',
      testMatch: /dashboard\.spec\.mjs$/,
    },
  ],
});
