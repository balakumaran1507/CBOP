import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { generateArticleJsonLd } from '../lib/blog-schema'
import * as fs from 'fs'
import * as path from 'path'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/blog/posts ──────────────────────────────────────────────────────

app.get('/api/blog/posts', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { company_id, status } = c.req.query()

  const conditions: string[] = ['bp.company_id = ANY($1)']
  const params: unknown[] = [companyIds]

  if (company_id) { params.push(company_id); conditions.push(`bp.company_id = $${params.length}`) }
  if (status)     { params.push(status);     conditions.push(`bp.status = $${params.length}`) }

  const result = await query(
    `SELECT bp.id, bp.company_id, c.name AS company_name, bp.title, bp.slug, bp.excerpt,
            bp.status, bp.scheduled_at, bp.published_at, bp.category, bp.tags,
            bp.created_at, bp.updated_at, u.name AS author_name
     FROM blog_posts bp
     JOIN companies c ON c.id = bp.company_id
     LEFT JOIN users u ON u.id = bp.author_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY bp.updated_at DESC`,
    params
  )
  return c.json({ posts: result.rows })
})

// ── GET /api/blog/posts/:id ──────────────────────────────────────────────────

app.get('/api/blog/posts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const result = await query(
    `SELECT bp.*, c.name AS company_name, u.name AS author_name
     FROM blog_posts bp
     JOIN companies c ON c.id = bp.company_id
     LEFT JOIN users u ON u.id = bp.author_id
     WHERE bp.id = $1 AND bp.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ post: result.rows[0] })
})

// ── POST /api/blog/posts ─────────────────────────────────────────────────────

app.post('/api/blog/posts', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const body = await c.req.json()
  const { company_id, title, slug, excerpt, content, category, tags, meta_title, meta_description, og_image_url, canonical_url } = body

  if (!company_id || !title || !slug) return c.json({ error: 'company_id, title, slug required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `INSERT INTO blog_posts (company_id, title, slug, excerpt, content, author_id, category, tags, meta_title, meta_description, og_image_url, canonical_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [company_id, title, slug, excerpt ?? null, content ?? '', userId, category ?? null, tags ?? [],
     meta_title ?? null, meta_description ?? null, og_image_url ?? null, canonical_url ?? null]
  )
  const post = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'blog_posts', op: 'create', id: post.id, after: post, companyId: company_id,
  })

  return c.json({ post }, 201)
})

// ── PATCH /api/blog/posts/:id ────────────────────────────────────────────────
// Mirrors templates.ts's exact version-then-prune pattern: save the OLD
// content as a version row before overwriting, then keep only the last 5.

app.patch('/api/blog/posts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await query(
    `SELECT id, company_id, title, content FROM blog_posts WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const current = existing.rows[0]

  const contentChanged = body.content !== undefined && body.content !== current.content
  const titleChanged = body.title !== undefined && body.title !== current.title

  if (contentChanged || titleChanged) {
    const versionCount = await query(`SELECT COUNT(*)::int AS n FROM blog_post_versions WHERE post_id = $1`, [id])
    const nextVersion = (versionCount.rows[0]?.n ?? 0) + 1
    await query(
      `INSERT INTO blog_post_versions (post_id, title, content, version) VALUES ($1,$2,$3,$4)`,
      [id, current.title, current.content, nextVersion]
    )
    await query(
      `DELETE FROM blog_post_versions WHERE post_id = $1
       AND id NOT IN (SELECT id FROM blog_post_versions WHERE post_id = $1 ORDER BY created_at DESC LIMIT 5)`,
      [id]
    )
  }

  const fields: string[] = []
  const values: unknown[] = []
  let idx = 1
  for (const key of ['title', 'slug', 'excerpt', 'content', 'category', 'tags', 'meta_title', 'meta_description', 'og_image_url', 'canonical_url']) {
    if (body[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(body[key]) }
  }
  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)
  fields.push(`updated_at = NOW()`)
  values.push(id)

  const result = await query(`UPDATE blog_posts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values)
  const post = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'blog_posts', op: 'update', id, before: current, after: post, companyId: current.company_id,
  })

  return c.json({ post })
})

