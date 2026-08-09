import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { auth } from '../lib/auth'
import { query, runWithActorContext } from '../lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest, writeAuthzDenial } from '../lib/audit-log'
import { ALL_MODULE_KEYS, modulesForRole } from '../lib/modules'
import '../lib/hono-vars'

// One audit row per authenticated request would turn audit_logs into an access
// log. Session activity is instead recorded at most once per user per window —
// enough to evidence "this account was in use at this time" at sane volume.
// Auth *failures* and every 403 are never throttled.
const SESSION_LOG_WINDOW_MS = 15 * 60_000
const sessionLastLogged = new Map<string, number>()

function shouldLogSessionActivity(userId: string): boolean {
  const now  = Date.now()
  const last = sessionLastLogged.get(userId)
  if (last && now - last < SESSION_LOG_WINDOW_MS) return false

  // Bounded — prune stale entries rather than grow forever.
  if (sessionLastLogged.size > 500) {
    for (const [key, ts] of sessionLastLogged) {
      if (now - ts > SESSION_LOG_WINDOW_MS) sessionLastLogged.delete(key)
    }
  }
  sessionLastLogged.set(userId, now)
  return true
}

/**
 * Header the frontend sends on every same-origin /api/* call (installed once in
 * app/lib/api-client.ts). Explicit, per-request, and validated below.
 */
export const ACTIVE_COMPANY_HEADER = 'x-active-company-id'

/**
 * Cookie written by the topbar company switcher. Needed because server-rendered
 * page loads cannot set a header on their own document request. Same validation
 * as the header — it is a *hint*, never an authorization input.
 */
export const ACTIVE_COMPANY_COOKIE = 'cbop_active_company_id'

/**
 * Resolve which company this request is scoped to (IF-4).
 *
 * Precedence: explicit header → cookie hint → first company.
 *  - A header naming a company outside the user's scope is a client bug or an
 *    attack: reject the request outright.
 *  - A stale cookie (user removed from a company, cookie left behind) must not
 *    lock the user out of the whole app, so it falls back to the default.
 *
 * Returns a 403 Response when the explicit header is out of scope.
 */
function resolveActiveCompanyId(c: Context, companyIds: string[]): string | null | Response {
  const requested = c.req.header(ACTIVE_COMPANY_HEADER)?.trim()

  if (requested) {
    if (!companyIds.includes(requested)) {
      return c.json({ error: 'Forbidden: active company is not in your scope' }, 403)
    }
    return requested
  }

  const hint = getCookie(c, ACTIVE_COMPANY_COOKIE)?.trim()
  if (hint && companyIds.includes(hint)) return hint

  return companyIds[0] ?? null
}

