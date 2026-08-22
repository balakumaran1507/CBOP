import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { notFound, validationError } from '../lib/route-utils'
import { writeMutationAuditLog } from '../lib/audit-log'
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

  const client = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'sales_clients', op: 'create', id: client.id, after: client, companyId: company_id,
  })

  return c.json({ client }, 201)
})

// ── PATCH /api/clients/:id ────────────────────────────────────────────────────

app.patch('/api/clients/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const clientId    = c.req.param('id') as string
  const companyIds  = c.get('companyIds') as string[]
  const body        = await c.req.json()
  const { name, email, phone, org_name, address, gstin } = body

  const existing = await query(
    `SELECT id, company_id, name, email, phone, org_name, address, gstin
     FROM sales_clients WHERE id = $1 AND company_id = ANY($2)`,
    [clientId, companyIds]
  )
  if (existing.rows.length === 0) return notFound(c, 'Client')
  const before = existing.rows[0]

  const result = await query(
    `UPDATE sales_clients
     SET name     = COALESCE($1, name),
         email    = COALESCE($2, email),
         phone    = COALESCE($3, phone),
         org_name = COALESCE($4, org_name),
         address  = COALESCE($5, address),
         gstin    = COALESCE($6, gstin)
     WHERE id = $7 AND company_id = ANY($8)
     RETURNING id, name, email, phone, org_name, address, gstin`,
    [
      name || null, email || null, phone || null, org_name || null,
      address || null, gstin || null,
      clientId, companyIds,
    ]
  )

  if (result.rows.length === 0) return notFound(c, 'Client')
  const after = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'sales_clients', op: 'update', id: clientId, before, after, companyId: before.company_id,
  })

  return c.json({ success: true, client: after })
})

// ── DELETE /api/clients/:id ───────────────────────────────────────────────────

app.delete('/api/clients/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const clientId   = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(
    `SELECT id, company_id, name, email, phone, org_name, address, gstin
     FROM sales_clients WHERE id = $1 AND company_id = ANY($2)`,
    [clientId, companyIds]
  )
  if (existing.rows.length === 0) return notFound(c, 'Client')
  const before = existing.rows[0]

  const dealsCheck = await query(`SELECT COUNT(*) AS cnt FROM sales_deals WHERE client_id = $1`, [clientId])
  if (parseInt(dealsCheck.rows[0].cnt, 10) > 0) {
    return c.json({ error: 'Cannot delete client with existing deals. Remove or reassign their deals first.' }, 409)
  }

  await query(`DELETE FROM sales_clients WHERE id = $1`, [clientId])

  await writeMutationAuditLog(c, {
    table: 'sales_clients', op: 'delete', id: clientId, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

export default app
