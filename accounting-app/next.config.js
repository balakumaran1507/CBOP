/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the Dockerfile's `.next/standalone` copy step. NOTE: the main
  // CBOP app's next.config.js does NOT set this despite its own Dockerfile
  // expecting `.next/standalone` to exist - flagged, not fixed here (out of
  // scope for the accounting app), but don't copy that mismatch into this one.
  output: 'standalone',
  images: {
    domains: [],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',         value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
          // HSTS applied by Nginx Proxy Manager for HTTPS - included here for direct access fallback
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