export async function requireAuth(c: Context, next: Next) {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) {
      void writeAuditLogForRequest(c, {
        action:       AUDIT_ACTIONS.authSessionRejected,
        resourceType: 'route',
        resourceId:   `${c.req.method} ${c.req.path}`,
        after:        { reason: 'no_session' },
      })
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const result = await query(
      `SELECT u.id, u.role, u.company_role_id,
              array_agg(DISTINCT uc.company_id ORDER BY uc.company_id)
                FILTER (WHERE uc.company_id IS NOT NULL) as company_ids
       FROM users u
       LEFT JOIN user_companies uc ON uc.user_id = u.id
       WHERE u.email = $1 AND u.is_active = true
       GROUP BY u.id`,
      [session.user.email]
    )

    if (result.rows.length === 0) {
      // Valid better-auth session but no active CBOP user — a deactivated or
      // deleted account still holding a cookie. Security-relevant, always logged.
      void writeAuditLogForRequest(c, {
        action:       AUDIT_ACTIONS.authSessionRejected,
        resourceType: 'route',
        resourceId:   `${c.req.method} ${c.req.path}`,
        after:        { reason: 'user_missing_or_inactive', email: session.user.email },
      })
      return c.json({ error: 'User not found or inactive' }, 401)
    }

    const user = result.rows[0]
    c.set('userId', user.id)
    c.set('role', user.role)

    // Creator is a super-admin tier - always sees every company, regardless of
    // its own user_companies assignment (which may be empty or partial).
    let companyIds: string[]
    if (user.role === 'creator') {
      const allCompanies = await query(`SELECT id FROM companies ORDER BY name`, [])
      companyIds = allCompanies.rows.map((r: { id: string }) => r.id)
    } else {
      companyIds = user.company_ids || []
    }
    c.set('companyIds', companyIds)

    // Which company is this request for? Explicit, server-validated input -
    // never "whatever array_agg returned first".
    const active = resolveActiveCompanyId(c, companyIds)
    if (active instanceof Response) {
      writeAuthzDenial(c, {
        action:       AUDIT_ACTIONS.authzRouteDenied,
        reason:       'active_company_out_of_scope',
        resourceType: 'company',
        resourceId:   c.req.header(ACTIVE_COMPANY_HEADER)?.trim() ?? null,
        detail:       { scoped_company_ids: companyIds },
      })
      return active
    }
    c.set('activeCompanyId', active)

    // Load enabled modules for the ACTIVE company (company toggle).
    // Creator always gets all modules. If company_modules has no rows yet
    // (pre-migration or new company) we fall back to all modules enabled.
    if (user.role === 'creator') {
      c.set('enabledModules', ALL_MODULE_KEYS as unknown as string[])
    } else if (!active) {
      c.set('enabledModules', ALL_MODULE_KEYS as unknown as string[])
    } else {
      // Query ALL rows (not just enabled ones) so we can distinguish between
      // "no rows at all" (pre-migration fallback → enable all) vs
      // "rows exist but all disabled" (intentional → no modules enabled).
      const modResult = await query(
        `SELECT module_key, is_enabled FROM company_modules WHERE company_id = $1`,
        [active]
      )
      if (modResult.rows.length === 0) {
        // No rows at all — company_modules not yet seeded; default to all enabled
        c.set('enabledModules', ALL_MODULE_KEYS as unknown as string[])
      } else {
        c.set('enabledModules', modResult.rows
          .filter((r: { is_enabled: boolean }) => r.is_enabled)
          .map((r: { module_key: string }) => r.module_key))
      }
    }

    // Load allowed modules for this user's role (role permission).
    // Creator always has all modules. If user has a company_role_id, query
    // role_module_access. Otherwise fall back to the static MODULES registry
    // for backward compatibility with pre-057 users.
    if (user.role === 'creator') {
      c.set('allowedModules', ALL_MODULE_KEYS as unknown as string[])
    } else if (user.company_role_id) {
      const roleModResult = await query(
        `SELECT rma.module_key
         FROM role_module_access rma
         WHERE rma.role_id = $1 AND rma.can_read = true`,
        [user.company_role_id]
      )
      c.set('allowedModules', roleModResult.rows.map((r: { module_key: string }) => r.module_key))
    } else {
      // Backward compat: user predates migration 057 and has no company_role_id.
      // Derive allowed modules from the static registry using users.role. An
      // unrecognised role slug gets nothing - it must never inherit another
      // role's access by accident.
      c.set('allowedModules', modulesForRole(user.role as string) as unknown as string[])
    }

    if (shouldLogSessionActivity(user.id as string)) {
      void writeAuditLogForRequest(c, {
        action:       AUDIT_ACTIONS.authSessionActive,
        resourceType: 'session',
        resourceId:   user.id as string,
        after:        { email: session.user.email, route: `${c.req.method} ${c.req.path}` },
      })
    }

    // Establish the actor context ONCE for the whole downstream request. Every
    // audit write and every transaction() below this point picks the actor up
    // from here — handlers never set it themselves.
    return await runWithActorContext(
      { userId: user.id as string, role: user.role as string, companyIds },
      async () => { await next() }
    )
  } catch (error) {
    console.error('Auth middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}
