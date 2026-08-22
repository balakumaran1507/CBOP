import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { isLinkedInConfigured, buildAuthUrl, exchangeCodeForTokens, getMemberInfo, createLinkedInPost, type LinkedInConnectionType } from '../lib/linkedin'
import { ollamaComplete } from '../lib/local-llm'
import { randomBytes } from 'crypto'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// Access-reality notes per platform, surfaced to the UI so "Connect" isn't a
// false promise - see docs/modules/SOCIAL_Build_Plan.md's Phase 1 findings (monitoring)
// and its "Social Media Manager" section (publishing - this file's actual scope).
const PLATFORM_INFO: Record<string, { label: string; setup: string; recommended: boolean }> = {
  youtube:   { label: 'YouTube',            setup: 'Self-serve, free, ~10 min setup via Google Cloud Console.', recommended: true },
  instagram: { label: 'Instagram',          setup: 'Free API, but needs Meta app review (2-4 weeks) and a linked Facebook Business account.', recommended: true },
  facebook:  { label: 'Facebook',           setup: 'Shares Meta app review with Instagram (2-4 weeks).', recommended: true },
  tiktok:    { label: 'TikTok',             setup: 'Free, needs developer review (days-weeks). Unaudited apps post as private-only.', recommended: true },
  x:         { label: 'X (Twitter)',        setup: 'No free tier as of Feb 2026 - pay-per-use, real ongoing cost per read/post.', recommended: false },
  linkedin:  { label: 'LinkedIn',           setup: 'Personal profile posting is self-serve, free, no wait. Posting as a company page needs LinkedIn Community Management API approval (weeks-months) - connect personal first.', recommended: true },
}

// In-memory OAuth state store - short-lived, single-server (same pattern as
// api/routes/seo.ts). Maps state token -> pending connection details.
const oauthState = new Map<string, { companyId: string; userId: string; connectionType: LinkedInConnectionType; expiresAt: number }>()

function cleanExpiredState() {
  const now = Date.now()
  for (const [k, v] of oauthState) if (v.expiresAt < now) oauthState.delete(k)
}

// ── GET /api/social/platforms ────────────────────────────────────────────────
// Static reference data for the connection cards - no auth needed, no secrets.

app.get('/api/social/platforms', requireAuth, requireRole('ceo'), async (c) => {
  return c.json({
    platforms: Object.entries(PLATFORM_INFO).map(([key, v]) => ({ key, ...v })),
    linkedin_configured: isLinkedInConfigured(),
  })
})

// ── GET /api/social/connections ──────────────────────────────────────────────

