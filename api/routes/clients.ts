import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { validationError } from '../lib/route-utils'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/clients ──────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  // total_billed is a correlated subquery, not a join, deliberately - joining
  // sales_invoices alongside sales_deals fans out rows per (deal x invoice) pair,
  // which multiplied SUM(i.total) by however many deals a client had. A scalar
  // subquery is computed once per client regardless of how many deals fan out
  // the GROUP BY, so it can't double-count.
  const result = await query(
    `SELECT
       c.id, c.company_id, c.name, c.email, c.phone, c.org_name,
       c.gstin, c.address, c.created_at,
       co.name AS company_name,
       COUNT(DISTINCT d.id) AS deals_count,
       COALESCE((
         SELECT SUM(i.total) FROM sales_invoices i
         WHERE i.client_id = c.id AND i.status = 'paid'
       ), 0) AS total_billed,
       MAX(d.created_at) AS last_active
     FROM sales_clients c
     LEFT JOIN companies co  ON co.id = c.company_id
     LEFT JOIN sales_deals d ON d.client_id = c.id
     WHERE c.company_id = ANY($1)
     GROUP BY c.id, co.name
     ORDER BY c.created_at DESC`,
    [companyIds]
  )

  return c.json({ clients: result.rows })
})

// ── POST /api/clients ─────────────────────────────────────────────────────────

app.post('/api/clients', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { company_id, name, email, phone, org_name, address, gstin } = body

  if (!company_id) return validationError(c, 'company_id is required')
  if (!name)       return validationError(c, 'name is required')
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const result = await query(
    `INSERT INTO sales_clients (company_id, name, email, phone, org_name, address, gstin, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, email, phone, org_name, created_at`,
    [company_id, name, email || null, phone || null, org_name || null, address || null, gstin || null, userId]
  )

  return c.json({ client: result.rows[0] }, 201)
})

export default app
