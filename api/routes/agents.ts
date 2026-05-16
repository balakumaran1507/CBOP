import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { triggerAgent, sendViaOpenClaw } from '../lib/openclaw'
import '../lib/hono-vars'

const app = new Hono()

// ── Internal trigger ──────────────────────────────────────────────────────────
// Called by CBOP itself (deal close, etc.) — not exposed externally

app.post('/api/agents/trigger/:name', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const name = c.req.param('name') as string
  const body = await c.req.json()

  const validAgents = ['deal_invoice_tasks', 'morning_briefing', 'prospect_research', 'social_media']
  if (!validAgents.includes(name)) return c.json({ error: 'Unknown agent' }, 400)

  const jobResult = await query(
    `INSERT INTO system_jobs (name, type, status, started_at, payload)
     VALUES ($1, 'agent', 'running', NOW(), $2)
     RETURNING id`,
    [name, JSON.stringify(body)]
  )
  const jobId = String(jobResult.rows[0].id)

  // Fire agent async — don't block the response
  triggerAgent({ agent: name, context: body as Record<string, unknown> })
    .then(async (result) => {
      await query(
        `UPDATE system_jobs SET status = 'done', completed_at = NOW(), result = $1 WHERE id = $2`,
        [JSON.stringify(result ?? {}), jobId]
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
        message: `[CBOP ALERT] ${name} FAILED\nError: ${msg}\nJob: ${jobId}`,
      }).catch(() => {})
    })

  return c.json({ ok: true, job_id: jobId })
})

// ── cbop_control tool endpoints ───────────────────────────────────────────────
// OpenClaw calls these when cbop_control agent needs data or actions.
// Auth: requireAuth (OpenClaw authenticates as Bala's session or a service account).
// Role gates match web UI — Guru cannot access finance data.

app.get('/api/agents/cbop-control/tools/getOverdueInvoices', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId = c.req.query('company_id')
  // Validate the requested company_id is within the session user's scope
  if (companyId && !companyIds.includes(companyId)) {
    return c.json({ error: 'Forbidden: company not in scope' }, 403)
  }
  const ids = companyId ? [companyId] : companyIds
  const result = await query(
    `SELECT i.id, i.invoice_no, i.total, i.due_date, i.status,
            cl.name AS client_name, co.name AS company_name
     FROM sales_invoices i
     JOIN sales_clients cl ON cl.id = i.client_id
     JOIN companies co ON co.id = i.company_id
     WHERE i.company_id = ANY($1)
       AND i.status IN ('sent', 'overdue')
       AND i.due_date < CURRENT_DATE
     ORDER BY i.due_date ASC`,
    [ids]
  )
  return c.json(result.rows)
})

