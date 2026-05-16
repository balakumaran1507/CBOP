import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { triggerAgent, sendViaOpenClaw } from '../lib/openclaw'
import '../lib/hono-vars'

const app = new Hono()

// ── Supporting endpoints (auth only — used by form dropdowns in other slices too) ────────────────

app.get('/api/users', requireAuth, async (c) => {
  const result = await query(
    `SELECT id, name, role FROM users WHERE is_active = true ORDER BY name ASC`
  )
  return c.json({ users: result.rows })
})

app.get('/api/companies', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT id, name, invoice_prefix FROM companies WHERE id = ANY($1) ORDER BY name ASC`,
    [companyIds]
  )
  return c.json({ companies: result.rows })
})

// ── Sales routes: CEO + COO only ─────────────────────────────────────────────────────────────────

app.get('/api/deals', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT d.id, d.name, d.value, d.stage, d.service_type,
            d.company_id, d.owner_id, d.lost_reason, d.closed_at,
            d.created_at, d.updated_at,
            co.name as company_name,
            u.name  as owner_name,
            GREATEST(EXTRACT(DAY FROM NOW() - d.updated_at)::int, 0) as days_in_stage
     FROM sales_deals d
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN users u      ON u.id  = d.owner_id
     WHERE d.company_id = ANY($1)
     ORDER BY d.created_at DESC`,
    [companyIds]
  )

  return c.json({ deals: result.rows })
})

app.post('/api/deals', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { name, company_id, value, stage, service_type, owner_id } = body

  if (!name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (!company_id)   return c.json({ error: 'company_id is required' }, 400)
  if (!stage)        return c.json({ error: 'stage is required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const result = await query(
    `INSERT INTO sales_deals (name, company_id, value, stage, service_type, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, value, stage, service_type, company_id, owner_id, created_at`,
    [name.trim(), company_id, value || null, stage, service_type || null, owner_id || null]
  )

  return c.json({ deal: result.rows[0] }, 201)
})

app.patch('/api/deals/:id', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { name, value, service_type, owner_id } = body

  // updated_at set automatically by trigger trg_sales_deals_updated_at
  const result = await query(
    `UPDATE sales_deals
     SET name         = COALESCE($1, name),
         value        = COALESCE($2, value),
         service_type = COALESCE($3, service_type),
         owner_id     = COALESCE($4, owner_id)
     WHERE id = $5 AND company_id = ANY($6)
     RETURNING id`,
    [name || null, value ?? null, service_type || null, owner_id || null, dealId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Deal not found' }, 404)
  return c.json({ success: true })
})

app.patch('/api/deals/:id/stage', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { stage, lost_reason } = body

  const validStages = ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
  if (!validStages.includes(stage)) return c.json({ error: 'Invalid stage' }, 400)
  if (stage === 'closed_lost' && !lost_reason?.trim()) {
    return c.json({ error: 'lost_reason is required when marking a deal as lost' }, 400)
  }

  let result
  if (stage === 'closed_lost') {
    result = await query(
      `UPDATE sales_deals
       SET stage = $1, lost_reason = $2, closed_at = NOW()
       WHERE id = $3 AND company_id = ANY($4)
       RETURNING id`,
      [stage, lost_reason.trim(), dealId, companyIds]
    )
  } else if (stage === 'closed_won') {
    result = await query(
      `UPDATE sales_deals
       SET stage = $1, closed_at = NOW()
       WHERE id = $2 AND company_id = ANY($3)
       RETURNING id`,
      [stage, dealId, companyIds]
    )
  } else {
    result = await query(
      `UPDATE sales_deals
       SET stage = $1
       WHERE id = $2 AND company_id = ANY($3)
       RETURNING id`,
      [stage, dealId, companyIds]
    )
  }

  if (result.rows.length === 0) return c.json({ error: 'Deal not found' }, 404)

  if (stage === 'closed_won') {
    const dealData = await query(
      `SELECT d.id, d.name, d.value, d.service_type, d.company_id,
              cl.name AS client_name, cl.email AS client_email,
              co.name AS company_name, u.name AS owner_name
       FROM sales_deals d
       LEFT JOIN sales_clients cl ON cl.id = d.client_id
       JOIN companies co ON co.id = d.company_id
       JOIN users u ON u.id = d.owner_id
       WHERE d.id = $1`,
      [dealId]
    )
    const deal = dealData.rows[0]
    const jobResult = await query(
      `INSERT INTO system_jobs (name, type, status, started_at, payload)
       VALUES ('deal_invoice_tasks', 'agent', 'running', NOW(), $1)
       RETURNING id`,
      [JSON.stringify({ deal_id: dealId })]
    )
    const jobId = jobResult.rows[0].id as string

    triggerAgent({ agent: 'deal_invoice_tasks', context: deal })
      .then(async (res) => {
        await query(
          `UPDATE system_jobs SET status = 'done', completed_at = NOW(), result = $1 WHERE id = $2`,
          [JSON.stringify(res ?? {}), jobId]
        )
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        await query(
          `UPDATE system_jobs SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
          [msg, jobId]
        )
        await sendViaOpenClaw({
          channel: 'telegram',
          to: process.env.TELEGRAM_BALA_CHAT_ID || '',
          message: `[CBOP ALERT] deal_invoice_tasks FAILED\nDeal: ${deal?.name}\nError: ${msg}`,
        }).catch(() => {})
      })
  }

  return c.json({ success: true })
})

export default app
