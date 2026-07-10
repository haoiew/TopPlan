import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: process.env.TOPPLAN_TEST_URL ?? 'http://127.0.0.1:1430',
    trace: 'retain-on-failure',
  },
});
