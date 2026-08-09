import { NextRequest, NextResponse } from 'next/server'

// Fast, presence-only check. Real verification happens server-side in the
// (app) layout via GET /api/session (api/lib/get-cbop-session.ts) - better-auth's
// own guidance is that Edge middleware should not attempt full session
// verification, only gate on the cookie's presence to skip an unnecessary
// render when it's obviously absent. A present-but-invalid/expired cookie
// still falls through to the layout, which redirects properly.
//
// Checks BOTH `__Secure-cbop_session` and plain `cbop_session` - better-auth
// silently prefixes the cookie name with `__Secure-` whenever baseURL is
// https (every real deployment; only plain local http dev gets the
// unprefixed name), same as better-auth's own internal cookie reader does
// (node_modules/better-auth/dist/cookies/index.mjs's getCookie: tries
// `__Secure-${name}` first, falls back to `${name}`). Checking only the
// plain name here silently broke "Continue with CBOP" in production - the
// cookie was always present, this check just never found it.
export function middleware(request: NextRequest) {
  const hasCookie = request.cookies.has('__Secure-cbop_session') || request.cookies.has('cbop_session')
  if (!hasCookie) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  return NextResponse.next()
}

// Only guards routes inside the (app) group - the landing page itself must
// stay reachable without a cookie, that's the whole point of it.
export const config = {
  matcher: ['/dashboard/:path*'],
}
