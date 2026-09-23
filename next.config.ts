import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['just-bash'],
  outputFileTracingIncludes: {
    '/api/v2/bash': [
      './scripts/v2-bash-worker.mjs',
      './src/lib/v2/filesystem.mjs',
      './node_modules/just-bash/**/*',
    ],
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
