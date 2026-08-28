import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  forbidOnly: Boolean(process.env['CI']),
  workers: 1,
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
});
