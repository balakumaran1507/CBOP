import { Context, Next } from 'hono'
import { auth } from '../lib/auth'
import { query } from '../lib/db'

/**
 * Middleware to require authentication
 * Attaches userId, role, and companyIds to context
 */
export async function requireAuth(c: Context, next: Next) {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })

    if (!session?.user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Fetch user role and company_ids from database
    const result = await query(
      `SELECT u.id, u.role, array_agg(uc.company_id) as company_ids
       FROM users u
       LEFT JOIN user_companies uc ON uc.user_id = u.id
       WHERE u.id = $1 AND u.is_active = true
       GROUP BY u.id`,
      [session.user.id]
    )

    if (result.rows.length === 0) {
      return c.json({ error: 'User not found or inactive' }, 401)
    }

    const user = result.rows[0]

    // Set user context for downstream handlers
    c.set('userId', user.id)
    c.set('role', user.role)
    c.set('companyIds', user.company_ids || [])

    await next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    return c.json({ error: 'Authentication failed' }, 401)
  }
}
