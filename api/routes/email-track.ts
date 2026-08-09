import { Hono } from 'hono'
import { query } from '../lib/db'

const app = new Hono()

// Public - no auth. These URLs are embedded in outbound emails and hit by
// recipients' mail clients / browsers, which never have a CBOP session.

// 1x1 transparent GIF, served as a Buffer constant (no filesystem read per request)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
)

// ── GET /api/email-track/open/:token.gif ─────────────────────────────────────

app.get('/api/email-track/open/:tokenGif', async (c) => {
  const tokenGif = c.req.param('tokenGif')
  const token = tokenGif.replace(/\.gif$/, '')

  query(
    `UPDATE email_send_log SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1 WHERE tracking_token = $1`,
    [token]
  ).catch(() => { /* tracking must never error out to the recipient's mail client */ })

  c.header('Content-Type', 'image/gif')
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  return c.body(TRANSPARENT_GIF)
})

// ── GET /api/email-track/click/:token?url=... ────────────────────────────────
//
// The `url` query param is attacker-controllable (it's a public, unauthenticated
// endpoint reachable by anyone, not just a real recipient's mail client) - so it
// must never be redirected to blindly, or this becomes an open redirect stamped
// with CBOP's own trusted domain (great for phishing). Instead we look up the
// actual HTML we sent for this token (email_send_log.rendered_html, already
// stored per migration 031) and only redirect if `url` is one of the real
// destination URLs that rewriteLinksForTracking() embedded for THIS token -
// so a forged token+url combination that was never actually sent is rejected.

function extractTrackedUrls(renderedHtml: string, token: string): Set<string> {
  const urls = new Set<string>()
  const pattern = new RegExp(
    `/api/email-track/click/${token}\\?url=([^"'&\\s]+)`, 'g'
  )
  let m: RegExpExecArray | null
  while ((m = pattern.exec(renderedHtml)) !== null) {
    try { urls.add(decodeURIComponent(m[1])) } catch { /* skip malformed */ }
  }
  return urls
}

app.get('/api/email-track/click/:token', async (c) => {
  const token = c.req.param('token')
  const url = c.req.query('url')

  if (!url || !/^https?:\/\//i.test(url)) {
    return c.text('Invalid link', 400)
  }

  const { rows: [sent] } = await query<{ rendered_html: string | null }>(
    `SELECT rendered_html FROM email_send_log WHERE tracking_token = $1`,
    [token]
  )
  if (!sent?.rendered_html) {
    return c.text('Invalid or expired link', 400)
  }

  const trackedUrls = extractTrackedUrls(sent.rendered_html, token)
  if (!trackedUrls.has(url)) {
    return c.text('Invalid link', 400)
  }

  query(
    `UPDATE email_send_log SET clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1 WHERE tracking_token = $1`,
    [token]
  ).catch(() => { /* tracking must never block the redirect */ })

  return c.redirect(url, 302)
})

export default app