// ── POST /api/blog/posts/:id/publish ─────────────────────────────────────────
// Body { scheduled_at? } - if given, sets status='scheduled' for a later
// automation to flip live; omitted means publish immediately.

app.post('/api/blog/posts/:id/publish', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const { scheduled_at } = body as { scheduled_at?: string }

  const existing = await query(`SELECT id, company_id, status FROM blog_posts WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const before = existing.rows[0]

  const result = scheduled_at
    ? await query(
        `UPDATE blog_posts SET status = 'scheduled', scheduled_at = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [scheduled_at, id]
      )
    : await query(
        `UPDATE blog_posts SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      )
  const post = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'blog_posts', op: 'update', id,
    before: { status: before.status }, after: { status: post.status }, companyId: before.company_id,
  })

  return c.json({ post })
})

// ── DELETE /api/blog/posts/:id ───────────────────────────────────────────────

app.delete('/api/blog/posts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const existing = await query(`SELECT * FROM blog_posts WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const before = existing.rows[0]

  await query(`DELETE FROM blog_posts WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'blog_posts', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── GET /api/blog/posts/:id/versions ─────────────────────────────────────────

app.get('/api/blog/posts/:id/versions', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const owned = await query(`SELECT id FROM blog_posts WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (owned.rows.length === 0) return c.json({ error: 'Not found' }, 404)

  const result = await query(
    `SELECT id, title, version, created_at FROM blog_post_versions WHERE post_id = $1 ORDER BY created_at DESC`,
    [id]
  )
  return c.json({ versions: result.rows })
})

// ── Media library ─────────────────────────────────────────────────────────────

app.post('/api/blog/media/upload', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  const companyId = formData.get('company_id') as string | null

  if (!file) return c.json({ error: 'No file provided' }, 400)
  if (!companyId || !companyIds.includes(companyId)) return c.json({ error: 'Invalid or forbidden company_id' }, 403)

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  if (!allowed.includes(file.type)) return c.json({ error: 'Only JPEG, PNG, WebP, SVG allowed' }, 400)

  const MAX_SIZE = 8 * 1024 * 1024
  if (file.size > MAX_SIZE) return c.json({ error: 'File too large (max 8MB)' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const dir = path.join(process.cwd(), 'uploads', 'blog')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  const url = `/api/uploads/blog/${fname}`
  const result = await query(
    `INSERT INTO blog_post_media (company_id, url, filename, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [companyId, url, file.name, userId]
  )
  const media = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'blog_post_media', op: 'create', id: media.id, after: media, companyId,
  })

  return c.json({ media }, 201)
})

app.get('/api/blog/media', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId = c.req.query('company_id')

  const conditions: string[] = ['company_id = ANY($1)']
  const params: unknown[] = [companyIds]
  if (companyId) { params.push(companyId); conditions.push(`company_id = $${params.length}`) }

  const result = await query(
    `SELECT * FROM blog_post_media WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    params
  )
  return c.json({ media: result.rows })
})

// ── GET /api/public/blog/:companyPrefix/:postSlug ────────────────────────────
// Public, no auth - this is the actual "CBOP is the CMS" endpoint. Identifies
// the company by invoice_prefix (existing unique field, e.g. ETH/PEN/CYB/ATK -
// see CLAUDE.md's invoice number format) rather than adding a new slug column.

app.get('/api/public/blog/:companyPrefix/:postSlug', async (c) => {
  const { companyPrefix, postSlug } = c.req.param()

  const result = await query(
    `SELECT bp.title, bp.excerpt, bp.content, bp.published_at, bp.updated_at,
            bp.meta_title, bp.meta_description, bp.og_image_url, bp.canonical_url,
            bp.category, bp.tags, u.name AS author_name
     FROM blog_posts bp
     JOIN companies c ON c.id = bp.company_id
     LEFT JOIN users u ON u.id = bp.author_id
     WHERE c.invoice_prefix = $1 AND bp.slug = $2 AND bp.status = 'published'`,
    [companyPrefix, postSlug]
  )
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)

  const post = result.rows[0]
  return c.json({
    ...post,
    jsonLd: generateArticleJsonLd(post),
  })
})

export default app
