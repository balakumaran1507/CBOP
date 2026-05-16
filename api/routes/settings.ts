import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/settings/users ──────────────────────────────────────────────────

app.get('/api/settings/users', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.telegram_chat_id, u.whatsapp_number,
            u.is_active, u.created_at,
            array_agg(uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) AS company_ids,
            array_agg(co.name ORDER BY co.name) FILTER (WHERE co.name IS NOT NULL) AS company_names
     FROM users u
     LEFT JOIN user_companies uc ON uc.user_id = u.id
     LEFT JOIN companies co ON co.id = uc.company_id
     GROUP BY u.id
     ORDER BY u.created_at ASC`,
    []
  )
  return c.json({ users: result.rows })
})

// ── POST /api/settings/users ─────────────────────────────────────────────────
// CEO-only: creates auth account + users row + user_companies rows

app.post('/api/settings/users', requireAuth, requireRole('ceo'), async (c) => {
  const body = await c.req.json()
  const { name, email, role, password, telegram_chat_id, whatsapp_number, company_ids } = body

  if (!name || !email || !role || !password) {
    return c.json({ error: 'name, email, role, password required' }, 400)
  }
  if (!['ceo', 'coo', 'cto'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }
  if (!company_ids || (company_ids as string[]).length === 0) {
    return c.json({ error: 'At least one company required' }, 400)
  }

  const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'
  const signupRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  })

  if (!signupRes.ok) {
    const text = await signupRes.text()
    let parsed: Record<string, string> = {}
    try { parsed = JSON.parse(text) } catch {}
    if (!parsed.message?.includes('already exists')) {
      return c.json({ error: parsed.message || 'Failed to create auth account' }, 400)
    }
  }

  const result = await query(
    `INSERT INTO users (name, email, role, telegram_chat_id, whatsapp_number)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET name              = EXCLUDED.name,
           role              = EXCLUDED.role,
           telegram_chat_id  = EXCLUDED.telegram_chat_id,
           whatsapp_number   = EXCLUDED.whatsapp_number,
           is_active         = true
     RETURNING id, name, email, role, telegram_chat_id, whatsapp_number, is_active, created_at`,
    [name, email, role, telegram_chat_id ?? null, whatsapp_number ?? null]
  )

  const user = result.rows[0]

  await query(`DELETE FROM user_companies WHERE user_id = $1`, [user.id])
  for (const cid of company_ids as string[]) {
    await query(
      `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [user.id, cid]
    )
  }

  return c.json({ user }, 201)
})

// ── PATCH /api/settings/users/:id ───────────────────────────────────────────
// CEO-only: update name/role/telegram/whatsapp/is_active/companies

app.patch('/api/settings/users/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, role, telegram_chat_id, whatsapp_number, is_active, company_ids } = body

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (name             !== undefined) { sets.push(`name = $${p++}`);             params.push(name) }
  if (role             !== undefined) { sets.push(`role = $${p++}`);             params.push(role) }
  if (telegram_chat_id !== undefined) { sets.push(`telegram_chat_id = $${p++}`); params.push(telegram_chat_id) }
  if (whatsapp_number  !== undefined) { sets.push(`whatsapp_number = $${p++}`);  params.push(whatsapp_number) }
  if (is_active        !== undefined) { sets.push(`is_active = $${p++}`);        params.push(is_active) }

  let user = null

  if (sets.length > 0) {
    params.push(id)
    const result = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${p}
       RETURNING id, name, email, role, telegram_chat_id, whatsapp_number, is_active`,
      params
    )
    if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)
    user = result.rows[0]
  }

  if (company_ids !== undefined) {
    await query(`DELETE FROM user_companies WHERE user_id = $1`, [id])
    for (const cid of company_ids as string[]) {
      await query(
        `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, cid]
      )
    }
  }

  if (!user) {
    const res = await query(
      `SELECT id, name, email, role, telegram_chat_id, whatsapp_number, is_active FROM users WHERE id = $1`,
      [id]
    )
    if (res.rows.length === 0) return c.json({ error: 'Not found' }, 404)
    user = res.rows[0]
  }

  return c.json({ user })
})

// ── GET /api/settings/companies ──────────────────────────────────────────────

app.get('/api/settings/companies', requireAuth, requireRole('ceo'), async (c) => {
  const result = await query(
    `SELECT id, name, type, gstin, upi_id, bank_details, invoice_prefix, created_at
     FROM companies ORDER BY name`,
    []
  )
  return c.json({ companies: result.rows })
})

