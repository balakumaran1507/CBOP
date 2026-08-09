/**
 * Shared route utilities — eliminates the repeated c.json({ error: ... }) pattern
 * that appears 126+ times across backend routes.
 *
 * Import only what you need; do NOT re-export through an index barrel.
 */

import type { Context } from 'hono'

// ── Response helpers ──────────────────────────────────────────────────────────

/**
 * Standard 404 response.
 *
 *   return notFound(c)           // { error: 'Not found' }
 *   return notFound(c, 'Deal')   // { error: 'Deal not found' }
 */
export function notFound(c: Context, resource?: string) {
  const message = resource ? `${resource} not found` : 'Not found'
  return c.json({ error: message }, 404)
}

/**
 * Standard 400 validation-error response.
 *
 *   return validationError(c, 'name is required')
 */
export function validationError(c: Context, message: string) {
  return c.json({ error: message }, 400)
}

// ── Pagination ────────────────────────────────────────────────────────────────

/**
 * Extract page / limit from query params and return the derived offset.
 * Defaults: page = 1, limit = 50. Max limit: 200.
 *
 *   const { page, limit, offset } = getPagination(c)
 *   `... LIMIT $N OFFSET $M`
 */
export function getPagination(c: Context): { page: number; limit: number; offset: number } {
  const page  = Math.max(1, parseInt(c.req.query('page')  || '1',  10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50))
  return { page, limit, offset: (page - 1) * limit }
}

// ── Async handler wrapper ─────────────────────────────────────────────────────

/**
 * Wraps an async handler with a catch-all that returns 500 on unhandled errors.
 * Use for new routes; existing routes let errors propagate to Hono's error handler.
 *
 *   app.get('/api/foo', requireAuth, handler(async (c) => {
 *     // any thrown error becomes { error: 'Internal server error' } 500
 *   }))
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handler(fn: (c: any) => Promise<unknown>): (c: any) => Promise<unknown> {
  return async (c) => {
    try {
      return await fn(c)
    } catch (err) {
      console.error('[route error]', err)
      return (c as Context).json({ error: 'Internal server error' }, 500)
    }
  }
}

// ── Company scope helper ──────────────────────────────────────────────────────

/**
 * Returns the SQL fragment and parameter for a company_id = ANY($N) clause.
 *
 *   const { clause, param } = companyScope(companyIds, 1)
 *   `WHERE company_id = ${clause}`, [...param, ...otherParams]
 *   // → WHERE company_id = ANY($1), [companyIds, ...]
 *
 * This is a lightweight helper — it does NOT build the full query.
 */
export function companyScope(
  companyIds: string[],
  paramIndex = 1,
): { clause: string; param: [string[]] } {
  return { clause: `ANY($${paramIndex})`, param: [companyIds] }
}