app.get('/api/social/connections', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT sc.id, sc.company_id, cmp.name AS company_name, sc.platform, sc.connection_type, sc.account_name, sc.connected_at
     FROM social_connections sc
     JOIN companies cmp ON cmp.id = sc.company_id
     WHERE sc.company_id = ANY($1)
     ORDER BY cmp.name, sc.platform`,
    [companyIds]
  )

  return c.json({ connections: result.rows })
})

// ── GET /api/social/linkedin/auth?company_id=X&connection_type=member ───────

app.get('/api/social/linkedin/auth', requireAuth, requireRole('ceo'), async (c) => {
  if (!isLinkedInConfigured()) {
    return c.text('LinkedIn OAuth is not configured yet - set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env', 400)
  }

  const companyId = c.req.query('company_id')
  const connectionType = (c.req.query('connection_type') || 'member') as LinkedInConnectionType
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string

  if (!companyId || !companyIds.includes(companyId)) return c.json({ error: 'Invalid or forbidden company_id' }, 403)
  if (connectionType !== 'member' && connectionType !== 'organization') return c.json({ error: 'Invalid connection_type' }, 400)

  cleanExpiredState()
  const state = randomBytes(24).toString('hex')
  oauthState.set(state, { companyId, userId, connectionType, expiresAt: Date.now() + 10 * 60 * 1000 })

  return c.redirect(buildAuthUrl(state, connectionType))
})

// ── GET /api/social/linkedin/callback ────────────────────────────────────────

app.get('/api/social/linkedin/callback', requireAuth, async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) return c.redirect(`/social?error=${encodeURIComponent(error)}`)
  if (!code || !state) return c.redirect('/social?error=missing_code_or_state')

  cleanExpiredState()
  const pending = oauthState.get(state)
  if (!pending) return c.redirect('/social?error=state_expired')
  oauthState.delete(state)

  try {
    const tokens = await exchangeCodeForTokens(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    if (pending.connectionType === 'member') {
      const member = await getMemberInfo(tokens.access_token)
      const { rows: [conn] } = await query(
        `INSERT INTO social_connections (company_id, platform, connection_type, account_name, account_id, access_token, refresh_token, token_expires_at, connected_by)
         VALUES ($1, 'linkedin', 'member', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company_id, platform, account_id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, social_connections.refresh_token),
           token_expires_at = EXCLUDED.token_expires_at
         RETURNING id, company_id, platform, connection_type, account_name, account_id`,
        [pending.companyId, member.name, member.personUrn, tokens.access_token, tokens.refresh_token ?? '', expiresAt, pending.userId]
      )
      await writeMutationAuditLog(c, {
        table: 'social_connections', op: 'create', id: conn.id, after: conn, companyId: pending.companyId,
      })
    } else {
      // Organization posting needs the org URN, which this scope alone can't
      // look up (see docs/modules/SOCIAL_Build_Plan.md Phase 2) - store the connection
      // with a placeholder account_id; the frontend prompts for the real
      // organization URN as a follow-up PATCH once Standard Tier is granted.
      const { rows: [conn] } = await query(
        `INSERT INTO social_connections (company_id, platform, connection_type, account_name, account_id, access_token, refresh_token, token_expires_at, connected_by)
         VALUES ($1, 'linkedin', 'organization', 'Pending organization URN', 'pending', $2, $3, $4, $5)
         ON CONFLICT (company_id, platform, account_id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, social_connections.refresh_token),
           token_expires_at = EXCLUDED.token_expires_at
         RETURNING id, company_id, platform, connection_type, account_name, account_id`,
        [pending.companyId, tokens.access_token, tokens.refresh_token ?? '', expiresAt, pending.userId]
      )
      await writeMutationAuditLog(c, {
        table: 'social_connections', op: 'create', id: conn.id, after: conn, companyId: pending.companyId,
      })
    }

    return c.redirect('/social?connected=true')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.redirect(`/social?error=${encodeURIComponent(msg.slice(0, 200))}`)
  }
})

// ── PATCH /api/social/connections/:id ────────────────────────────────────────
// Path B follow-up: set the real organization URN once the user has it
// (found on the LinkedIn company page's admin view) and Standard Tier access
// has actually been granted.

app.patch('/api/social/connections/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{ organization_urn?: string; account_name?: string }>()

  const existing = await query(`SELECT * FROM social_connections WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!body.organization_urn?.startsWith('urn:li:organization:')) {
    return c.json({ error: 'organization_urn must look like urn:li:organization:12345678' }, 400)
  }
  const before = existing.rows[0]

  const { rows: [after] } = await query(
    `UPDATE social_connections SET account_id = $1, account_name = COALESCE($2, account_name) WHERE id = $3 RETURNING id, company_id, account_id, account_name`,
    [body.organization_urn, body.account_name ?? null, id]
  )

  await writeMutationAuditLog(c, {
    table: 'social_connections', op: 'update', id, before, after, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── DELETE /api/social/connections/:id ───────────────────────────────────────

app.delete('/api/social/connections/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id, platform, connection_type, account_name FROM social_connections WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  await query(`DELETE FROM social_connections WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'social_connections', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── GET /api/social/trends/:companyId ────────────────────────────────────────
// Trend data derived from social_engagement_snapshots - empty (not fake) until
// a real connection has been polling long enough to have history.

app.get('/api/social/trends/:companyId', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.param('companyId') as string
  const companyIds = c.get('companyIds') as string[]
  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `SELECT s.snapshot_date, s.followers, s.total_likes, s.total_comments, s.total_shares, s.total_reach,
            sc.platform, sc.account_name
     FROM social_engagement_snapshots s
     JOIN social_connections sc ON sc.id = s.connection_id
     WHERE sc.company_id = $1
     ORDER BY s.snapshot_date ASC`,
    [companyId]
  )

  return c.json({ snapshots: result.rows, has_data: result.rows.length > 0 })
})

// ── GET /api/social/posts?companyId=X ────────────────────────────────────────

app.get('/api/social/posts', requireAuth, requireRole('ceo'), async (c) => {
  const companyId = c.req.query('companyId')
  const companyIds = c.get('companyIds') as string[]
  if (!companyId || !companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `SELECT p.*, sc.platform, sc.account_name
     FROM social_posts p
     JOIN social_connections sc ON sc.id = p.connection_id
     WHERE p.company_id = $1
     ORDER BY p.created_at DESC`,
    [companyId]
  )
  return c.json({ posts: result.rows })
})

// ── POST /api/social/posts ───────────────────────────────────────────────────
// Creates a draft. Does not publish - publishing is always a separate,
// explicit step (see /posts/:id/publish below).

app.post('/api/social/posts', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const body = await c.req.json<{
    company_id: string; connection_id: string; content: string; media_url?: string
    ai_generated?: boolean; source_type?: string; source_id?: string
  }>()

  if (!companyIds.includes(body.company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!body.content?.trim()) return c.json({ error: 'content is required' }, 400)

  const conn = await query(`SELECT company_id FROM social_connections WHERE id = $1`, [body.connection_id])
  if (conn.rows.length === 0 || conn.rows[0].company_id !== body.company_id) {
    return c.json({ error: 'Invalid connection_id for this company' }, 400)
  }

  const result = await query(
    `INSERT INTO social_posts (company_id, connection_id, content, media_url, ai_generated, source_type, source_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [body.company_id, body.connection_id, body.content, body.media_url ?? null, body.ai_generated ?? false, body.source_type ?? 'manual', body.source_id ?? null, userId]
  )
  const post = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'social_posts', op: 'create', id: post.id, after: post, companyId: body.company_id,
  })

  return c.json({ post }, 201)
})

// ── POST /api/social/posts/generate ──────────────────────────────────────────
// LLM draft only - returns text for the compose form to prefill. Never saves
// or publishes on its own (same "AI drafts, human approves" shape as Blog CMS
// and Email Studio).

app.post('/api/social/posts/generate', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{ company_id: string; source_type: 'blog_post' | 'job_listing' | 'manual'; source_id?: string; prompt?: string }>()

  if (!companyIds.includes(body.company_id)) return c.json({ error: 'Forbidden' }, 403)

  let sourceText = ''
  if (body.source_type === 'blog_post' && body.source_id) {
    const post = await query(`SELECT title, excerpt, content FROM blog_posts WHERE id = $1 AND company_id = $2`, [body.source_id, body.company_id])
    if (post.rows.length === 0) return c.json({ error: 'Blog post not found' }, 404)
    sourceText = `Blog post titled "${post.rows[0].title}". Excerpt: ${post.rows[0].excerpt ?? ''}\n\n${(post.rows[0].content ?? '').slice(0, 3000)}`
  } else if (body.source_type === 'job_listing' && body.source_id) {
    const role = await query(`SELECT title, employment_type, description, required_skills FROM hiring_roles WHERE id = $1 AND company_id = $2`, [body.source_id, body.company_id])
    if (role.rows.length === 0) return c.json({ error: 'Job listing not found' }, 404)
    const r = role.rows[0]
    sourceText = `Open role: "${r.title}" (${r.employment_type}). Description: ${r.description ?? ''}. Required skills: ${(r.required_skills ?? []).join(', ')}`
  } else if (body.prompt) {
    sourceText = body.prompt
  } else {
    return c.json({ error: 'Provide source_type + source_id, or a freeform prompt' }, 400)
  }

  const prompt = `You write LinkedIn posts for a cybersecurity and IT consulting company. Write one LinkedIn post (120-220 words, no hashtag spam, max 3 relevant hashtags at the end, professional but not corporate-stiff) based on this source material:\n\n${sourceText}\n\nReturn ONLY the post text, no preamble, no markdown fences.`

  try {
    const draft = await ollamaComplete(prompt)
    return c.json({ draft: draft.trim() })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Draft generation failed' }, 502)
  }
})

// ── PATCH /api/social/posts/:id ──────────────────────────────────────────────

app.patch('/api/social/posts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json<{ content?: string; media_url?: string; scheduled_at?: string | null }>()

  const existing = await query(`SELECT * FROM social_posts WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (existing.rows[0].status === 'published') return c.json({ error: 'Cannot edit a published post' }, 400)
  const before = existing.rows[0]

  const result = await query(
    `UPDATE social_posts SET
       content = COALESCE($1, content),
       media_url = COALESCE($2, media_url),
       scheduled_at = $3,
       status = CASE WHEN $3::timestamptz IS NOT NULL THEN 'scheduled' ELSE 'draft' END
     WHERE id = $4 RETURNING *`,
    [body.content ?? null, body.media_url ?? null, body.scheduled_at ?? null, id]
  )
  const post = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'social_posts', op: 'update', id, before, after: post, companyId: before.company_id,
  })

  return c.json({ post })
})

