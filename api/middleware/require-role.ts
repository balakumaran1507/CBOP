import { Context, Next } from 'hono'
import { AUDIT_ACTIONS, writeAuthzDenial } from '../lib/audit-log'

export type Role = 'creator' | 'ceo' | 'coo' | 'cto'

/**
 * Middleware to require specific role(s)
 * Must be used after requireAuth middleware
 *
 * 'creator' is a super-admin tier above every other role - it always passes,
 * regardless of which roles a given route lists.
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const role = c.get('role') as Role

    if (!role) {
      return c.json({ error: 'No role in context. requireAuth middleware missing?' }, 500)
    }

    if (role === 'creator') return next()

    if (!allowedRoles.includes(role)) {
      // Every authorization denial is audit evidence — fire-and-forget so the
      // 403 is not held up by a database round trip.
      writeAuthzDenial(c, {
        action: AUDIT_ACTIONS.authzRoleDenied,
        reason: 'role_not_in_allowlist',
        detail: { actor_role: role, required_roles: allowedRoles },
      })
      return c.json({ error: 'Forbidden: insufficient permissions' }, 403)
    }

    await next()
  }
}