// ── PATCH /api/settings/companies/:id ───────────────────────────────────────

app.patch('/api/settings/companies/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, type, gstin, upi_id, bank_details } = body

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (name         !== undefined) { sets.push(`name = $${p++}`);         params.push(name) }
  if (type         !== undefined) { sets.push(`type = $${p++}`);         params.push(type) }
  if (gstin        !== undefined) { sets.push(`gstin = $${p++}`);        params.push(gstin) }
  if (upi_id       !== undefined) { sets.push(`upi_id = $${p++}`);       params.push(upi_id) }
  if (bank_details !== undefined) { sets.push(`bank_details = $${p++}`); params.push(JSON.stringify(bank_details)) }

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  params.push(id)
  const result = await query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, name, type, gstin, upi_id, bank_details, invoice_prefix`,
    params
  )

  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ company: result.rows[0] })
})

// ── GET /api/settings/jobs ───────────────────────────────────────────────────

app.get('/api/settings/jobs', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const result = await query(
    `SELECT id, name, type, status, started_at, completed_at,
            payload, result, error_message, retry_count, created_at
     FROM system_jobs
     ORDER BY created_at DESC
     LIMIT 200`,
    []
  )
  return c.json({ jobs: result.rows })
})

// ── POST /api/settings/jobs/:id/retry ───────────────────────────────────────
// Re-enqueues a job as a new pending entry with the same payload

app.post('/api/settings/jobs/:id/retry', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const id = c.req.param('id')

  const existing = await query(`SELECT * FROM system_jobs WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)

  const original = existing.rows[0]

  const result = await query(
    `INSERT INTO system_jobs (name, type, status, payload, retry_count)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING id, name, type, status, payload, retry_count, created_at`,
    [original.name, original.type, original.payload, (original.retry_count ?? 0) + 1]
  )

  return c.json({ job: result.rows[0] }, 201)
})

// ── GET /api/settings/integrations ──────────────────────────────────────────
// Returns masked env var values — no editing in UI

app.get('/api/settings/integrations', requireAuth, requireRole('ceo'), async (c) => {
  const mask = (val: string | undefined, sensitive = true) => {
    if (!val) return '[not set]'
    if (!sensitive) return val
    if (val.length <= 8) return '•••••••'
    return val.slice(0, 4) + '•••••' + val.slice(-4)
  }

  return c.json({
    integrations: [
      {
        group: 'Messaging',
        items: [
          { key: 'OPENCLAW_URL',     label: 'OpenClaw URL',     value: mask(process.env.OPENCLAW_URL, false),     sensitive: false },
          { key: 'OPENCLAW_API_KEY', label: 'OpenClaw API Key', value: mask(process.env.OPENCLAW_API_KEY),        sensitive: true  },
        ],
      },
      {
        group: 'SOPs',
        items: [
          { key: 'OUTLINE_URL',       label: 'Outline URL',       value: mask(process.env.OUTLINE_URL, false),  sensitive: false },
          { key: 'OUTLINE_API_TOKEN', label: 'Outline API Token', value: mask(process.env.OUTLINE_API_TOKEN),   sensitive: true  },
        ],
      },
      {
        group: 'WhatsApp',
        items: [
          { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID',  value: mask(process.env.WHATSAPP_PHONE_NUMBER_ID), sensitive: true },
          { key: 'WHATSAPP_ACCESS_TOKEN',    label: 'Access Token',     value: mask(process.env.WHATSAPP_ACCESS_TOKEN),    sensitive: true },
        ],
      },
      {
        group: 'n8n',
        items: [
          { key: 'N8N_URL',            label: 'n8n URL',            value: mask(process.env.N8N_URL, false),      sensitive: false },
          { key: 'N8N_WEBHOOK_SECRET', label: 'Webhook Secret',     value: mask(process.env.N8N_WEBHOOK_SECRET),  sensitive: true  },
        ],
      },
      {
        group: 'Backup (AWS S3)',
        items: [
          { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', value: mask(process.env.AWS_ACCESS_KEY_ID), sensitive: true  },
          { key: 'S3_BUCKET_NAME',    label: 'Bucket Name',   value: mask(process.env.S3_BUCKET_NAME, false), sensitive: false },
        ],
      },
    ],
  })
})

export default app