app.get('/api/agents/cbop-control/tools/getTodaysTasks', requireAuth, async (c) => {
  const userId  = c.get('userId') as string
  const role    = c.get('role') as string
  const companyIds = c.get('companyIds') as string[]
  const requestedUserId = c.req.query('user_id')
  // Only CEO/COO may look up another user's tasks; everyone else sees their own
  const targetUserId = (requestedUserId && ['ceo', 'coo'].includes(role))
    ? requestedUserId
    : userId
  const result = await query(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date,
            p.name AS project_name, co.name AS company_name
     FROM ops_tasks t
     JOIN ops_projects p ON p.id = t.project_id
     JOIN companies co ON co.id = t.company_id
     WHERE t.owner_id = $1
       AND t.company_id = ANY($2)
       AND t.status != 'done'
       AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE + INTERVAL '1 day')
     ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`,
    [targetUserId, companyIds]
  )
  return c.json(result.rows)
})

app.get('/api/agents/cbop-control/tools/getPipelineSummary', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId = c.req.query('company_id')
  // Validate the requested company_id is within the session user's scope
  if (companyId && !companyIds.includes(companyId)) {
    return c.json({ error: 'Forbidden: company not in scope' }, 403)
  }
  const ids = companyId ? [companyId] : companyIds
  const result = await query(
    `SELECT stage,
            COUNT(*) AS count,
            COALESCE(SUM(value), 0) AS total_value
     FROM sales_deals
     WHERE company_id = ANY($1) AND stage NOT IN ('closed_lost')
     GROUP BY stage
     ORDER BY CASE stage WHEN 'lead' THEN 1 WHEN 'proposal' THEN 2 WHEN 'negotiation' THEN 3 WHEN 'closed_won' THEN 4 END`,
    [ids]
  )
  return c.json(result.rows)
})

app.get('/api/agents/cbop-control/tools/getDealStatus', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const dealId = c.req.query('deal_id')
  if (!dealId) return c.json({ error: 'deal_id required' }, 400)
  const result = await query(
    `SELECT d.id, d.name, d.stage, d.value, d.service_type, d.closed_at,
            cl.name AS client_name, co.name AS company_name, u.name AS owner_name
     FROM sales_deals d
     LEFT JOIN sales_clients cl ON cl.id = d.client_id
     JOIN companies co ON co.id = d.company_id
     JOIN users u ON u.id = d.owner_id
     WHERE d.id = $1 AND d.company_id = ANY($2)`,
    [dealId, companyIds]
  )
  if (!result.rows.length) return c.json({ error: 'Deal not found' }, 404)
  return c.json(result.rows[0])
})

app.post('/api/agents/cbop-control/tools/createTask', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{
    title: string; project_id: string; owner_id?: string; due_date?: string; priority?: string
  }>()
  if (!body.title?.trim() || !body.project_id) {
    return c.json({ error: 'title and project_id required' }, 400)
  }

  const projectCheck = await query(
    `SELECT company_id FROM ops_projects WHERE id = $1 AND company_id = ANY($2)`,
    [body.project_id, companyIds]
  )
  if (!projectCheck.rows.length) return c.json({ error: 'Project not found' }, 404)

  const result = await query(
    `INSERT INTO ops_tasks (title, project_id, company_id, owner_id, due_date, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'todo')
     RETURNING id, title`,
    [
      body.title.trim(),
      body.project_id,
      projectCheck.rows[0].company_id,
      body.owner_id || c.get('userId'),
      body.due_date || null,
      body.priority || 'normal',
    ]
  )
  return c.json(result.rows[0])
})

app.post('/api/agents/cbop-control/tools/markTaskDone', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{ task_id: string }>()
  if (!body.task_id) return c.json({ error: 'task_id required' }, 400)

  const result = await query(
    `UPDATE ops_tasks SET status = 'done'
     WHERE id = $1 AND company_id = ANY($2)
     RETURNING id, title`,
    [body.task_id, companyIds]
  )
  if (!result.rows.length) return c.json({ error: 'Task not found' }, 404)
  return c.json({ ok: true, task: result.rows[0] })
})

app.post('/api/agents/cbop-control/tools/createLead', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{
    name: string; org?: string; source?: string; owner_id?: string; company_id: string
  }>()
  if (!body.name?.trim() || !body.company_id) {
    return c.json({ error: 'name and company_id required' }, 400)
  }
  if (!companyIds.includes(body.company_id)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `INSERT INTO sales_leads (name, org, source, owner_id, company_id, status, last_contact_at)
     VALUES ($1, $2, $3, $4, $5, 'new', NOW())
     RETURNING id, name`,
    [
      body.name.trim(),
      body.org || null,
      body.source || 'other',
      body.owner_id || c.get('userId'),
      body.company_id,
    ]
  )
  return c.json(result.rows[0])
})

app.get('/api/agents/cbop-control/tools/getMorningBriefing', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string

  const [overdueInvoices, todayTasks, openDeals] = await Promise.all([
    query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total_amount
       FROM sales_invoices
       WHERE company_id = ANY($1) AND status IN ('sent', 'overdue') AND due_date < CURRENT_DATE`,
      [companyIds]
    ),
    query(
      `SELECT COUNT(*) AS count FROM ops_tasks
       WHERE owner_id = $1 AND status != 'done'
         AND (due_date IS NULL OR due_date <= CURRENT_DATE)`,
      [userId]
    ),
    query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(value), 0) AS pipeline_value
       FROM sales_deals
       WHERE company_id = ANY($1) AND stage NOT IN ('closed_won', 'closed_lost')`,
      [companyIds]
    ),
  ])

  return c.json({
    date: new Date().toISOString().split('T')[0],
    overdue_invoices: {
      count: Number(overdueInvoices.rows[0].count),
      total_amount: parseFloat(String(overdueInvoices.rows[0].total_amount)),
    },
    my_tasks_due: Number(todayTasks.rows[0].count),
    open_deals: {
      count: Number(openDeals.rows[0].count),
      pipeline_value: parseFloat(String(openDeals.rows[0].pipeline_value)),
    },
  })
})

app.post('/api/agents/cbop-control/tools/sendInvoiceReminder', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{ invoice_id: string }>()
  if (!body.invoice_id) return c.json({ error: 'invoice_id required' }, 400)

  const result = await query(
    `SELECT i.id, i.invoice_no, i.total, i.due_date,
            cl.name AS client_name, cl.phone AS client_phone,
            (i.machine_data->>'reminder_count')::int AS reminder_count
     FROM sales_invoices i
     JOIN sales_clients cl ON cl.id = i.client_id
     WHERE i.id = $1 AND i.company_id = ANY($2)`,
    [body.invoice_id, companyIds]
  )
  if (!result.rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const inv = result.rows[0]
  if (!inv.client_phone) return c.json({ error: 'Client has no phone number' }, 400)

  await sendViaOpenClaw({
    channel: 'whatsapp',
    to: inv.client_phone as string,
    template: 'invoice_reminder',
    vars: {
      client_name: inv.client_name as string,
      invoice_no: inv.invoice_no as string,
      amount: String(inv.total),
      due_date: inv.due_date as string,
    },
  })

  const newCount = ((inv.reminder_count as number) || 0) + 1
  await query(
    `UPDATE sales_invoices
     SET machine_data = COALESCE(machine_data, '{}'::jsonb) || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ reminder_count: newCount, last_reminded_at: new Date().toISOString() }), body.invoice_id]
  )

  return c.json({ ok: true, reminder_count: newCount })
})

app.get('/api/agents/cbop-control/tools/getProjectStatus', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ error: 'project_id required' }, 400)

  const result = await query(
    `SELECT p.id, p.name, p.status, p.due_date,
            co.name AS company_name, u.name AS owner_name,
            COUNT(t.id) AS tasks_total,
            COUNT(t.id) FILTER (WHERE t.status = 'done') AS tasks_done,
            COUNT(t.id) FILTER (WHERE t.status != 'done' AND t.due_date < CURRENT_DATE) AS tasks_overdue
     FROM ops_projects p
     JOIN companies co ON co.id = p.company_id
     JOIN users u ON u.id = p.owner_id
     LEFT JOIN ops_tasks t ON t.project_id = p.id
     WHERE p.id = $1 AND p.company_id = ANY($2)
     GROUP BY p.id, co.name, u.name`,
    [projectId, companyIds]
  )
  if (!result.rows.length) return c.json({ error: 'Project not found' }, 404)
  return c.json(result.rows[0])
})

export default app
