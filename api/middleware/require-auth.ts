import { Context, Next } from 'hono'
import { auth } from '../lib/auth'
import { query } from '../lib/db'
import { ALL_MODULE_KEYS, MODULES } from '../lib/modules'

export async function requireAuth(c: Context, next: Next) {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session?.user) return c.json({ error: 'Unauthorized' }, 401)

    const result = await query(
      `SELECT u.id, u.role, u.company_role_id,
              array_agg(DISTINCT uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) as company_ids
       FROM users u
       LEFT JOIN user_companies uc ON uc.user_id = u.id
       WHERE u.email = $1 AND u.is_active = true
       GROUP BY u.id`,
      [session.user.email]
    )

    if (result.rows.length === 0) return c.json({ error: 'User not found or inactive' }, 401)

    const user = result.rows[0]
    c.set('userId', user.id)
    c.set('role', user.role)

    // Creator is a super-admin tier - always sees every company, regardless of
    // its own user_companies assignment (which may be empty or partial).
    let companyIds: string[]
    if (user.role === 'creator') {
      const allCompanies = await query(`SELECT id FROM companies`, [])
      companyIds = allCompanies.rows.map((r: { id: string }) => r.id)
    } else {
      companyIds = user.company_ids || []
    }
    c.set('companyIds', companyIds)

    // Load enabled modules for the user's primary company (company toggle).
    // Creator always gets all modules. If company_modules has no rows yet
    // (pre-migration or new company) we fall back to all modules enabled.
    if (user.role === 'creator') {
      c.set('enabledModules', ALL_MODULE_KEYS as unknown as string[])
    } else if (companyIds.length === 0) {
      c.set('enabledModules', ALL_MODULE_KEYS as unknown as string[])
    } else {
      const primaryCompanyId = companyIds[0]
      // Query ALL rows (not just enabled ones) so we can distinguish between
      // "no rows at all" (pre-migration fallback → enable all) vs
      // "rows exist but all disabled" (intentional → no modules enabled).
      const modResult = await query(
        `SELECT module_key, is_enabled FROM company_modules WHERE company_id = $1`,
        [primaryCompanyId]
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
      // Derive allowed modules from the static registry using users.role.
      const role = user.role as string
      const allowed = ALL_MODULE_KEYS.filter((key) => {
        const mod = MODULES[key]
        return (mod.roles as readonly string[]).includes(role)
      })
      c.set('allowedModules', allowed)
    }

    await next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}
