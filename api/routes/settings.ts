import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query, transaction } from '../lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest, writeAuthzDenial } from '../lib/audit-log'
import { refreshCompanyBrandCache } from '../lib/company-brand'
import { ALL_MODULE_KEYS } from '../lib/modules'
import '../lib/hono-vars'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'node:crypto'
import { hashPassword } from '@better-auth/utils/password'
import { sendEmail } from '../lib/mailer'

const app = new Hono()

// invoice_prefix format: short uppercase alnum code, e.g. ETH / PEN / CYB / ATK.
// Must stay short - it's embedded in every invoice number (ETH-2026-0001).
const invoicePrefixSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'invoice_prefix must be 2-6 uppercase letters/digits, starting with a letter (e.g. ETH)')

const createCompanySchema = z.object({
  name:           z.string().trim().min(1, 'name is required'),
  invoice_prefix: invoicePrefixSchema,
  type:           z.string().trim().min(1).optional(),
  gstin:          z.string().trim().min(1).optional(),
  upi_id:         z.string().trim().min(1).optional(),
  bank_details:   z.record(z.unknown()).optional(),
  address:        z.string().trim().min(1).optional(),
})

// Postgres unique_violation - see https://www.postgresql.org/docs/current/errcodes-appendix.html
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

/**
 * Creator-only guard for the routes that check the role inline instead of
 * going through requireRole. Records the denial the same way require-role does
 * so no 403 in this file is invisible to the audit trail.
 *
 *   if (!isCreator(c)) return forbidCreatorOnly(c)
 */
function isCreator(c: Context): boolean {
  return c.get('role') === 'creator'
}

function forbidCreatorOnly(c: Context) {
  writeAuthzDenial(c, {
    action: AUDIT_ACTIONS.authzRoleDenied,
    reason: 'creator_only_route',
    detail: { actor_role: c.get('role') ?? null, required_roles: ['creator'] },
  })
  return c.json({ error: 'Forbidden: creator only' }, 403)
}

/** Record an admin action. Awaited — admin writes are rare and must not be lost. */
async function logAdminAction(
  c: Context,
  entry: { action: string; resourceType: string; resourceId?: string | null; before?: unknown; after?: unknown; companyId?: string | null }
): Promise<void> {
  await writeAuditLogForRequest(c, entry)
}

// ── GET /api/settings/users ──────────────────────────────────────────────────

app.get('/api/settings/users', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const callerRole     = c.get('role')
  const callerCompanyIds: string[] = c.get('companyIds')

  // creator sees all users; everyone else is scoped to their own companies
  const result = callerRole === 'creator'
    ? await query(
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
    : await query(
        `SELECT u.id, u.name, u.email, u.role, u.telegram_chat_id, u.whatsapp_number,
                u.is_active, u.created_at,
                array_agg(uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) AS company_ids,
                array_agg(co.name ORDER BY co.name) FILTER (WHERE co.name IS NOT NULL) AS company_names
         FROM users u
         LEFT JOIN user_companies uc ON uc.user_id = u.id
         LEFT JOIN companies co ON co.id = uc.company_id
         WHERE EXISTS (
           SELECT 1 FROM user_companies uc2
           WHERE uc2.user_id = u.id AND uc2.company_id = ANY($1)
         )
         GROUP BY u.id
         ORDER BY u.created_at ASC`,
        [callerCompanyIds]
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

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminUserCreate,
    resourceType: 'user',
    resourceId:   user.id as string,
    after:        { ...user, company_ids },
  })

  return c.json({ user }, 201)
})

// ── PATCH /api/settings/users/:id ───────────────────────────────────────────
// CEO-only: update name/role/telegram/whatsapp/is_active/companies

