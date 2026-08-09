import { NextRequest, NextResponse } from 'next/server'

// Nonce-based CSP for the HTML dashboard. Internal tool, always dynamic
// (no ISR/static pages to preserve), so a strict per-request nonce costs
// nothing here — unlike a public marketing site.
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  // Report-Only for the initial rollout — a live dev/prod server was already running
  // on :3003 during this change and couldn't be restarted to verify the policy live
  // (per the SOP's own recommended rollout: Report-Only first, then enforce).
  // Once you've confirmed the browser console shows zero CSP violations across the
  // app, rename this header to 'Content-Security-Policy' to start enforcing it.
  response.headers.set('Content-Security-Policy-Report-Only', csp)
  return response
}

export const config = {
  matcher: [
    // Skip static assets, the service worker, and API routes (api/index.ts's
    // secureHeaders() already covers /api/* with its own policy).
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|api).*)',
  ],
}
