import { Hono } from 'hono'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── Secret validation ─────────────────────────────────────────────────────────

function hasValidSecret(req: Request): boolean {
  const secret = process.env.N8N_WEBHOOK_SECRET
  if (!secret) return true // dev mode: no secret configured → accept all
  return req.headers.get('x-n8n-secret') === secret
}

// ── POST /webhooks/lead-updated ───────────────────────────────────────────────
// n8n lead_scoring workflow calls this after updating score/badge on a lead

app.post('/webhooks/lead-updated', async (c) => {
  if (!hasValidSecret(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ lead_id: string }>()
  if (!body.lead_id) return c.json({ error: 'lead_id required' }, 400)

  await query(
    `INSERT INTO system_jobs (name, type, status, started_at, completed_at, payload)
     VALUES ('lead_scoring', 'automation', 'done', NOW(), NOW(), $1)`,
    [JSON.stringify({ lead_id: body.lead_id })]
  )

  return c.json({ ok: true })
})

// ── POST /webhooks/client-created ─────────────────────────────────────────────
// n8n client_onboarding workflow calls this after creating tasks and sending email

app.post('/webhooks/client-created', async (c) => {
  if (!hasValidSecret(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ client_id: string; service_type: string; deal_id: string }>()
  if (!body.client_id) return c.json({ error: 'client_id required' }, 400)

  await query(
    `INSERT INTO system_jobs (name, type, status, started_at, completed_at, payload)
     VALUES ('client_onboarding', 'automation', 'done', NOW(), NOW(), $1)`,
    [JSON.stringify({ client_id: body.client_id, service_type: body.service_type, deal_id: body.deal_id })]
  )

  return c.json({ ok: true })
})

// ── POST /webhooks/user-created ───────────────────────────────────────────────
// n8n employee_onboarding workflow calls this after creating tasks and sending welcome message

app.post('/webhooks/user-created', async (c) => {
  if (!hasValidSecret(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ user_id: string; role: string }>()
  if (!body.user_id) return c.json({ error: 'user_id required' }, 400)

  await query(
    `INSERT INTO system_jobs (name, type, status, started_at, completed_at, payload)
     VALUES ('employee_onboarding', 'automation', 'done', NOW(), NOW(), $1)`,
    [JSON.stringify({ user_id: body.user_id, role: body.role })]
  )

  return c.json({ ok: true })
})

export default app
