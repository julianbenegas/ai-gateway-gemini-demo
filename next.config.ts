import type { NextConfig } from 'next'

const config: NextConfig = {
  // Browser tests run their own dev server beside yours; see playwright.config.ts.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Each example is a self-contained route; the root opens the first one.
  async redirects() {
    return [{ source: '/', destination: '/v1', permanent: false }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default config