app.patch('/api/settings/users/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id             = c.req.param('id')
  const callerRole     = c.get('role')
  const callerCompanyIds: string[] = c.get('companyIds')
  const body           = await c.req.json()
  const { name, role, telegram_chat_id, whatsapp_number, is_active, company_ids } = body

  // ── Role allowlist — must match POST guard; 'creator' is never assignable via API ──
  if (role !== undefined && !['ceo', 'coo', 'cto'].includes(role)) {
    return c.json({ error: 'Invalid role' }, 400)
  }

  if (company_ids !== undefined && (!Array.isArray(company_ids) || company_ids.length === 0)) {
    return c.json({ error: 'company_ids must include at least one company' }, 400)
  }

  // ── Ownership check — creator can modify any user; CEO scoped to their companies ──
  if (callerRole !== 'creator') {
    const ownerCheck = await query(
      `SELECT 1 FROM user_companies WHERE user_id = $1 AND company_id = ANY($2) LIMIT 1`,
      [id, callerCompanyIds]
    )
    if (ownerCheck.rows.length === 0) {
      writeAuthzDenial(c, {
        action:       AUDIT_ACTIONS.authzRoleDenied,
        reason:       'target_user_outside_caller_companies',
        resourceType: 'user',
        resourceId:   id,
      })
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  // Snapshot for the audit trail — a role or is_active change must be
  // reconstructable from the log alone, without diffing backups.
  const beforeRes = await query(
    `SELECT u.id, u.name, u.email, u.role, u.telegram_chat_id, u.whatsapp_number, u.is_active,
            array_agg(uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) AS company_ids
     FROM users u
     LEFT JOIN user_companies uc ON uc.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id]
  )
  const before = beforeRes.rows[0] ?? null

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
    // Scope assignable companies to what the caller can see; creator can assign any
    const safeIds = callerRole === 'creator'
      ? (company_ids as string[])
      : (company_ids as string[]).filter((cid) => callerCompanyIds.includes(cid))
    if (safeIds.length === 0) return c.json({ error: 'No valid companies in company_ids' }, 400)

    await query(`DELETE FROM user_companies WHERE user_id = $1`, [id])
    for (const cid of safeIds) {
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

  await logAdminAction(c, {
    action:       role !== undefined ? AUDIT_ACTIONS.adminUserRoleChange : AUDIT_ACTIONS.adminUserUpdate,
    resourceType: 'user',
    resourceId:   id,
    before,
    after:        company_ids !== undefined ? { ...user, company_ids } : user,
  })

  return c.json({ user })
})

// ── GET /api/settings/companies ──────────────────────────────────────────────

app.get('/api/settings/companies', requireAuth, requireRole('ceo'), async (c) => {
  const result = await query(
    `SELECT id, name, type, gstin, upi_id, bank_details, invoice_prefix, address, company_seal, logo_initials, logo_url, is_active, created_at
     FROM companies ORDER BY name`,
    []
  )
  return c.json({ companies: result.rows })
})

// ── POST /api/settings/companies ─────────────────────────────────────────────
// CEO-only: onboard a new company. This used to require hand-written SQL plus
// manual edits to hardcoded company/UUID maps scattered across the codebase -
// see api/lib/company-brand.ts and companyIdForDomain() in api/lib/mailer.ts
// for the lookups this now flows into automatically.

app.post('/api/settings/companies', requireAuth, requireRole('ceo'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = createCompanySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400)
  }
  const { name, invoice_prefix, type, gstin, upi_id, bank_details, address } = parsed.data

  const existing = await query(`SELECT 1 FROM companies WHERE invoice_prefix = $1`, [invoice_prefix])
  if (existing.rows.length > 0) {
    return c.json({ error: `invoice_prefix "${invoice_prefix}" is already in use` }, 409)
  }

  try {
    const result = await query(
      `INSERT INTO companies (name, type, gstin, upi_id, bank_details, invoice_prefix, address, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, name, type, gstin, upi_id, bank_details, invoice_prefix, address, company_seal, logo_initials, logo_url, is_active, created_at`,
      [
        name,
        type ?? null,
        gstin ?? null,
        upi_id ?? null,
        bank_details ? JSON.stringify(bank_details) : null,
        invoice_prefix,
        address ?? null,
      ]
    )
    await logAdminAction(c, {
      action:       AUDIT_ACTIONS.adminCompanyCreate,
      resourceType: 'company',
      resourceId:   result.rows[0].id as string,
      companyId:    result.rows[0].id as string,
      after:        result.rows[0],
    })
    return c.json({ company: result.rows[0] }, 201)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: `invoice_prefix "${invoice_prefix}" is already in use` }, 409)
    }
    throw err
  }
})

// ── PATCH /api/settings/companies/:id ───────────────────────────────────────
// CEO-only: update company details, including invoice_prefix (blocked once the
// company has invoices - changing it after the fact breaks the numbering
// sequence) and is_active (deactivation - the safe alternative to deleting a
// company, since every FK to companies(id) is ON DELETE CASCADE).

app.patch('/api/settings/companies/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, type, gstin, upi_id, bank_details, address, company_seal, logo_initials, invoice_prefix, is_active } = body

  const beforeRes = await query(
    `SELECT id, name, type, gstin, upi_id, bank_details, invoice_prefix, address,
            company_seal, logo_initials, logo_url, is_active
     FROM companies WHERE id = $1`,
    [id]
  )
  const before = beforeRes.rows[0] ?? null

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (name         !== undefined) { sets.push(`name = $${p++}`);         params.push(name) }
  if (type         !== undefined) { sets.push(`type = $${p++}`);         params.push(type) }
  if (gstin        !== undefined) { sets.push(`gstin = $${p++}`);        params.push(gstin) }
  if (upi_id       !== undefined) { sets.push(`upi_id = $${p++}`);       params.push(upi_id) }
  if (bank_details !== undefined) { sets.push(`bank_details = $${p++}`); params.push(JSON.stringify(bank_details)) }
  if (address      !== undefined) { sets.push(`address = $${p++}`);      params.push(address || null) }
  if (company_seal    !== undefined) { sets.push(`company_seal = $${p++}`);    params.push(company_seal || null) }
  if (logo_initials   !== undefined) { sets.push(`logo_initials = $${p++}`);   params.push(logo_initials || null) }
  if (is_active        !== undefined) { sets.push(`is_active = $${p++}`);      params.push(!!is_active) }

  if (invoice_prefix !== undefined) {
    const prefixCheck = invoicePrefixSchema.safeParse(invoice_prefix)
    if (!prefixCheck.success) {
      return c.json({ error: prefixCheck.error.issues[0]?.message ?? 'Invalid invoice_prefix' }, 400)
    }
    const normalized = prefixCheck.data

    const invoiced = await query(`SELECT 1 FROM sales_invoices WHERE company_id = $1 LIMIT 1`, [id])
    if (invoiced.rows.length > 0) {
      return c.json({ error: 'Cannot change invoice_prefix: this company already has invoices. Changing it now would break the invoice numbering sequence.' }, 409)
    }

    const dupe = await query(`SELECT 1 FROM companies WHERE invoice_prefix = $1 AND id != $2`, [normalized, id])
    if (dupe.rows.length > 0) {
      return c.json({ error: `invoice_prefix "${normalized}" is already in use` }, 409)
    }

    sets.push(`invoice_prefix = $${p++}`)
    params.push(normalized)
  }

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  params.push(id)
  let result
  try {
    result = await query(
      `UPDATE companies SET ${sets.join(', ')} WHERE id = $${p}
       RETURNING id, name, type, gstin, upi_id, bank_details, invoice_prefix, address, company_seal, logo_initials, logo_url, is_active`,
      params
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'invoice_prefix is already in use' }, 409)
    }
    throw err
  }

  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)

  // Brand cache keys off logo_initials/email_branding - refresh so hiring
  // emails pick up the edit immediately instead of waiting out the TTL.
  if (logo_initials !== undefined) void refreshCompanyBrandCache()

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminCompanyUpdate,
    resourceType: 'company',
    resourceId:   id,
    companyId:    id,
    before,
    after:        result.rows[0],
  })

  return c.json({ company: result.rows[0] })
})

// ── POST /api/settings/companies/:id/logo ────────────────────────────────────

app.post('/api/settings/companies/:id/logo', requireAuth, requireRole('ceo'), async (c) => {
  const id       = c.req.param('id')
  const formData = await c.req.formData()
  const file     = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  if (!allowed.includes(file.type)) return c.json({ error: 'Only JPEG, PNG, WebP, SVG allowed' }, 400)

  const ext   = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const fname = `company-${id}.${ext}`
  const dir   = path.join(process.cwd(), 'uploads', 'logos')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  const logoUrl = `/api/uploads/logos/${fname}`
  await query(`UPDATE companies SET logo_url = $1 WHERE id = $2`, [logoUrl, id])

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminCompanyBranding,
    resourceType: 'company',
    resourceId:   id,
    companyId:    id,
    after:        { field: 'logo_url', logo_url: logoUrl, filename: file.name, content_type: file.type },
  })

  return c.json({ logo_url: logoUrl })
})

// ── POST /api/settings/companies/:id/seal ────────────────────────────────────

app.post('/api/settings/companies/:id/seal', requireAuth, requireRole('ceo'), async (c) => {
  const id       = c.req.param('id')
  const formData = await c.req.formData()
  const file     = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  if (!['image/png', 'image/webp', 'image/svg+xml'].includes(file.type))
    return c.json({ error: 'Only PNG, WebP, SVG allowed (transparent background)' }, 400)

  const ext   = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const fname = `seal-${id}.${ext}`
  const dir   = path.join(process.cwd(), 'uploads', 'seals')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  const sealUrl = `/api/uploads/seals/${fname}`
  await query(`UPDATE companies SET company_seal = $1 WHERE id = $2`, [sealUrl, id])

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminCompanyBranding,
    resourceType: 'company',
    resourceId:   id,
    companyId:    id,
    after:        { field: 'company_seal', company_seal: sealUrl, filename: file.name, content_type: file.type },
  })

  return c.json({ company_seal: sealUrl })
})

// ── GET /api/settings/jobs ───────────────────────────────────────────────────

app.get('/api/settings/jobs', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
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

app.post('/api/settings/jobs/:id/retry', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
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
// Returns masked env var values - no editing in UI

app.get('/api/settings/integrations', requireAuth, requireRole('ceo'), async (c) => {
  // Reading the integration config — even masked — is an admin action worth
  // evidencing: it is the page that enumerates every external system CBOP
  // holds credentials for.
  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminIntegrationsRead,
    resourceType: 'integrations',
    resourceId:   'settings.integrations',
  })

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
          { key: 'OPENCLAW_URL',     label: 'OpenClaw URL',     value: mask(process.env.OPENCLAW_URL, false), sensitive: false },
          { key: 'OPENCLAW_API_KEY', label: 'OpenClaw API Key', value: mask(process.env.OPENCLAW_API_KEY),   sensitive: true  },
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

// ── GET /api/settings/signatures ────────────────────────────────────────────
// Returns all email signatures for companies the user can access

app.get('/api/settings/signatures', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT es.*, co.name AS company_name
     FROM email_signatures es
     LEFT JOIN companies co ON co.id = es.company_id
     WHERE es.company_id = ANY($1) OR es.company_id IS NULL
     ORDER BY es.created_at DESC`,
    [companyIds]
  )
  return c.json({ signatures: result.rows })
})

// ── POST /api/settings/signatures ───────────────────────────────────────────

app.post('/api/settings/signatures', requireAuth, requireRole('ceo'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, html, company_id, is_default, variables } = body

  if (!name) return c.json({ error: 'name is required' }, 400)
  if (company_id && !(companyIds as string[]).includes(company_id)) {
    return c.json({ error: 'Company not in scope' }, 403)
  }

  // If setting as default, clear existing default for that company
  if (is_default) {
    await query(
      `UPDATE email_signatures SET is_default = false WHERE company_id = $1`,
      [company_id ?? null]
    )
  }

  const result = await query(
    `INSERT INTO email_signatures (company_id, name, html, is_default, variables, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [company_id ?? null, name, html ?? '', !!is_default, variables ?? [], userId]
  )
  return c.json({ signature: result.rows[0] }, 201)
})

// ── PATCH /api/settings/signatures/:id ──────────────────────────────────────

app.patch('/api/settings/signatures/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()
  const { name, html, is_default, variables } = body

  const existing = await query(
    `SELECT id, company_id FROM email_signatures WHERE id = $1`,
    [id]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const sig = existing.rows[0]
  if (sig.company_id && !(companyIds as string[]).includes(sig.company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (is_default) {
    await query(
      `UPDATE email_signatures SET is_default = false WHERE company_id = $1 AND id != $2`,
      [sig.company_id, id]
    )
  }

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (name      !== undefined) { fields.push(`name = $${idx++}`);      values.push(name) }
  if (html      !== undefined) { fields.push(`html = $${idx++}`);      values.push(html) }
  if (is_default !== undefined) { fields.push(`is_default = $${idx++}`); values.push(!!is_default) }
  if (variables !== undefined) { fields.push(`variables = $${idx++}`); values.push(variables) }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE email_signatures SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} RETURNING *`,
    values
  )
  return c.json({ signature: result.rows[0] })
})

// ── DELETE /api/settings/signatures/:id ─────────────────────────────────────

app.delete('/api/settings/signatures/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const existing = await query(
    `SELECT id, company_id FROM email_signatures WHERE id = $1`,
    [id]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const sig = existing.rows[0]
  if (sig.company_id && !(companyIds as string[]).includes(sig.company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await query(`DELETE FROM email_signatures WHERE id = $1`, [id])
  return c.json({ ok: true })
})

// ── GET /api/settings/templates ─────────────────────────────────────────────
// Filtered view of the templates table for the settings studios.
// ?output_type=email   → Email Template Studio
// ?output_type=pdf     → Document Template Studio

app.get('/api/settings/templates', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const outputType  = c.req.query('output_type')   // 'email' | 'pdf'
  const category    = c.req.query('category')

  const conditions: string[] = ['t.company_id = ANY($1)']
  const params: unknown[]    = [companyIds]

  if (outputType === 'email') {
    params.push('email'); conditions.push(`t.output_type = ANY(ARRAY[$${params.length}, 'both'])`)
  } else if (outputType === 'pdf') {
    params.push('pdf'); conditions.push(`t.output_type = ANY(ARRAY[$${params.length}, 'both'])`)
  }

  if (category) {
    params.push(category); conditions.push(`t.category = $${params.length}`)
  }

  const result = await query(
    `SELECT t.id, t.name, t.type, t.output_type, t.subject, t.category,
            t.variables, t.slug, t.version, t.updated_at, t.created_at,
            c.name AS company_name, c.id AS company_id
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.updated_at DESC`,
    params
  )
  return c.json({ templates: result.rows })
})

// ── POST /api/settings/templates ────────────────────────────────────────────
// Lightweight template creation from settings (plain text body, no Tiptap JSON).

app.post('/api/settings/templates', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, type, output_type, subject, category, content, variables, company_id } = body

  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!(companyIds as string[]).includes(company_id)) return c.json({ error: 'Company not in scope' }, 403)

  const effectiveOutputType = output_type ?? (type === 'email' ? 'email' : 'pdf')

  const result = await query(
    `INSERT INTO templates
       (company_id, name, type, output_type, subject, category, content, variables, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     RETURNING id, name, type, output_type, subject, category, variables, version, created_at, updated_at`,
    [
      company_id,
      name,
      type ?? (effectiveOutputType === 'email' ? 'email' : 'contract'),
      effectiveOutputType,
      subject ?? null,
      category ?? null,
      content ?? '',
      JSON.stringify(variables ?? []),
    ]
  )
  return c.json({ template: result.rows[0] }, 201)
})

