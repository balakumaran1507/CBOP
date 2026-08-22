import { Hono }        from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query }       from '../lib/db'
import { sendEmail, isSuppressed, suppress } from '../lib/mailer'
import { createHmac }  from 'node:crypto'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── Tokens (HMAC, company-scoped - no token storage needed) ──────────────────
const SECRET = process.env.BETTER_AUTH_SECRET ?? 'cbop-subscriber-secret'
function tokenFor(email: string, companyId: string, purpose: 'confirm' | 'unsub'): string {
  return createHmac('sha256', SECRET).update(`${purpose}:${companyId}:${email.toLowerCase()}`).digest('hex').slice(0, 32)
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003'

// A small branded HTML shell for the public confirm/unsub pages.
function page(title: string, bodyHtml: string, code = 200) {
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f2f3f3}
    .box{background:#fff;border-radius:8px;padding:40px 48px;text-align:center;max-width:420px;border:1px solid #d5dbdb;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    h2{font-family:Syne,sans-serif;color:#232f3e;margin:0 0 12px}p{color:#666;margin:0;line-height:1.5}
    a.btn{display:inline-block;margin-top:18px;background:#0073BB;color:#fff;text-decoration:none;padding:9px 18px;border-radius:6px}</style>
    </head><body><div class="box"><h2>${title}</h2>${bodyHtml}</div></body></html>`,
    { status: code, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED - lists + subscribers + suppression management (CEO/COO)
// ════════════════════════════════════════════════════════════════════════════

// ── Lists ─────────────────────────────────────────────────────────────────────
app.get('/api/lists', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT l.*, c.name AS company_name,
            (SELECT count(*) FROM email_list_members m WHERE m.list_id = l.id) AS member_count
     FROM email_lists l JOIN companies c ON c.id = l.company_id
     WHERE l.company_id = ANY($1) ORDER BY l.created_at DESC`, [companyIds])
  return c.json(rows)
})

app.post('/api/lists', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const { company_id, name, description, double_optin } = await c.req.json() as
    { company_id: string; name: string; description?: string; double_optin?: boolean }
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!name) return c.json({ error: 'name is required' }, 400)
  const { rows: [list] } = await query(
    `INSERT INTO email_lists (company_id, name, description, double_optin, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [company_id, name, description ?? null, double_optin ?? false, userId])

  await writeMutationAuditLog(c, {
    table: 'email_lists', op: 'create', id: list.id, after: list, companyId: company_id,
  })

  return c.json(list, 201)
})

app.delete('/api/lists/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const { rows: [existing] } = await query(
    `SELECT * FROM email_lists WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])

  await query(`DELETE FROM email_lists WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds])

  if (existing) {
    await writeMutationAuditLog(c, {
      table: 'email_lists', op: 'delete', id, before: existing, companyId: existing.company_id,
    })
  }

  return c.json({ ok: true })
})

// ── Subscribers ────────────────────────────────────────────────────────────────
app.get('/api/subscribers', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const status = c.req.query('status')
  const listId = c.req.query('list_id')
  const params: any[] = [companyIds]
  let sql = `SELECT s.*, c.name AS company_name FROM email_subscribers s
             JOIN companies c ON c.id = s.company_id WHERE s.company_id = ANY($1)`
  if (status) { params.push(status); sql += ` AND s.status = $${params.length}` }
  if (listId) { params.push(listId); sql += ` AND s.id IN (SELECT subscriber_id FROM email_list_members WHERE list_id = $${params.length})` }
  sql += ` ORDER BY s.created_at DESC LIMIT 1000`
  const { rows } = await query(sql, params)
  return c.json(rows)
})

app.get('/api/subscribers/stats', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT status, count(*)::int AS n FROM email_subscribers
     WHERE company_id = ANY($1) GROUP BY status`, [companyIds])
  const { rows: [supp] } = await query(
    `SELECT count(*)::int AS n FROM email_suppression
     WHERE company_id = ANY($1) OR company_id IS NULL`, [companyIds])
  return c.json({ by_status: rows, suppressed: supp?.n ?? 0 })
})

app.post('/api/subscribers', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { company_id, email, name, list_id } = await c.req.json() as
    { company_id: string; email: string; name?: string; list_id?: string }
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!EMAIL_REGEX.test(email ?? '')) return c.json({ error: 'Invalid email' }, 400)
  const { rows: [sub] } = await query(
    `INSERT INTO email_subscribers (company_id, email, name, status, source, confirmed_at)
     VALUES ($1,$2,$3,'subscribed','manual',NOW())
     ON CONFLICT (company_id, email) DO UPDATE SET name = COALESCE(EXCLUDED.name, email_subscribers.name)
     RETURNING *`, [company_id, email.toLowerCase(), name ?? null])
  if (list_id) {
    await query(`INSERT INTO email_list_members (list_id, subscriber_id) VALUES ($1,$2)
                 ON CONFLICT DO NOTHING`, [list_id, sub.id])
  }

  await writeMutationAuditLog(c, {
    table: 'email_subscribers', op: 'create', id: sub.id, after: sub, companyId: company_id,
  })

  return c.json(sub, 201)
})

