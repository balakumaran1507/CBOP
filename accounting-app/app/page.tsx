import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCbopSession } from './lib/get-cbop-session'

// Same-registrable-domain deployment (accounting.etherence.com is a
// sibling of cbop.etherence.com, both under etherence.com), so this is a
// plain redirect - no OAuth-style token exchange needed. See
// docs/modules/ACCOUNTING_Build_Plan.md's SSO section. Renamed 2026-08-07
// from accounting.cbop.etherence.com (Cloudflare free Universal SSL doesn't
// cover a two-label subdomain).
const CBOP_LOGIN_URL   = process.env.NEXT_PUBLIC_CBOP_LOGIN_URL   || 'https://cbop.etherence.com/login'
const SELF_URL         = process.env.NEXT_PUBLIC_ACCOUNTING_URL   || 'https://accounting.etherence.com'

export default async function LandingPage() {
  const cookieStore = cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  // Already logged into CBOP proper (shared cross-subdomain cookie present and
  // valid) - skip the landing page entirely rather than making someone click
  // "Continue" for no reason. A stale/invalid cookie just falls through to the
  // landing page below, same as having none.
  //
  // Checks BOTH `__Secure-cbop_session` and plain `cbop_session` - better-auth
  // silently prefixes the cookie with `__Secure-` under https (every real
  // deployment). Checking only the plain name here was the actual bug behind
  // "Continue with CBOP loops back to itself after a successful login": the
  // cookie was there the whole time, this check just never found it, so
  // getCbopSession() never even ran.
  if (cookieStore.get('__Secure-cbop_session') || cookieStore.get('cbop_session')) {
    const session = await getCbopSession(cookieHeader)
    if (session) redirect('/dashboard')
  }

  const continueUrl = `${CBOP_LOGIN_URL}?redirect=${encodeURIComponent(SELF_URL)}`

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="font-display font-bold text-2xl text-text1 tracking-tight">CBOP Accounting</p>
        <p className="mt-2 text-sm text-text2">
          Statutory-grade books for every company on CBOP.
        </p>

        <a
          href={continueUrl}
          className="mt-8 inline-flex w-full items-center justify-center rounded-md bg-blue px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          Continue with CBOP
        </a>

        <p className="mt-4 text-xs text-text3">
          Signs you in with your existing CBOP account. No separate login.
        </p>
      </div>
    </main>
  )
}