// ── PATCH /api/settings/templates/:id ───────────────────────────────────────

app.patch('/api/settings/templates/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()

  const existing = await query(
    `SELECT id FROM templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (body.name        !== undefined) { fields.push(`name = $${idx++}`);        values.push(body.name) }
  if (body.subject     !== undefined) { fields.push(`subject = $${idx++}`);     values.push(body.subject || null) }
  if (body.category    !== undefined) { fields.push(`category = $${idx++}`);    values.push(body.category || null) }
  if (body.type        !== undefined) { fields.push(`type = $${idx++}`);        values.push(body.type) }
  if (body.output_type !== undefined) { fields.push(`output_type = $${idx++}`); values.push(body.output_type) }
  if (body.content     !== undefined) { fields.push(`content = $${idx++}`);     values.push(body.content) }
  if (body.variables   !== undefined) { fields.push(`variables = $${idx++}`);   values.push(JSON.stringify(body.variables)) }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE templates SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}
     RETURNING id, name, type, output_type, subject, category, variables, version, updated_at`,
    values
  )
  return c.json({ template: result.rows[0] })
})

// ── DELETE /api/settings/templates/:id ──────────────────────────────────────

app.delete('/api/settings/templates/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const existing = await query(
    `SELECT id FROM templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  await query(`DELETE FROM templates WHERE id = $1`, [id])
  return c.json({ ok: true })
})

// ── GET /api/settings/automation-rules ──────────────────────────────────────

app.get('/api/settings/automation-rules', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT ar.*, co.name AS company_name
     FROM automation_rules ar
     JOIN companies co ON co.id = ar.company_id
     WHERE ar.company_id = ANY($1)
     ORDER BY ar.created_at DESC`,
    [companyIds]
  )
  return c.json({ rules: result.rows })
})