// Bulk import - raw lines "Name <email>" / "name,email" / "email"
app.post('/api/subscribers/import', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { company_id, raw, list_id } = await c.req.json() as
    { company_id: string; raw: string; list_id?: string }
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!raw) return c.json({ error: 'raw is required' }, 400)

  const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
  let added = 0, skipped = 0
  for (const line of lines) {
    const bracket = line.match(/^(.+?)\s*<([^>]+)>$/)
    const comma   = line.lastIndexOf(',')
    let email = '', name = ''
    if (bracket) { name = bracket[1].trim(); email = bracket[2].trim().toLowerCase() }
    else if (comma > 0 && EMAIL_REGEX.test(line.slice(comma + 1).trim())) { name = line.slice(0, comma).trim(); email = line.slice(comma + 1).trim().toLowerCase() }
    else if (EMAIL_REGEX.test(line)) { email = line.toLowerCase() }
    if (!email) { skipped++; continue }
    const { rows: [sub] } = await query(
      `INSERT INTO email_subscribers (company_id, email, name, status, source, confirmed_at)
       VALUES ($1,$2,$3,'subscribed','import',NOW())
       ON CONFLICT (company_id, email) DO NOTHING RETURNING id`,
      [company_id, email, name || null])
    if (sub && list_id) {
      await query(`INSERT INTO email_list_members (list_id, subscriber_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [list_id, sub.id])
    }
    sub ? added++ : skipped++
  }

  await writeMutationAuditLog(c, {
    table: 'email_subscribers', op: 'create', id: null,
    after: { added, skipped, total: lines.length, list_id: list_id ?? null }, companyId: company_id,
  })

  return c.json({ added, skipped, total: lines.length })
})

app.patch('/api/subscribers/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { name, status } = await c.req.json() as { name?: string; status?: string }

  const { rows: [before] } = await query(
    `SELECT * FROM email_subscribers WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!before) return c.json({ error: 'Not found' }, 404)

  const { rows: [sub] } = await query(
    `UPDATE email_subscribers SET
       name   = COALESCE($2, name),
       status = COALESCE($3, status)
     WHERE id = $1 AND company_id = ANY($4) RETURNING *`,
    [id, name ?? null, status ?? null, companyIds])
  if (!sub) return c.json({ error: 'Not found' }, 404)

  await writeMutationAuditLog(c, {
    table: 'email_subscribers', op: 'update', id, before, after: sub, companyId: sub.company_id,
  })

  return c.json(sub)
})

app.delete('/api/subscribers/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const { rows: [existing] } = await query(
    `SELECT * FROM email_subscribers WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])

  await query(`DELETE FROM email_subscribers WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds])

  if (existing) {
    await writeMutationAuditLog(c, {
      table: 'email_subscribers', op: 'delete', id, before: existing, companyId: existing.company_id,
    })
  }

  return c.json({ ok: true })
})

