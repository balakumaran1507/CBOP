import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { generateLocalBusinessJsonLd, checkNapCompleteness } from '../lib/local-business-schema'
import * as fs from 'fs'
import * as path from 'path'
import '../lib/hono-vars'

const app = new Hono()

// Loads (or defaults) the settings row + company name/logo/invoice_prefix
// needed for JSON-LD generation - shared by a few routes below.
async function loadSettingsForCompany(companyId: string) {
  const result = await query(
    `SELECT ss.*, c.name AS company_name, c.logo_url, c.invoice_prefix
     FROM companies c
     LEFT JOIN site_settings ss ON ss.company_id = c.id
     WHERE c.id = $1`,
    [companyId]
  )
  return result.rows[0] ?? null
}

// ── GET /api/site-settings/:companyId ────────────────────────────────────────

app.get('/api/site-settings/:companyId', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const row = await loadSettingsForCompany(companyId)
  if (!row) return c.json({ error: 'Company not found' }, 404)

  return c.json({ settings: row })
})

// ── PUT /api/site-settings/:companyId ────────────────────────────────────────

app.put('/api/site-settings/:companyId', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const {
    tagline, favicon_url, phone, email,
    address_street, address_city, address_state, address_postal, address_country,
    hours, social_links,
  } = body

  const result = await query(
    `INSERT INTO site_settings (
       company_id, tagline, favicon_url, phone, email,
       address_street, address_city, address_state, address_postal, address_country,
       hours, social_links, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       tagline = EXCLUDED.tagline,
       favicon_url = EXCLUDED.favicon_url,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       address_street = EXCLUDED.address_street,
       address_city = EXCLUDED.address_city,
       address_state = EXCLUDED.address_state,
       address_postal = EXCLUDED.address_postal,
       address_country = EXCLUDED.address_country,
       hours = EXCLUDED.hours,
       social_links = EXCLUDED.social_links,
       updated_at = NOW()
     RETURNING *`,
    [
      companyId, tagline ?? null, favicon_url ?? null, phone ?? null, email ?? null,
      address_street ?? null, address_city ?? null, address_state ?? null, address_postal ?? null, address_country ?? 'IN',
      JSON.stringify(hours ?? {}), JSON.stringify(social_links ?? []),
    ]
  )

  return c.json({ settings: result.rows[0] })
})

// ── GET /api/site-settings/:companyId/jsonld ─────────────────────────────────

app.get('/api/site-settings/:companyId/jsonld', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const row = await loadSettingsForCompany(companyId)
  if (!row) return c.json({ error: 'Company not found' }, 404)

  const jsonLd = generateLocalBusinessJsonLd({
    company_name: row.company_name,
    tagline: row.tagline,
    logo_url: row.logo_url,
    phone: row.phone,
    email: row.email,
    address_street: row.address_street,
    address_city: row.address_city,
    address_state: row.address_state,
    address_postal: row.address_postal,
    address_country: row.address_country,
    social_links: row.social_links ?? [],
    site_url: null,
  })

  return c.json({ jsonLd })
})

// ── GET /api/site-settings/:companyId/nap-check ──────────────────────────────
// Completeness/format self-check, not a real cross-property NAP consistency
// check against Google Business Profile - see local-business-schema.ts's
// comment on why that's out of scope for this unit.

app.get('/api/site-settings/:companyId/nap-check', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const row = await loadSettingsForCompany(companyId)
  if (!row) return c.json({ error: 'Company not found' }, 404)

  const result = checkNapCompleteness({
    company_name: row.company_name,
    tagline: row.tagline,
    logo_url: row.logo_url,
    phone: row.phone,
    email: row.email,
    address_street: row.address_street,
    address_city: row.address_city,
    address_state: row.address_state,
    address_postal: row.address_postal,
    address_country: row.address_country,
    social_links: row.social_links ?? [],
    site_url: null,
  })

  return c.json(result)
})

// ── Favicon upload ────────────────────────────────────────────────────────────

app.post('/api/site-settings/:companyId/favicon', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const allowed = ['image/png', 'image/x-icon', 'image/svg+xml', 'image/webp']
  if (!allowed.includes(file.type)) return c.json({ error: 'Only PNG, ICO, SVG, WebP allowed' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const fname = `favicon-${companyId}.${ext}`
  const dir = path.join(process.cwd(), 'uploads', 'site-settings')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  const url = `/api/uploads/site-settings/${fname}`
  await query(
    `INSERT INTO site_settings (company_id, favicon_url) VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET favicon_url = EXCLUDED.favicon_url, updated_at = NOW()`,
    [companyId, url]
  )

  return c.json({ favicon_url: url })
})

// ── Team members ──────────────────────────────────────────────────────────────

app.get('/api/site-settings/:companyId/team', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `SELECT * FROM site_team_members WHERE company_id = $1 ORDER BY display_order, created_at`,
    [companyId]
  )
  return c.json({ team: result.rows })
})

app.post('/api/site-settings/:companyId/team', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const { name, title, photo_url, bio, email, display_order } = body
  if (!name?.trim()) return c.json({ error: 'name required' }, 400)

  const result = await query(
    `INSERT INTO site_team_members (company_id, name, title, photo_url, bio, email, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [companyId, name.trim(), title ?? null, photo_url ?? null, bio ?? null, email ?? null, display_order ?? 0]
  )
  return c.json({ member: result.rows[0] }, 201)
})

app.patch('/api/site-settings/team/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()

  const existing = await query(`SELECT company_id FROM site_team_members WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)

  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const key of ['name', 'title', 'photo_url', 'bio', 'email', 'display_order']) {
    if (body[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(body[key]) }
  }
  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)
  values.push(id)

  const result = await query(`UPDATE site_team_members SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values)
  return c.json({ member: result.rows[0] })
})

app.delete('/api/site-settings/team/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id FROM site_team_members WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)

  await query(`DELETE FROM site_team_members WHERE id = $1`, [id])
  return c.json({ ok: true })
})

app.post('/api/site-settings/team/:id/photo', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id FROM site_team_members WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) return c.json({ error: 'Only JPEG, PNG, WebP allowed' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const fname = `team-${id}.${ext}`
  const dir = path.join(process.cwd(), 'uploads', 'site-settings')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  const url = `/api/uploads/site-settings/${fname}`
  await query(`UPDATE site_team_members SET photo_url = $1 WHERE id = $2`, [url, id])

  return c.json({ photo_url: url })
})

export default app
