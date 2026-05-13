import { Context, Next } from 'hono'

export type Role = 'ceo' | 'coo' | 'cto'

/**
 * Middleware to require specific role(s)
 * Must be used after requireAuth middleware
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const role = c.get('role') as Role

    if (!role) {
      return c.json({ error: 'No role in context. requireAuth middleware missing?' }, 500)
    }

    if (!allowedRoles.includes(role)) {
      return c.json({ error: 'Forbidden: insufficient permissions' }, 403)
    }

    await next()
  }
}