// ── POST /api/settings/automation-rules ─────────────────────────────────────

app.post('/api/settings/automation-rules', requireAuth, requireRole('ceo'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, company_id, trigger_type, trigger_condition, action_type, action_config, is_active } = body

  if (!name)         return c.json({ error: 'name is required' }, 400)
  if (!company_id)   return c.json({ error: 'company_id is required' }, 400)
  if (!trigger_type) return c.json({ error: 'trigger_type is required' }, 400)
  if (!action_type)  return c.json({ error: 'action_type is required' }, 400)
  if (!(companyIds as string[]).includes(company_id)) return c.json({ error: 'Company not in scope' }, 403)

  const result = await query(
    `INSERT INTO automation_rules
       (company_id, name, trigger_type, trigger_condition, action_type, action_config, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      company_id, name, trigger_type,
      JSON.stringify(trigger_condition ?? {}),
      action_type,
      JSON.stringify(action_config ?? {}),
      is_active !== false,
      userId,
    ]
  )
  return c.json({ rule: result.rows[0] }, 201)
})

// ── PATCH /api/settings/automation-rules/:id ────────────────────────────────

app.patch('/api/settings/automation-rules/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()

  const existing = await query(
    `SELECT id, company_id FROM automation_rules WHERE id = $1`,
    [id]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!(companyIds as string[]).includes(existing.rows[0].company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (body.name              !== undefined) { fields.push(`name = $${idx++}`);              values.push(body.name) }
  if (body.trigger_type      !== undefined) { fields.push(`trigger_type = $${idx++}`);      values.push(body.trigger_type) }
  if (body.trigger_condition !== undefined) { fields.push(`trigger_condition = $${idx++}`); values.push(JSON.stringify(body.trigger_condition)) }
  if (body.action_type       !== undefined) { fields.push(`action_type = $${idx++}`);       values.push(body.action_type) }
  if (body.action_config     !== undefined) { fields.push(`action_config = $${idx++}`);     values.push(JSON.stringify(body.action_config)) }
  if (body.is_active         !== undefined) { fields.push(`is_active = $${idx++}`);         values.push(!!body.is_active) }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE automation_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  )
  return c.json({ rule: result.rows[0] })
})

// ── DELETE /api/settings/automation-rules/:id ───────────────────────────────

app.delete('/api/settings/automation-rules/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const existing = await query(
    `SELECT id, company_id FROM automation_rules WHERE id = $1`,
    [id]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!(companyIds as string[]).includes(existing.rows[0].company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await query(`DELETE FROM automation_rules WHERE id = $1`, [id])
  return c.json({ ok: true })
})

// ── GET /api/settings/hiring ─────────────────────────────────────────────────
// Returns hiring settings for all companies (CEO-only)

app.get('/api/settings/hiring', requireAuth, requireRole('ceo'), async (c) => {
  const result = await query(
    `SELECT hs.*, c.name AS company_name
     FROM hiring_settings hs
     JOIN companies c ON c.id = hs.company_id
     ORDER BY c.name`,
    []
  )
  return c.json({ settings: result.rows })
})

// ── PUT /api/settings/hiring/:companyId ──────────────────────────────────────
// Upserts hiring settings for a specific company (CEO-only)

app.put('/api/settings/hiring/:companyId', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId')
  const body = await c.req.json()
  const {
    rejection_delay_hours,
    auto_reject_threshold,
    auto_shortlist_threshold,
    slack_workspace_invite_url,
    discord_invite_url,
    google_calendar_id,
    rejection_email_template,
    interview_email_template,
    offer_email_template,
    welcome_email_template,
  } = body

  const result = await query(
    `INSERT INTO hiring_settings (
       company_id, rejection_delay_hours, auto_reject_threshold, auto_shortlist_threshold,
       slack_workspace_invite_url, discord_invite_url, google_calendar_id,
       rejection_email_template, interview_email_template, offer_email_template, welcome_email_template,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       rejection_delay_hours     = EXCLUDED.rejection_delay_hours,
       auto_reject_threshold     = EXCLUDED.auto_reject_threshold,
       auto_shortlist_threshold  = EXCLUDED.auto_shortlist_threshold,
       slack_workspace_invite_url= EXCLUDED.slack_workspace_invite_url,
       discord_invite_url        = EXCLUDED.discord_invite_url,
       google_calendar_id        = EXCLUDED.google_calendar_id,
       rejection_email_template  = EXCLUDED.rejection_email_template,
       interview_email_template  = EXCLUDED.interview_email_template,
       offer_email_template      = EXCLUDED.offer_email_template,
       welcome_email_template    = EXCLUDED.welcome_email_template,
       updated_at                = NOW()
     RETURNING *`,
    [
      companyId,
      rejection_delay_hours ?? 48,
      auto_reject_threshold ?? 25,
      auto_shortlist_threshold ?? 75,
      slack_workspace_invite_url ?? null,
      discord_invite_url ?? null,
      google_calendar_id ?? null,
      rejection_email_template ?? '',
      interview_email_template ?? '',
      offer_email_template ?? '',
      welcome_email_template ?? '',
    ]
  )

  return c.json({ settings: result.rows[0] })
})

// ── GET /api/settings/modules ────────────────────────────────────────────────
// CEO-only: returns enabled/disabled status of every module for every company
// the caller is scoped to (creator's companyIds is every company - set in
// requireAuth - so it still sees the full matrix).
// Response shape: { modules: { companyId, companyName, modules: Record<ModuleKey, boolean> }[] }

app.get('/api/settings/modules', requireAuth, requireRole('ceo'), async (c) => {
  const callerCompanyIds: string[] = c.get('companyIds') ?? []
  if (callerCompanyIds.length === 0) return c.json({ modules: [] })

  // Load the caller's companies only - never the whole tenant table
  const companies = await query(
    `SELECT id, name FROM companies WHERE id = ANY($1) ORDER BY name`,
    [callerCompanyIds]
  )

  if (companies.rows.length === 0) {
    return c.json({ modules: [] })
  }

  const companyIds = companies.rows.map((r: { id: string }) => r.id)

  // Load all module rows for these companies
  const modRows = await query(
    `SELECT company_id, module_key, is_enabled
     FROM company_modules
     WHERE company_id = ANY($1)`,
    [companyIds]
  )

  // Build a lookup: companyId -> moduleKey -> is_enabled
  const lookup: Record<string, Record<string, boolean>> = {}
  for (const row of modRows.rows as { company_id: string; module_key: string; is_enabled: boolean }[]) {
    if (!lookup[row.company_id]) lookup[row.company_id] = {}
    lookup[row.company_id][row.module_key] = row.is_enabled
  }

  const result = companies.rows.map((c: { id: string; name: string }) => {
    const companyMods: Record<string, boolean> = {}
    for (const key of ALL_MODULE_KEYS) {
      // Default to true if the row is missing (pre-migration fallback)
      companyMods[key] = lookup[c.id]?.[key] ?? true
    }
    return { companyId: c.id, companyName: c.name, modules: companyMods }
  })

  return c.json({ modules: result })
})

// ── PATCH /api/settings/modules/:companyId/:module ───────────────────────────
// CEO-only: toggle a module on or off for a specific company

app.patch('/api/settings/modules/:companyId/:module', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId')
  const moduleKey = c.req.param('module') ?? ''

  if (!(ALL_MODULE_KEYS as string[]).includes(moduleKey)) {
    return c.json({ error: `Unknown module: ${moduleKey}` }, 400)
  }

  // Verify company exists AND is within the caller's scope. A company outside
  // scope returns the same 404 as one that does not exist - deliberately, so
  // this endpoint can't be used to probe for the existence of other tenants.
  const callerCompanyIds: string[] = c.get('companyIds') ?? []
  const company = await query(
    `SELECT id FROM companies WHERE id = $1 AND id = ANY($2)`,
    [companyId, callerCompanyIds]
  )
  if (company.rows.length === 0) return c.json({ error: 'Company not found' }, 404)

  const body = await c.req.json()
  const { is_enabled } = body
  if (typeof is_enabled !== 'boolean') {
    return c.json({ error: 'is_enabled must be a boolean' }, 400)
  }

  const beforeRes = await query(
    `SELECT is_enabled FROM company_modules WHERE company_id = $1 AND module_key = $2`,
    [companyId, moduleKey]
  )

  await query(
    `INSERT INTO company_modules (company_id, module_key, is_enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (company_id, module_key)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()`,
    [companyId, moduleKey, is_enabled]
  )

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminModuleToggle,
    resourceType: 'module',
    resourceId:   moduleKey,
    companyId,
    before:       beforeRes.rows[0] ? { module_key: moduleKey, is_enabled: beforeRes.rows[0].is_enabled } : null,
    after:        { module_key: moduleKey, is_enabled },
  })

  return c.json({ companyId, module: moduleKey, is_enabled })
})

// ── Helpers for invite ───────────────────────────────────────────────────────

function genTempPassword(): string {
  return randomBytes(12).toString('base64url').slice(0, 16)
}

function newAuthId(): string {
  return randomBytes(16).toString('base64url').slice(0, 22)
}

// ── GET /api/settings/roles ──────────────────────────────────────────────────
// Creator-only: list all roles for a company with their module access

app.get('/api/settings/roles', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const companyId = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id query param required' }, 400)

  const roles = await query(
    `SELECT cr.id, cr.name, cr.slug, cr.description, cr.is_system, cr.created_at,
            count(u.id) AS member_count
     FROM company_roles cr
     LEFT JOIN users u ON u.company_role_id = cr.id
     WHERE cr.company_id = $1
     GROUP BY cr.id
     ORDER BY cr.is_system DESC, cr.name ASC`,
    [companyId]
  )

  return c.json({ roles: roles.rows })
})

// ── POST /api/settings/roles ─────────────────────────────────────────────────
// Creator-only: create a new role for a company

app.post('/api/settings/roles', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const body = await c.req.json()
  const { company_id, name, slug, description } = body

  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!slug)       return c.json({ error: 'slug is required' }, 400)

  const slugNorm = (slug as string).toLowerCase().replace(/[^a-z0-9_]/g, '_')

  const comp = await query(`SELECT id FROM companies WHERE id = $1`, [company_id])
  if (comp.rows.length === 0) return c.json({ error: 'Company not found' }, 404)

  try {
    const result = await query(
      `INSERT INTO company_roles (company_id, name, slug, description, is_system, created_by)
       VALUES ($1, $2, $3, $4, false, $5)
       RETURNING id, company_id, name, slug, description, is_system, created_at`,
      [company_id, name, slugNorm, description ?? null, c.get('userId')]
    )
    await logAdminAction(c, {
      action:       AUDIT_ACTIONS.adminRoleCreate,
      resourceType: 'company_role',
      resourceId:   result.rows[0].id as string,
      companyId:    company_id as string,
      after:        result.rows[0],
    })
    return c.json({ role: result.rows[0] }, 201)
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      return c.json({ error: `A role with slug "${slugNorm}" already exists for this company` }, 409)
    }
    throw err
  }
})

// ── PATCH /api/settings/roles/:id ───────────────────────────────────────────
// Creator-only: update name/description of a role (slug and is_system not editable)

app.patch('/api/settings/roles/:id', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id   = c.req.param('id')
  const body = await c.req.json()
  const { name, description } = body

  const existing = await query(`SELECT id, is_system FROM company_roles WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Role not found' }, 404)

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (name        !== undefined) { fields.push(`name = $${idx++}`);        values.push(name) }
  if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description || null) }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE company_roles SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING id, company_id, name, slug, description, is_system, created_at`,
    values
  )

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminRoleUpdate,
    resourceType: 'company_role',
    resourceId:   id,
    companyId:    (result.rows[0]?.company_id as string) ?? null,
    before:       existing.rows[0] ?? null,
    after:        result.rows[0],
  })

  return c.json({ role: result.rows[0] })
})

// ── DELETE /api/settings/roles/:id ──────────────────────────────────────────
// Creator-only: delete a role (only if is_system=false)

app.delete('/api/settings/roles/:id', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id = c.req.param('id')

  const existing = await query(`SELECT id, is_system FROM company_roles WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Role not found' }, 404)
  if (existing.rows[0].is_system) {
    return c.json({ error: 'Cannot delete system roles (CEO/COO/CTO). Manage their permissions instead.' }, 409)
  }

  await query(`DELETE FROM company_roles WHERE id = $1`, [id])

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminRoleDelete,
    resourceType: 'company_role',
    resourceId:   id,
    before:       existing.rows[0] ?? null,
    after:        null,
  })

  return c.json({ ok: true })
})

