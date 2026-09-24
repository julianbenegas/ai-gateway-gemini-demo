import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 35000,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    permissions: ['microphone'],
    screenshot: 'only-on-failure',
  },
  webServer: {
    // A dedicated server whose boards live in memory, never in real Redis.
    command:
      'NEXT_DIST_DIR=.next-test MARGIN_STORE=memory pnpm dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
  },
})
