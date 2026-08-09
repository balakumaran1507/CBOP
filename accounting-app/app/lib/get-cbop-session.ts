// Server-only session fetch. The accounting app runs NO betterAuth() instance
// of its own - it is a pure session consumer, not an auth provider. It trusts
// the cbop_session cookie (shared via crossSubDomainCookies, see the main
// repo's api/lib/auth.ts) and asks the main CBOP API who owns it, exactly as
// documented in docs/modules/ACCOUNTING_Build_Plan.md's SSO architecture R&D.
//
// Why a network call instead of verifying the cookie/JWT locally: better-auth's
// session cookie is an opaque token by default, not a self-contained JWT -
// local verification would mean turning on and duplicating the JWT plugin's
// logic (role resolution, the `creator` all-company expansion, is_active
// checks) that /api/session already does correctly. Both apps live on the
// same homeserver LAN, so the extra hop costs nothing and keeps one source of
// truth for identity/role/company-scope.

// Container-to-container in production (same docker network as cbop-app),
// localhost in local dev. Never a public hostname for server-to-server calls -
// that would depend on DNS/NPM being up for an otherwise-internal request.
const CBOP_API_URL = process.env.CBOP_API_URL || 'http://localhost:3003'

export interface CbopCompany {
  id: string
  name: string
  invoice_prefix: string
}

export interface CbopNavGroup {
  id: string
  label: string
  items: { key: string; label: string; href: string; icon: string }[]
}

export interface CbopSession {
  userId: string
  name: string
  email: string
  role: string
  telegramChatId: string | null
  companyIds: string[]
  companies: CbopCompany[]
  activeCompanyId: string | null
  enabledModules: string[]
  allowedModules: string[]
  nav: CbopNavGroup[]
}

/**
 * Fetch the caller's CBOP session by forwarding their Cookie header to the
 * main API's GET /api/session. Returns null on any failure (no session,
 * network error, main API down) - callers decide what "no session" means for
 * their route (redirect to landing, 401, etc.), this function never throws.
 */
export async function getCbopSession(cookieHeader: string | null | undefined): Promise<CbopSession | null> {
  if (!cookieHeader) return null
  try {
    const res = await fetch(`${CBOP_API_URL}/api/session`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as CbopSession
  } catch (err) {
    console.error('[accounting-app] getCbopSession failed:', err)
    return null
  }
}

/** Convenience check used by the (app) layout - not a security boundary on its own. */
export function hasAccountingAccess(session: CbopSession | null): boolean {
  if (!session) return false
  if (session.role === 'creator') return true
  return session.allowedModules.includes('accounting') && session.enabledModules.includes('accounting')
}
