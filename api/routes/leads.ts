import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query, transaction } from '../lib/db'
import { notFound, validationError } from '../lib/route-utils'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── Helpers ───────────────────────────────────────────────────────────────────

class NotFoundError extends Error {}
class AlreadyConvertedError extends Error {}

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

app.get('/api/leads', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
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

app.post('/api/leads', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { company_id, name, email, phone, org_name, source, badge, notes, owner_id } = body

  if (!company_id) return validationError(c, 'company_id is required')
  if (!name)       return validationError(c, 'name is required')
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

  await writeMutationAuditLog(c, {
    table: 'sales_leads', op: 'create', id: lead.id, after: lead, companyId: company_id,
  })

  // Trigger lead scoring in n8n (fire-and-forget)
  fireN8nWebhook('lead-updated', { lead_id: lead.id })

  return c.json({ lead }, 201)
})

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────

app.patch('/api/leads/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const leadId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, email, phone, org_name, source, score, badge, status, notes, owner_id, last_contact_at } = body

  const existing = await query(
    `SELECT id, company_id, name, email, phone, org_name, source, score, badge, status, notes, owner_id, last_contact_at
     FROM sales_leads WHERE id = $1 AND company_id = ANY($2)`,
    [leadId, companyIds]
  )
  if (existing.rows.length === 0) return notFound(c, 'Lead')
  const before = existing.rows[0]

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

  if (result.rows.length === 0) return notFound(c, 'Lead')
  const after = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'sales_leads', op: 'update', id: leadId, before, after, companyId: before.company_id,
  })

  // Trigger lead scoring in n8n (fire-and-forget)
  fireN8nWebhook('lead-updated', { lead_id: leadId })

  return c.json({ success: true, lead: after })
})

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────

app.delete('/api/leads/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const leadId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(
    `SELECT id, company_id, name, email, phone, org_name, source, score, badge, status, notes, owner_id
     FROM sales_leads WHERE id = $1 AND company_id = ANY($2)`,
    [leadId, companyIds]
  )
  if (existing.rows.length === 0) return notFound(c, 'Lead')
  const before = existing.rows[0]

  const dealsCheck = await query(`SELECT COUNT(*) AS cnt FROM sales_deals WHERE lead_id = $1`, [leadId])
  if (parseInt(dealsCheck.rows[0].cnt, 10) > 0) {
    return c.json({ error: 'Cannot delete a lead that has been converted to a deal.' }, 409)
  }

  await query(`DELETE FROM sales_leads WHERE id = $1`, [leadId])

  await writeMutationAuditLog(c, {
    table: 'sales_leads', op: 'delete', id: leadId, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── POST /api/leads/:id/convert-to-deal ───────────────────────────────────────

app.post('/api/leads/:id/convert-to-deal', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const leadId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { deal_name, value, service_type } = body

  // Everything below is one atomic operation - client upsert, deal creation, and
  // marking the lead converted must all succeed or all roll back, otherwise a
  // failure partway through leaves an orphan client with no deal and a lead stuck
  // un-converted. FOR UPDATE on the lead row also serializes a concurrent double
  // conversion of the same lead into a clean 409 instead of a duplicate deal.
  let deal: { id: string; name: string; stage: string }
  let clientId: string
  let isNewClient = false
  let dealCompanyId: string

  try {
    const txResult = await transaction(async (client) => {
      const leadResult = await client.query(
        `SELECT id, company_id, name, email, phone, org_name, owner_id, status
         FROM sales_leads WHERE id = $1 AND company_id = ANY($2) FOR UPDATE`,
        [leadId, companyIds]
      )
      if (leadResult.rows.length === 0) throw new NotFoundError()

      const lead = leadResult.rows[0]
      if (lead.status === 'converted') throw new AlreadyConvertedError()

      // Upsert client - match by email within same company, else create new
      let txClientId: string
      let txIsNewClient = false

      if (lead.email) {
        const existing = await client.query(
          `SELECT id FROM sales_clients WHERE company_id = $1 AND email = $2 LIMIT 1`,
          [lead.company_id, lead.email]
        )
        if (existing.rows.length > 0) {
          txClientId = existing.rows[0].id as string
        } else {
          txIsNewClient = true
        }
      } else {
        txIsNewClient = true
      }

      if (txIsNewClient) {
        const newClient = await client.query(
          `INSERT INTO sales_clients (company_id, name, email, phone, org_name, added_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [lead.company_id, lead.name, lead.email || null, lead.phone || null, lead.org_name || null, userId]
        )
        txClientId = newClient.rows[0].id as string
      }

      // Create deal
      const name = deal_name || `${lead.org_name || lead.name} Deal`
      const dealResult = await client.query(
        `INSERT INTO sales_deals (company_id, lead_id, client_id, name, value, service_type, stage, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'lead', $7)
         RETURNING id, name, stage`,
        [
          lead.company_id, leadId, txClientId!, name,
          value ? parseFloat(String(value)) : null,
          service_type || null,
          lead.owner_id || userId,
        ]
      )

      // Mark lead converted
      await client.query(`UPDATE sales_leads SET status = 'converted' WHERE id = $1`, [leadId])

      return { deal: dealResult.rows[0], clientId: txClientId!, isNewClient: txIsNewClient, companyId: lead.company_id as string }
    })
    deal = txResult.deal
    clientId = txResult.clientId
    isNewClient = txResult.isNewClient
    dealCompanyId = txResult.companyId
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Lead not found' }, 404)
    if (err instanceof AlreadyConvertedError) return c.json({ error: 'Lead already converted' }, 409)
    throw err
  }

  await writeMutationAuditLog(c, {
    table: 'sales_deals', op: 'create', id: deal.id, after: deal, companyId: dealCompanyId,
  })
  await writeMutationAuditLog(c, {
    table: 'sales_leads', op: 'update', id: leadId, after: { status: 'converted' }, companyId: dealCompanyId,
  })

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