// ── Suppression management ──────────────────────────────────────────────────────
app.get('/api/suppression', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT * FROM email_suppression
     WHERE company_id = ANY($1) OR company_id IS NULL
     ORDER BY created_at DESC LIMIT 1000`, [companyIds])
  return c.json(rows)
})

// Manually re-allow an address (removes from suppression). CEO only - deliberate.
app.delete('/api/suppression/:email', requireAuth, requireRole('ceo'), async (c) => {
  const email = decodeURIComponent(c.req.param('email') ?? '').toLowerCase()
  await query(`DELETE FROM email_suppression WHERE email = $1`, [email])
  await query(`DELETE FROM email_unsubscribes WHERE email = $1`, [email])

  await writeMutationAuditLog(c, {
    table: 'email_suppression', op: 'delete', id: email, before: { email }, companyId: null,
  })

  return c.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC - subscribe / confirm / unsubscribe (no auth)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/public/subscribe  { company_id, email, name? }
app.post('/api/public/subscribe', async (c) => {
  const { company_id, email, name } = await c.req.json().catch(() => ({})) as
    { company_id?: string; email?: string; name?: string }
  if (!company_id || !EMAIL_REGEX.test(email ?? '')) return c.json({ error: 'Valid email and company_id required' }, 400)
  const addr = email!.toLowerCase()

  const { rows: [company] } = await query(
    `SELECT c.name, l.double_optin FROM companies c
     LEFT JOIN email_lists l ON l.company_id = c.id
     WHERE c.id = $1 LIMIT 1`, [company_id])
  if (!company) return c.json({ error: 'Unknown company' }, 404)

  if (await isSuppressed(addr, company_id)) {
    // allow re-subscribe: clear suppression on explicit opt-in
    await query(`DELETE FROM email_suppression WHERE email = $1 AND (company_id = $2 OR company_id IS NULL)`, [addr, company_id])
  }

  const doubleOptin = Boolean(company.double_optin)
  const status = doubleOptin ? 'pending' : 'subscribed'
  await query(
    `INSERT INTO email_subscribers (company_id, email, name, status, source)
     VALUES ($1,$2,$3,$4,'signup_form')
     ON CONFLICT (company_id, email) DO UPDATE SET
       status = CASE WHEN email_subscribers.status = 'unsubscribed' THEN $4 ELSE email_subscribers.status END,
       name   = COALESCE(EXCLUDED.name, email_subscribers.name)`,
    [company_id, addr, name ?? null, status])
  // Single opt-in is confirmed immediately.
  if (!doubleOptin) await query(`UPDATE email_subscribers SET confirmed_at = NOW() WHERE company_id=$1 AND email=$2 AND confirmed_at IS NULL`, [company_id, addr])

  if (doubleOptin) {
    const token = tokenFor(addr, company_id, 'confirm')
    const confirmUrl = `${appUrl()}/api/public/confirm?company=${company_id}&email=${encodeURIComponent(addr)}&token=${token}`
    await sendEmail({
      to: addr,
      companyId: company_id,
      kind: 'transactional',
      subject: `Confirm your subscription to ${company.name}`,
      html: `<p>Hi${name ? ' ' + name : ''},</p><p>Please confirm you want to receive emails from <b>${company.name}</b>.</p>
             <p><a href="${confirmUrl}" style="background:#0073BB;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Confirm subscription</a></p>
             <p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p>`,
      respectSuppression: false,
    })
    return c.json({ ok: true, status: 'pending', message: 'Confirmation email sent.' })
  }
  return c.json({ ok: true, status: 'subscribed' })
})

// GET /api/public/confirm - double opt-in confirmation
app.get('/api/public/confirm', async (c) => {
  const company = c.req.query('company') ?? ''
  const email   = (c.req.query('email') ?? '').toLowerCase()
  const token   = c.req.query('token') ?? ''
  if (!company || !email || token !== tokenFor(email, company, 'confirm')) {
    return page('Invalid link', '<p>This confirmation link is invalid or expired.</p>', 400)
  }
  await query(
    `UPDATE email_subscribers SET status = 'subscribed', confirmed_at = NOW()
     WHERE company_id = $1 AND email = $2`, [company, email])
  return page('Subscription confirmed', `<p><b>${email}</b> is now subscribed. Thank you!</p>`)
})

// GET /api/public/unsubscribe - one-click unsubscribe (List-Unsubscribe target)
app.get('/api/public/unsubscribe', async (c) => {
  const company = c.req.query('company') ?? ''
  const email   = (c.req.query('email') ?? '').toLowerCase()
  const token   = c.req.query('token') ?? ''
  if (!email || (company && token !== tokenFor(email, company, 'unsub'))) {
    return page('Invalid link', '<p>This unsubscribe link is invalid.</p>', 400)
  }
  await suppress(email, 'unsubscribe', company || null)
  await query(`INSERT INTO email_unsubscribes (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [email])
  await query(`UPDATE email_subscribers SET status='unsubscribed', unsubscribed_at=NOW() WHERE email=$1`, [email]).catch(() => {})
  return page('Unsubscribed', `<p><b>${email}</b> has been removed from our mailing list. You won't receive further emails.</p>`)
})

// POST target for RFC 8058 one-click (List-Unsubscribe-Post)
app.post('/api/public/unsubscribe', async (c) => {
  const company = c.req.query('company') ?? ''
  const email   = (c.req.query('email') ?? '').toLowerCase()
  const token   = c.req.query('token') ?? ''
  if (!email || (company && token !== tokenFor(email, company, 'unsub'))) {
    return c.json({ error: 'Invalid link' }, 400)
  }
  await suppress(email, 'unsubscribe', company || null)
  await query(`INSERT INTO email_unsubscribes (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [email])
  await query(`UPDATE email_subscribers SET status='unsubscribed', unsubscribed_at=NOW() WHERE email=$1`, [email]).catch(() => {})
  return c.json({ ok: true })
})

// Helper exported for campaigns: build a company-scoped unsub token.
export function subscriberUnsubToken(email: string, companyId: string): string {
  return tokenFor(email, companyId, 'unsub')
}

export default app