// ── GET /api/settings/roles/:id/permissions ──────────────────────────────────
// Creator-only: get module access for a role

app.get('/api/settings/roles/:id/permissions', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id = c.req.param('id')

  const roleCheck = await query(`SELECT id FROM company_roles WHERE id = $1`, [id])
  if (roleCheck.rows.length === 0) return c.json({ error: 'Role not found' }, 404)

  const perms = await query(
    `SELECT module_key, can_read, can_write FROM role_module_access WHERE role_id = $1`,
    [id]
  )

  // Build a full map over all known module keys, defaulting to no access
  const permissions: Record<string, { can_read: boolean; can_write: boolean }> = {}
  for (const key of ALL_MODULE_KEYS) {
    permissions[key] = { can_read: false, can_write: false }
  }
  for (const row of perms.rows as { module_key: string; can_read: boolean; can_write: boolean }[]) {
    if (permissions[row.module_key] !== undefined) {
      permissions[row.module_key] = { can_read: row.can_read, can_write: row.can_write }
    }
  }

  return c.json({ role_id: id, permissions })
})

// ── PATCH /api/settings/roles/:id/permissions ────────────────────────────────
// Creator-only: set module access for a role
// Body: { permissions: { [module_key]: { can_read: bool, can_write: bool } } }

app.patch('/api/settings/roles/:id/permissions', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id   = c.req.param('id')
  const body = await c.req.json()
  const { permissions } = body as { permissions: Record<string, { can_read: boolean; can_write: boolean }> }

  const roleCheck = await query(`SELECT id FROM company_roles WHERE id = $1`, [id])
  if (roleCheck.rows.length === 0) return c.json({ error: 'Role not found' }, 404)

  if (!permissions || typeof permissions !== 'object') {
    return c.json({ error: 'permissions object required' }, 400)
  }

  const beforeRes = await query(
    `SELECT module_key, can_read, can_write FROM role_module_access WHERE role_id = $1 ORDER BY module_key`,
    [id]
  )

  // Delete all existing permissions and re-insert atomically.
  // A transaction prevents a partial failure from leaving the role with
  // no permissions at all (empty window between DELETE and INSERT loop).
  await transaction(async (client) => {
    await client.query(`DELETE FROM role_module_access WHERE role_id = $1`, [id])
    for (const [key, perm] of Object.entries(permissions)) {
      if (!(ALL_MODULE_KEYS as string[]).includes(key)) continue
      if (!perm.can_read && !perm.can_write) continue // skip no-access rows
      await client.query(
        `INSERT INTO role_module_access (role_id, module_key, can_read, can_write)
         VALUES ($1, $2, $3, $4)`,
        [id, key, !!perm.can_read, !!perm.can_write]
      )
    }
  })

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminRolePermissions,
    resourceType: 'company_role',
    resourceId:   id,
    before:       beforeRes.rows,
    after:        permissions,
  })

  return c.json({ ok: true })
})