// ── DELETE /api/social/posts/:id ─────────────────────────────────────────────

app.delete('/api/social/posts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT * FROM social_posts WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  await query(`DELETE FROM social_posts WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'social_posts', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── POST /api/social/posts/:id/publish ───────────────────────────────────────

app.post('/api/social/posts/:id/publish', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT p.*, sc.access_token, sc.account_id, sc.connection_type
     FROM social_posts p JOIN social_connections sc ON sc.id = p.connection_id
     WHERE p.id = $1`,
    [id]
  )
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  const post = result.rows[0]
  if (!companyIds.includes(post.company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (post.status === 'published') return c.json({ error: 'Already published' }, 400)
  if (post.connection_type === 'organization' && post.account_id === 'pending') {
    return c.json({ error: 'This connection needs its organization URN set first (PATCH /api/social/connections/:id)' }, 400)
  }

  try {
    const { postUrn } = await createLinkedInPost(post.access_token, post.account_id, post.content, post.media_url ?? undefined)
    const updated = await query(
      `UPDATE social_posts SET status = 'published', published_at = NOW(), external_post_urn = $1, error_message = NULL WHERE id = $2 RETURNING *`,
      [postUrn, id]
    )
    const publishedPost = updated.rows[0]

    await writeMutationAuditLog(c, {
      table: 'social_posts', op: 'update', id,
      before: { status: post.status }, after: { status: 'published', external_post_urn: postUrn },
      companyId: post.company_id,
    })

    return c.json({ post: publishedPost })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Publish failed'
    await query(`UPDATE social_posts SET status = 'failed', error_message = $1 WHERE id = $2`, [msg.slice(0, 500), id])

    await writeMutationAuditLog(c, {
      table: 'social_posts', op: 'update', id,
      before: { status: post.status }, after: { status: 'failed', error_message: msg.slice(0, 500) },
      companyId: post.company_id,
    })

    return c.json({ error: msg }, 502)
  }
})

export default app
