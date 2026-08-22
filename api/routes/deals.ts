import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { triggerAgent, sendViaOpenClaw } from '../lib/openclaw'
import { notFound, validationError } from '../lib/route-utils'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── Supporting endpoints (auth only - used by form dropdowns in other slices too) ────────────────

app.get('/api/users', requireAuth, async (c) => {
  const result = await query(
    `SELECT id, name, role FROM users WHERE is_active = true ORDER BY name ASC`
  )
  return c.json({ users: result.rows })
})

app.get('/api/companies', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT id, name, invoice_prefix, logo_url, address, gstin FROM companies WHERE id = ANY($1) ORDER BY name ASC`,
    [companyIds]
  )
  return c.json({ companies: result.rows })
})

// ── Sales routes: CEO + COO only ─────────────────────────────────────────────────────────────────

app.get('/api/deals', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
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

app.post('/api/deals', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { name, company_id, value, stage, service_type, owner_id } = body

  if (!name?.trim()) return validationError(c, 'name is required')
  if (!company_id)   return validationError(c, 'company_id is required')
  if (!stage)        return validationError(c, 'stage is required')
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const result = await query(
    `INSERT INTO sales_deals (name, company_id, value, stage, service_type, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, value, stage, service_type, company_id, owner_id, created_at`,
    [name.trim(), company_id, value || null, stage, service_type || null, owner_id || null]
  )

  const deal = result.rows[0]
  await writeMutationAuditLog(c, {
    table: 'sales_deals', op: 'create', id: deal.id, after: deal, companyId: company_id,
  })

  return c.json({ deal }, 201)
})

app.patch('/api/deals/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { name, value, service_type, owner_id } = body

  const existing = await query(
    `SELECT id, company_id, name, value, service_type, owner_id FROM sales_deals WHERE id = $1 AND company_id = ANY($2)`,
    [dealId, companyIds]
  )
  if (existing.rows.length === 0) return notFound(c, 'Deal')
  const before = existing.rows[0]

  // updated_at set automatically by trigger trg_sales_deals_updated_at
  const result = await query(
    `UPDATE sales_deals
     SET name         = COALESCE($1, name),
         value        = COALESCE($2, value),
         service_type = COALESCE($3, service_type),
         owner_id     = COALESCE($4, owner_id)
     WHERE id = $5 AND company_id = ANY($6)
     RETURNING id, name, value, service_type, owner_id`,
    [name || null, value ?? null, service_type || null, owner_id || null, dealId, companyIds]
  )

  if (result.rows.length === 0) return notFound(c, 'Deal')

  await writeMutationAuditLog(c, {
    table: 'sales_deals', op: 'update', id: dealId, before, after: result.rows[0], companyId: before.company_id,
  })

  return c.json({ success: true })
})

app.patch('/api/deals/:id/stage', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { stage, lost_reason, reopen } = body

  const validStages = ['lead', 'proposal', 'negotiation', 'closed_won', 'closed_lost']
  if (!validStages.includes(stage)) return validationError(c, 'Invalid stage')
  if (stage === 'closed_lost' && !lost_reason?.trim()) {
    return validationError(c, 'lost_reason is required when marking a deal as lost')
  }

  const current = await query(
    `SELECT stage, owner_id, company_id FROM sales_deals WHERE id = $1 AND company_id = ANY($2)`,
    [dealId, companyIds]
  )
  if (current.rows.length === 0) return notFound(c, 'Deal')
  const currentStage = current.rows[0].stage as string
  const CLOSED_STAGES = ['closed_won', 'closed_lost']

  // Moving OUT of a closed stage (a "reopen") is a deliberate action, not a routine
  // drag-and-drop stage move - require an explicit flag so it can't happen by accident.
  if (CLOSED_STAGES.includes(currentStage) && stage !== currentStage && !reopen) {
    return c.json({
      error: `This deal is already ${currentStage.replace('_', ' ')}. Pass { reopen: true } to move it out of a closed stage.`,
    }, 409)
  }

  // closed_won triggers deal_invoice_tasks automation, which needs an owner to
  // attribute the invoice/tasks to - fail clearly here rather than the automation
  // silently no-op'ing on a missing owner further down.
  if (stage === 'closed_won' && !current.rows[0].owner_id) {
    return validationError(c, 'Assign an owner to this deal before marking it Closed Won.')
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

  if (result.rows.length === 0) return notFound(c, 'Deal')

  await writeMutationAuditLog(c, {
    table: 'sales_deals', op: 'update', id: dealId,
    before: { stage: currentStage },
    after:  { stage, lost_reason: stage === 'closed_lost' ? lost_reason.trim() : undefined },
    companyId: current.rows[0].company_id,
  })

  const userId = c.get('userId') as string
  const stageNote = stage === 'closed_lost' ? `Moved to Closed Lost - ${lost_reason.trim()}` : `Moved to ${stage.replace('_', ' ')}`
  await query(
    `INSERT INTO sales_deal_activities (deal_id, user_id, type, note) VALUES ($1,$2,'stage_change',$3)`,
    [dealId, userId, stageNote]
  ).catch(() => {})

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

// ── Deal activity timeline (calls/emails/notes/meetings) ─────────────────────

app.get('/api/deals/:id/activities', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]

  const { rows: [deal] } = await query(`SELECT id FROM sales_deals WHERE id = $1 AND company_id = ANY($2)`, [dealId, companyIds])
  if (!deal) return notFound(c)

  const result = await query(
    `SELECT da.id, da.type, da.note, da.created_at, u.name AS user_name
     FROM sales_deal_activities da
     LEFT JOIN users u ON u.id = da.user_id
     WHERE da.deal_id = $1 ORDER BY da.created_at DESC`,
    [dealId]
  )
  return c.json({ activities: result.rows })
})

app.post('/api/deals/:id/activities', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const dealId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const { type, note } = body as { type: string; note: string }

  if (!['call', 'email', 'meeting', 'note'].includes(type)) return validationError(c, 'Invalid type')
  if (!note?.trim()) return validationError(c, 'note required')

  const { rows: [deal] } = await query(`SELECT id, company_id FROM sales_deals WHERE id = $1 AND company_id = ANY($2)`, [dealId, companyIds])
  if (!deal) return notFound(c)

  const result = await query(
    `INSERT INTO sales_deal_activities (deal_id, user_id, type, note) VALUES ($1,$2,$3,$4)
     RETURNING id, type, note, created_at`,
    [dealId, userId, type, note.trim()]
  )
  const activity = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'sales_deal_activities', op: 'create', id: activity.id, after: activity, companyId: deal.company_id,
  })

  return c.json({ activity }, 201)
})

export default app
