import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fireN8nWebhook(path: string, body: Record<string, unknown>): Promise<void> {
  const n8nUrl = process.env.N8N_URL
  if (!n8nUrl) return
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 3000)
  )
  try {
    await Promise.race([
      fetch(`${n8nUrl}/webhook/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.N8N_WEBHOOK_SECRET ? { 'x-n8n-secret': process.env.N8N_WEBHOOK_SECRET } : {}),
        },
        body: JSON.stringify(body),
      }),
      timeout,
    ])
  } catch { /* n8n is optional in dev */ }
}

// ── GET /api/leads ────────────────────────────────────────────────────────────

app.get('/api/leads', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT
       l.id, l.company_id, l.name, l.email, l.phone, l.org_name,
       l.source, l.score, l.badge, l.status, l.last_contact_at,
       l.notes, l.owner_id, l.created_at,
       u.name  AS owner_name,
       co.name AS company_name
     FROM sales_leads l
     LEFT JOIN users u    ON u.id  = l.owner_id
     LEFT JOIN companies co ON co.id = l.company_id
     WHERE l.company_id = ANY($1)
     ORDER BY l.created_at DESC`,
    [companyIds]
  )

  return c.json({ leads: result.rows })
})

// ── POST /api/leads ───────────────────────────────────────────────────────────

app.post('/api/leads', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { company_id, name, email, phone, org_name, source, badge, notes, owner_id } = body

  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const result = await query(
    `INSERT INTO sales_leads
       (company_id, name, email, phone, org_name, source, badge, status, notes, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8, $9)
     RETURNING id, name, status, badge, score, created_at`,
    [
      company_id, name, email || null, phone || null, org_name || null,
      source || null, badge || null, notes || null,
      owner_id || userId,
    ]
  )

  const lead = result.rows[0]

  // Trigger lead scoring in n8n (fire-and-forget)
  fireN8nWebhook('lead-updated', { lead_id: lead.id })

  return c.json({ lead }, 201)
})

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────

app.patch('/api/leads/:id', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const leadId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, email, phone, org_name, source, score, badge, status, notes, owner_id, last_contact_at } = body

  const result = await query(
    `UPDATE sales_leads
     SET name             = COALESCE($1, name),
         email            = COALESCE($2, email),
         phone            = COALESCE($3, phone),
         org_name         = COALESCE($4, org_name),
         source           = COALESCE($5, source),
         score            = COALESCE($6, score),
         badge            = COALESCE($7, badge),
         status           = COALESCE($8, status),
         notes            = COALESCE($9, notes),
         owner_id         = COALESCE($10, owner_id),
         last_contact_at  = COALESCE($11, last_contact_at)
     WHERE id = $12 AND company_id = ANY($13)
     RETURNING id, name, status, badge, score`,
    [
      name || null, email || null, phone || null, org_name || null,
      source || null, score ?? null, badge || null, status || null,
      notes || null, owner_id || null,
      last_contact_at || null,
      leadId, companyIds,
    ]
  )

  if (result.rows.length === 0) return c.json({ error: 'Lead not found' }, 404)

  // Trigger lead scoring in n8n (fire-and-forget)
  fireN8nWebhook('lead-updated', { lead_id: leadId })

  return c.json({ success: true, lead: result.rows[0] })
})

// ── POST /api/leads/:id/convert-to-deal ───────────────────────────────────────

app.post('/api/leads/:id/convert-to-deal', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const leadId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { deal_name, value, service_type } = body

  // Fetch lead + verify scope
  const leadResult = await query(
    `SELECT id, company_id, name, email, phone, org_name, owner_id, status
     FROM sales_leads WHERE id = $1 AND company_id = ANY($2)`,
    [leadId, companyIds]
  )
  if (leadResult.rows.length === 0) return c.json({ error: 'Lead not found' }, 404)

  const lead = leadResult.rows[0]
  if (lead.status === 'converted') return c.json({ error: 'Lead already converted' }, 409)

  // Upsert client — match by email within same company, else create new
  let clientId: string
  let isNewClient = false

  if (lead.email) {
    const existing = await query(
      `SELECT id FROM sales_clients WHERE company_id = $1 AND email = $2 LIMIT 1`,
      [lead.company_id, lead.email]
    )
    if (existing.rows.length > 0) {
      clientId = existing.rows[0].id as string
    } else {
      isNewClient = true
    }
  } else {
    isNewClient = true
  }

  if (isNewClient) {
    const newClient = await query(
      `INSERT INTO sales_clients (company_id, name, email, phone, org_name, added_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [lead.company_id, lead.name, lead.email || null, lead.phone || null, lead.org_name || null, userId]
    )
    clientId = newClient.rows[0].id as string
  }

  // Create deal
  const name = deal_name || `${lead.org_name || lead.name} Deal`
  const dealResult = await query(
    `INSERT INTO sales_deals (company_id, lead_id, client_id, name, value, service_type, stage, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'lead', $7)
     RETURNING id, name, stage`,
    [
      lead.company_id, leadId, clientId!, name,
      value ? parseFloat(String(value)) : null,
      service_type || null,
      lead.owner_id || userId,
    ]
  )

  const deal = dealResult.rows[0]

  // Mark lead converted
  await query(
    `UPDATE sales_leads SET status = 'converted' WHERE id = $1`,
    [leadId]
  )

  // Fire n8n webhooks (fire-and-forget)
  fireN8nWebhook('lead-updated', { lead_id: leadId })
  if (isNewClient) {
    fireN8nWebhook('client-created', {
      client_id:    clientId!,
      service_type: service_type || '',
      deal_id:      deal.id,
    })
  }

  return c.json({ deal, client_id: clientId!, is_new_client: isNewClient }, 201)
})

export default app