// ── GET /api/settings/users-list ─────────────────────────────────────────────
// Creator-only: enhanced user list with dynamic role names

app.get('/api/settings/users-list', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.company_role_id,
            u.telegram_chat_id, u.whatsapp_number, u.is_active, u.created_at,
            cr.name AS role_name, cr.slug AS role_slug,
            array_agg(DISTINCT uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) AS company_ids,
            array_agg(DISTINCT co.name ORDER BY co.name) FILTER (WHERE co.name IS NOT NULL) AS company_names
     FROM users u
     LEFT JOIN company_roles cr ON cr.id = u.company_role_id
     LEFT JOIN user_companies uc ON uc.user_id = u.id
     LEFT JOIN companies co ON co.id = uc.company_id
     GROUP BY u.id, cr.id
     ORDER BY u.created_at ASC`,
    []
  )
  return c.json({ users: result.rows })
})

// ── POST /api/settings/invite ─────────────────────────────────────────────────
// Creator-only: invite a new user with a temp password
// Creates better-auth user + credential account + CBOP users row + user_companies + user_invites

app.post('/api/settings/invite', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const body = await c.req.json()
  const { email, name, role_id, company_id } = body

  if (!email)      return c.json({ error: 'email is required' }, 400)
  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!role_id)    return c.json({ error: 'role_id is required' }, 400)
  if (!company_id) return c.json({ error: 'company_id is required' }, 400)

  // Validate role belongs to the given company
  const roleCheck = await query(
    `SELECT id, slug FROM company_roles WHERE id = $1 AND company_id = $2`,
    [role_id, company_id]
  )
  if (roleCheck.rows.length === 0) {
    return c.json({ error: 'Role not found for this company' }, 404)
  }
  const roleSlug = roleCheck.rows[0].slug as string

  // Generate temp password
  const tempPw   = genTempPassword()
  const hashed   = await hashPassword(tempPw)
  const authId   = newAuthId()

  // Check if a better-auth user already exists with this email
  const existingAuth = await query(`SELECT id FROM "user" WHERE email = $1`, [email.toLowerCase()])

  if (existingAuth.rows.length === 0) {
    // Create better-auth "user" row
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, NOW(), NOW())`,
      [authId, name, email.toLowerCase()]
    )
    // Create better-auth "account" row (credential provider with hashed password)
    await query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())`,
      [newAuthId(), email.toLowerCase(), authId, hashed]
    )
  } else {
    // User already has an auth account — update account password so they can use the temp pw
    const existingAuthUserId = existingAuth.rows[0].id as string
    await query(
      `UPDATE account SET password = $1, "updatedAt" = NOW()
       WHERE "userId" = $2 AND "providerId" = 'credential'`,
      [hashed, existingAuthUserId]
    )
  }

  // Upsert CBOP users row (role slug for backward compat)
  const userRes = await query(
    `INSERT INTO users (name, email, role, company_role_id, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (email) DO UPDATE
       SET name            = EXCLUDED.name,
           role            = EXCLUDED.role,
           company_role_id = EXCLUDED.company_role_id,
           is_active       = true
     RETURNING id, name, email, role, company_role_id, is_active`,
    [name, email.toLowerCase(), roleSlug, role_id]
  )
  const user = userRes.rows[0]

  // Ensure user_companies row exists
  await query(
    `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [user.id, company_id]
  )

  // Record the invite (stores cleartext temp_password until first login)
  await query(
    `INSERT INTO user_invites (company_id, email, name, role_id, temp_password, invited_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [company_id, email.toLowerCase(), name, role_id, tempPw, c.get('userId')]
  )

  // Send welcome email (non-blocking — fail silently so the invite still succeeds)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003'
  void sendEmail({
    to: email.toLowerCase(),
    subject: 'Your CBOP account is ready',
    html: `<p>Hi ${name},</p>
<p>You have been invited to CBOP. Use these credentials to log in:</p>
<p><strong>Email:</strong> ${email}<br/>
<strong>Temporary password:</strong> <code>${tempPw}</code></p>
<p><a href="${appUrl}/login">Log in to CBOP</a></p>
<p>Please change your password after your first login.</p>`,
    enforceVerified: false,
    kind: 'transactional',
  }).catch((err: unknown) => console.error('Welcome email send failed:', err))

  // The temp password is deliberately NOT in the audit payload — writeAuditLog
  // redacts credential-shaped keys, but the safest cleartext is the one never
  // handed to the writer.
  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminUserInvite,
    resourceType: 'user',
    resourceId:   user.id as string,
    companyId:    company_id as string,
    after:        { email: email.toLowerCase(), name, role_id, role_slug: roleSlug, company_id },
  })

  return c.json({ user, temp_password: tempPw }, 201)
})

// ── PATCH /api/settings/users/:id/role ──────────────────────────────────────
// Creator-only: change a user's company_role_id (and update users.role slug)

app.patch('/api/settings/users/:id/role', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id   = c.req.param('id')
  const body = await c.req.json()
  const { role_id } = body

  if (!role_id) return c.json({ error: 'role_id is required' }, 400)

  const roleCheck = await query(`SELECT id, slug FROM company_roles WHERE id = $1`, [role_id])
  if (roleCheck.rows.length === 0) return c.json({ error: 'Role not found' }, 404)

  const roleSlug = roleCheck.rows[0].slug as string

  const beforeRes = await query(
    `SELECT id, name, email, role, company_role_id, is_active FROM users WHERE id = $1`,
    [id]
  )

  const result = await query(
    `UPDATE users SET company_role_id = $1, role = $2 WHERE id = $3
     RETURNING id, name, email, role, company_role_id, is_active`,
    [role_id, roleSlug, id]
  )
  if (result.rows.length === 0) return c.json({ error: 'User not found' }, 404)

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminUserRoleChange,
    resourceType: 'user',
    resourceId:   id,
    before:       beforeRes.rows[0] ?? null,
    after:        result.rows[0],
  })

  return c.json({ user: result.rows[0] })
})

// ── DELETE /api/settings/users/:id/company ───────────────────────────────────
// Creator-only: remove a user from a specific company (soft — keeps user record)

app.delete('/api/settings/users/:id/company', requireAuth, async (c) => {
  if (!isCreator(c)) return forbidCreatorOnly(c)

  const id         = c.req.param('id')
  const body       = await c.req.json().catch(() => ({}))
  const { company_id } = body as { company_id?: string }

  if (!company_id) return c.json({ error: 'company_id is required in body' }, 400)

  await query(
    `DELETE FROM user_companies WHERE user_id = $1 AND company_id = $2`,
    [id, company_id]
  )

  await logAdminAction(c, {
    action:       AUDIT_ACTIONS.adminUserCompanyRemove,
    resourceType: 'user',
    resourceId:   id,
    companyId:    company_id,
    before:       { user_id: id, company_id },
    after:        null,
  })

  return c.json({ ok: true })
})

// ── GET /api/settings/morning-briefing ───────────────────────────────────────
// Returns schedule config + all active users merged with their recipient settings.
// CEO + creator only.

app.get('/api/settings/morning-briefing', requireAuth, requireRole('ceo'), async (c) => {
  const [cfgRes, usersRes, recRes] = await Promise.all([
    query('SELECT id, send_time, active_days, is_active FROM morning_briefing_config LIMIT 1'),
    query(`SELECT id, name, role, telegram_chat_id, whatsapp_number
           FROM users WHERE is_active = true ORDER BY name`),
    query('SELECT user_id, is_active, channel, include_tasks, include_invoices, include_deals, include_automations FROM morning_briefing_recipients'),
  ])

  const cfg = cfgRes.rows[0] ?? { send_time: '08:00', active_days: [1,2,3,4,5], is_active: true }
  const recByUser = Object.fromEntries(recRes.rows.map((r) => [r.user_id, r]))

  const recipients = usersRes.rows.map((u) => {
    const saved = recByUser[u.id]
    return {
      user_id:             u.id,
      name:                u.name,
      role:                u.role,
      telegram_chat_id:    u.telegram_chat_id,
      whatsapp_number:     u.whatsapp_number,
      is_active:           saved ? saved.is_active           : !!(u.telegram_chat_id || u.whatsapp_number),
      channel:             saved ? saved.channel              : (u.telegram_chat_id ? 'telegram' : 'whatsapp'),
      include_tasks:       saved ? saved.include_tasks        : true,
      include_invoices:    saved ? saved.include_invoices     : true,
      include_deals:       saved ? saved.include_deals        : true,
      include_automations: saved ? saved.include_automations  : true,
    }
  })

  return c.json({ config: cfg, recipients })
})

// ── POST /api/settings/morning-briefing ──────────────────────────────────────
// Saves schedule config + upserts per-recipient settings.

app.post('/api/settings/morning-briefing', requireAuth, requireRole('ceo'), async (c) => {
  const { config, recipients } = await c.req.json() as {
    config: { send_time: string; active_days: number[]; is_active: boolean }
    recipients: { user_id: string; is_active: boolean; channel: string; include_tasks: boolean; include_invoices: boolean; include_deals: boolean; include_automations: boolean }[]
  }

  await query(
    `UPDATE morning_briefing_config
     SET send_time = $1, active_days = $2, is_active = $3, updated_at = NOW()
     WHERE id = (SELECT id FROM morning_briefing_config LIMIT 1)`,
    [config.send_time, config.active_days, config.is_active]
  )

  for (const r of recipients) {
    await query(
      `INSERT INTO morning_briefing_recipients (user_id, is_active, channel, include_tasks, include_invoices, include_deals, include_automations, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         is_active = $2, channel = $3, include_tasks = $4, include_invoices = $5,
         include_deals = $6, include_automations = $7, updated_at = NOW()`,
      [r.user_id, r.is_active, r.channel, r.include_tasks, r.include_invoices, r.include_deals, r.include_automations]
    )
  }

  return c.json({ ok: true })
})

// ── GET /api/settings/morning-briefing/preview ───────────────────────────────
// Returns a text preview of what the briefing message looks like for a given user.

app.get('/api/settings/morning-briefing/preview', requireAuth, requireRole('ceo'), async (c) => {
  const userId = c.req.query('user_id')
  if (!userId) return c.json({ error: 'user_id required' }, 400)

  const companyIds = c.get('companyIds') as string[]

  const [recRes, tasksRes, invoicesRes, dealsRes, jobsRes] = await Promise.all([
    query(
      `SELECT mbr.*, u.name, u.role FROM morning_briefing_recipients mbr
       JOIN users u ON u.id = mbr.user_id WHERE mbr.user_id = $1`,
      [userId]
    ),
    query(
      `SELECT t.title, t.priority, t.due_date, p.name AS project
       FROM ops_tasks t LEFT JOIN ops_projects p ON p.id = t.project_id
       WHERE t.owner_id = $1 AND t.status != 'done'
         AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE)
       ORDER BY t.due_date ASC NULLS LAST LIMIT 10`,
      [userId]
    ),
    query(
      `SELECT i.invoice_no, i.total, i.due_date, cl.name AS client, co.name AS company
       FROM sales_invoices i
       JOIN sales_clients cl ON cl.id = i.client_id
       JOIN companies co ON co.id = i.company_id
       WHERE i.company_id = ANY($1) AND i.status != 'paid' AND i.due_date < CURRENT_DATE
       ORDER BY i.due_date ASC LIMIT 10`,
      [companyIds]
    ),
    query(
      `SELECT COUNT(*)::int AS open_count, COALESCE(SUM(value), 0)::numeric AS pipeline_value
       FROM sales_deals WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')`,
      [companyIds]
    ),
    query(
      `SELECT name, status FROM system_jobs
       WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 5`
    ),
  ])

  const rec = recRes.rows[0]
  const sections: { section: string; lines: string[] }[] = []

  if (!rec || rec.include_tasks) {
    const tasks = tasksRes.rows
    sections.push({
      section: 'Tasks due today',
      lines: tasks.length === 0
        ? ['No tasks due.']
        : tasks.map((t) => `  - [${t.priority.toUpperCase()}] ${t.title}${t.due_date ? ` — due ${t.due_date.slice(0, 10)}` : ''}${t.project ? ` (${t.project})` : ''}`),
    })
  }

  if (!rec || rec.include_invoices) {
    const invs = invoicesRes.rows
    sections.push({
      section: 'Overdue invoices',
      lines: invs.length === 0
        ? ['No overdue invoices.']
        : invs.map((i) => `  - ${i.invoice_no}  ₹${parseFloat(String(i.total)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}  ${i.client}  (${i.company})  due ${i.due_date?.toString().slice(0, 10) ?? '—'}`),
    })
  }

  if (!rec || rec.include_deals) {
    const d = dealsRes.rows[0]
    sections.push({
      section: 'Open deals',
      lines: [`  ${d?.open_count ?? 0} open deal(s) — pipeline value ₹${parseFloat(String(d?.pipeline_value ?? 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`],
    })
  }

  if (!rec || rec.include_automations) {
    const jobs = jobsRes.rows
    sections.push({
      section: 'Automation (last 24h)',
      lines: jobs.length === 0
        ? ['No automations ran.']
        : jobs.map((j) => `  - ${j.name}  [${j.status.toUpperCase()}]`),
    })
  }

  const lines: string[] = [
    `Good morning, ${rec?.name ?? 'team'} — here is your briefing for today.`,
    '',
    ...sections.flatMap((s) => [`${s.section.toUpperCase()}`, ...s.lines, '']),
    '— CBOP',
  ]

  return c.json({ preview: lines.join('\n') })
})

export default app
