import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // 固定 IPv4：Node/undici 解析 localhost 可能优先 ::1，而 Nuxt dev 只监听 IPv4，
    // 会偶发 ECONNREFUSED ::1:3100
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'pnpm dev --port 3100',
    url: 'http://127.0.0.1:3100/health/ready',
    reuseExistingServer: true,
    timeout: 120_000
  }
})
