import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { isGoogleOAuthConfigured, buildAuthUrl, exchangeCodeForTokens, listVerifiedSites, getSearchAnalytics, inspectUrl, listSitemaps, submitSitemap } from '../lib/google-search-console'
import { runReport } from '../lib/google-analytics'
import { getPageSpeed, isPageSpeedConfigured } from '../lib/pagespeed'
import { getConnection, getValidAccessToken } from '../lib/seo-tokens'
import { auditUrl } from '../lib/seo-auditor'
import { randomBytes } from 'crypto'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// In-memory OAuth state store - short-lived (a few minutes), single-server
// deployment (matches how this app already runs - see docs/HANDOFF.md's
// restart notes). Maps state token -> { companyId, userId, expiresAt }.
const oauthState = new Map<string, { companyId: string; userId: string; expiresAt: number }>()

function cleanExpiredState() {
  const now = Date.now()
  for (const [k, v] of oauthState) if (v.expiresAt < now) oauthState.delete(k)
}

// ── GET /api/seo/connections ─────────────────────────────────────────────────

app.get('/api/seo/connections', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT sc.id, sc.company_id, cmp.name AS company_name, sc.site_url, sc.ga4_property_id,
            sc.connected_at, u.name AS connected_by_name
     FROM seo_site_connections sc
     JOIN companies cmp ON cmp.id = sc.company_id
     LEFT JOIN users u ON u.id = sc.connected_by
     WHERE sc.company_id = ANY($1)
     ORDER BY cmp.name`,
    [companyIds]
  )

  return c.json({ connections: result.rows, google_configured: isGoogleOAuthConfigured() })
})

// ── GET /api/seo/oauth/start?company_id=X ────────────────────────────────────

app.get('/api/seo/oauth/start', requireAuth, requireRole('ceo'), async (c) => {
  if (!isGoogleOAuthConfigured()) {
    return c.text('Google OAuth is not configured yet - set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env', 400)
  }

  const companyId = c.req.query('company_id')
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string

  if (!companyId || !companyIds.includes(companyId)) return c.json({ error: 'Invalid or forbidden company_id' }, 403)

  cleanExpiredState()
  const state = randomBytes(24).toString('hex')
  oauthState.set(state, { companyId, userId, expiresAt: Date.now() + 10 * 60 * 1000 })

  return c.redirect(buildAuthUrl(state))
})

// ── GET /api/seo/oauth/callback ───────────────────────────────────────────────

app.get('/api/seo/oauth/callback', requireAuth, async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) return c.redirect(`/settings?tab=seo&error=${encodeURIComponent(error)}`)
  if (!code || !state) return c.redirect('/settings?tab=seo&error=missing_code_or_state')

  cleanExpiredState()
  const pending = oauthState.get(state)
  if (!pending) return c.redirect('/settings?tab=seo&error=state_expired')
  oauthState.delete(state)

  try {
    const tokens = await exchangeCodeForTokens(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    // Google only returns a refresh_token on first consent (prompt=consent forces
    // it every time here, but be defensive - keep the old one if this response omits it)
    const { rows: [conn] } = await query(
      `INSERT INTO seo_site_connections (company_id, site_url, google_access_token, google_refresh_token, token_expires_at, connected_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, site_url) DO UPDATE SET
         google_access_token = EXCLUDED.google_access_token,
         google_refresh_token = COALESCE(EXCLUDED.google_refresh_token, seo_site_connections.google_refresh_token),
         token_expires_at = EXCLUDED.token_expires_at
       RETURNING id, company_id, site_url`,
      [pending.companyId, 'pending-site-selection', tokens.access_token, tokens.refresh_token ?? '', expiresAt, pending.userId]
    )

    await writeMutationAuditLog(c, {
      table: 'seo_site_connections', op: 'create', id: conn.id, after: conn, companyId: pending.companyId,
    })

    return c.redirect('/settings?tab=seo&connected=true')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.redirect(`/settings?tab=seo&error=${encodeURIComponent(msg.slice(0, 200))}`)
  }
})

// ── GET /api/seo/connections/:id/verified-sites ──────────────────────────────
// After OAuth completes, the frontend calls this to show a picker of the
// Google account's actual verified Search Console properties.

app.get('/api/seo/connections/:id/verified-sites', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const conn = await getConnection(id, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)

  try {
    const accessToken = await getValidAccessToken(conn)
    const sites = await listVerifiedSites(accessToken)
    return c.json({ sites })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list sites' }, 502)
  }
})

// ── DELETE /api/seo/connections/:id ──────────────────────────────────────────

app.delete('/api/seo/connections/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT id, company_id, site_url, ga4_property_id FROM seo_site_connections WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  await query(`DELETE FROM seo_site_connections WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'seo_site_connections', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── PATCH /api/seo/connections/:id ───────────────────────────────────────────
// Set the actual site_url (GSC property) and/or GA4 property ID after connecting -
// Google's OAuth callback doesn't tell you which verified property to use, that's
// a separate pick-from-list step the frontend does against listVerifiedSites().

app.patch('/api/seo/connections/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { site_url, ga4_property_id } = body as { site_url?: string; ga4_property_id?: string }

  const existing = await query(`SELECT id, company_id, site_url, ga4_property_id FROM seo_site_connections WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  const result = await query(
    `UPDATE seo_site_connections SET
       site_url = COALESCE($1, site_url),
       ga4_property_id = COALESCE($2, ga4_property_id)
     WHERE id = $3 RETURNING *`,
    [site_url ?? null, ga4_property_id ?? null, id]
  )
  const connection = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'seo_site_connections', op: 'update', id, before, after: connection, companyId: before.company_id,
  })

  return c.json({ connection })
})

// ── Build Unit 2: SEO Monitoring dashboard endpoints ─────────────────────────

function dateRangeFor(days: number): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

// ── GET /api/seo/rankings/:connectionId?days=28 ──────────────────────────────

app.get('/api/seo/rankings/:connectionId', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const conn = await getConnection(c.req.param('connectionId') as string, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)
  if (conn.site_url === 'pending-site-selection') return c.json({ error: 'Pick a verified site for this connection first' }, 400)

  const days = parseInt(c.req.query('days') ?? '28')
  const { startDate, endDate } = dateRangeFor(days)

  try {
    const accessToken = await getValidAccessToken(conn)
    const [byQuery, byPage] = await Promise.all([
      getSearchAnalytics(accessToken, conn.site_url, { startDate, endDate, dimensions: ['query'], rowLimit: 100 }),
      getSearchAnalytics(accessToken, conn.site_url, { startDate, endDate, dimensions: ['page'], rowLimit: 100 }),
    ])
    return c.json({ startDate, endDate, byQuery, byPage })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch rankings' }, 502)
  }
})

// ── GET /api/seo/indexing/:connectionId?url=X ────────────────────────────────

app.get('/api/seo/indexing/:connectionId', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const conn = await getConnection(c.req.param('connectionId') as string, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)
  if (conn.site_url === 'pending-site-selection') return c.json({ error: 'Pick a verified site for this connection first' }, 400)

  const url = c.req.query('url')
  if (!url) return c.json({ error: 'url query param required' }, 400)

  try {
    const accessToken = await getValidAccessToken(conn)
    const result = await inspectUrl(accessToken, conn.site_url, url)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to inspect URL' }, 502)
  }
})

// ── Sitemaps ──────────────────────────────────────────────────────────────────

app.get('/api/seo/sitemaps/:connectionId', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const conn = await getConnection(c.req.param('connectionId') as string, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)
  if (conn.site_url === 'pending-site-selection') return c.json({ error: 'Pick a verified site for this connection first' }, 400)

  try {
    const accessToken = await getValidAccessToken(conn)
    const sitemaps = await listSitemaps(accessToken, conn.site_url)
    return c.json({ sitemaps })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to list sitemaps' }, 502)
  }
})

app.post('/api/seo/sitemaps/:connectionId', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const conn = await getConnection(c.req.param('connectionId') as string, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)
  if (conn.site_url === 'pending-site-selection') return c.json({ error: 'Pick a verified site for this connection first' }, 400)

  const body = await c.req.json()
  const { sitemap_url } = body as { sitemap_url?: string }
  if (!sitemap_url) return c.json({ error: 'sitemap_url required' }, 400)

  try {
    const accessToken = await getValidAccessToken(conn)
    await submitSitemap(accessToken, conn.site_url, sitemap_url)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to submit sitemap' }, 502)
  }
})

// ── GET /api/seo/traffic/:connectionId?days=28 ───────────────────────────────

app.get('/api/seo/traffic/:connectionId', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const conn = await getConnection(c.req.param('connectionId') as string, companyIds)
  if (!conn) return c.json({ error: 'Not found' }, 404)

  if (!conn.ga4_property_id) return c.json({ connected: false, message: 'GA4 not connected for this site yet' })

  const days = parseInt(c.req.query('days') ?? '28')
  const { startDate, endDate } = dateRangeFor(days)

  try {
    const accessToken = await getValidAccessToken(conn)
    const report = await runReport(accessToken, conn.ga4_property_id, {
      dateRanges: [{ startDate, endDate }],
      dimensions: ['date'],
      metrics: ['sessions', 'totalUsers', 'conversions'],
    })
    return c.json({ connected: true, report })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch traffic' }, 502)
  }
})

// ── GET /api/seo/pagespeed?url=X&strategy=mobile|desktop ─────────────────────
// No connection required - PageSpeed Insights only needs an API key, no OAuth.

app.get('/api/seo/pagespeed', requireAuth, requireRole('ceo'), async (c) => {
  if (!isPageSpeedConfigured()) return c.json({ error: 'PageSpeed Insights not configured - set GOOGLE_PAGESPEED_API_KEY' }, 400)

  const url = c.req.query('url')
  const strategy = (c.req.query('strategy') as 'mobile' | 'desktop') || 'mobile'
  if (!url) return c.json({ error: 'url query param required' }, 400)

  try {
    const result = await getPageSpeed(url, strategy)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to fetch PageSpeed data' }, 502)
  }
})

// ── Build Unit 3: in-house technical SEO auditor (no external API) ──────────

app.post('/api/seo/audit', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, url } = body as { company_id?: string; url?: string }

  if (!company_id || !companyIds.includes(company_id)) return c.json({ error: 'Invalid or forbidden company_id' }, 403)
  if (!url) return c.json({ error: 'url required' }, 400)

  try {
    const result = await auditUrl(url)
    const inserted = await query(
      `INSERT INTO technical_seo_audits (company_id, url, score, issues) VALUES ($1, $2, $3, $4) RETURNING *`,
      [company_id, url, result.score, JSON.stringify(result.issues)]
    )
    const audit = inserted.rows[0]

    await writeMutationAuditLog(c, {
      table: 'technical_seo_audits', op: 'create', id: audit.id, after: audit, companyId: company_id,
    })

    return c.json({ audit })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Audit failed' }, 502)
  }
})

app.get('/api/seo/audits', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId = c.req.query('company_id')

  if (!companyId || !companyIds.includes(companyId)) return c.json({ error: 'Invalid or forbidden company_id' }, 403)

  const result = await query(
    `SELECT id, url, score, issues, audited_at FROM technical_seo_audits
     WHERE company_id = $1 ORDER BY audited_at DESC LIMIT 50`,
    [companyId]
  )
  return c.json({ audits: result.rows })
})

export default app
