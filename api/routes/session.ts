import { Hono } from 'hono'
import { query } from '../lib/db'
import { requireAuth } from '../middleware/require-auth'
import { buildNavManifest } from '../lib/modules'
import '../lib/hono-vars'
import * as fs from 'fs'
import * as path from 'path'

const app = new Hono()

// Session payload — also the source of the sidebar nav manifest (IF-5).
// requireAuth has already resolved companyIds, the active company, and the
// enabled/allowed module lists for THAT company (IF-4), so this route just
// serialises them. The sidebar renders the `nav` array verbatim; it holds no
// role list of its own, which is what makes drift impossible.
app.get('/api/session', requireAuth, async (c) => {
  const userId          = c.get('userId')
  const role            = c.get('role')
  const companyIds      = c.get('companyIds') ?? []
  const activeCompanyId = c.get('activeCompanyId') ?? null
  const enabledModules  = c.get('enabledModules') ?? []
  const allowedModules  = c.get('allowedModules') ?? []

  const result = await query(
    `SELECT id, name, email, telegram_chat_id, avatar_url FROM users WHERE id = $1`,
    [userId]
  )
  if (result.rows.length === 0) return c.json({ error: 'User not found' }, 401)
  const user = result.rows[0]

  // companyIds already accounts for the creator tier (all companies).
  const companiesResult = companyIds.length
    ? await query(
        `SELECT id, name, invoice_prefix FROM companies WHERE id = ANY($1) ORDER BY name`,
        [companyIds]
      )
    : { rows: [] }

  return c.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    role,
    telegramChatId: user.telegram_chat_id,
    avatarUrl: user.avatar_url,
    companyIds,
    companies: companiesResult.rows,
    activeCompanyId,
    enabledModules,
    allowedModules,
    nav: buildNavManifest(allowedModules, enabledModules),
  })
})

app.patch('/api/session/profile', requireAuth, async (c) => {
  const { name } = await c.req.json()
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return c.json({ error: 'Name must be at least 2 characters' }, 400)
  }
  const userId = c.get('userId')
  await query(`UPDATE users SET name = $1 WHERE id = $2`, [name.trim(), userId])
  return c.json({ ok: true })
})

const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
}
const AVATAR_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

app.post('/api/session/avatar', requireAuth, async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'No file provided' }, 400)

    // Derive extension from validated MIME — never from filename (XSS vector)
    const ext = AVATAR_MIME_TO_EXT[file.type]
    if (!ext) return c.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, 400)

    if (file.size > AVATAR_MAX_BYTES) return c.json({ error: 'File must be under 5 MB' }, 400)

    const userId = c.get('userId')
    // Deterministic filename per user — uploading again overwrites, no orphan files
    const fname = `user-${userId}.${ext}`
    const dir = path.join(process.cwd(), 'uploads', 'avatars')

    await fs.promises.mkdir(dir, { recursive: true })
    const buf = Buffer.from(await file.arrayBuffer())
    await fs.promises.writeFile(path.join(dir, fname), buf)

    const avatarUrl = `/api/uploads/avatars/${fname}`
    await query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [avatarUrl, userId])

    return c.json({ avatar_url: avatarUrl })
  } catch (err: any) {
    console.error('[avatar_upload] failed:', err)
    return c.json({ error: 'Failed to upload avatar' }, 500)
  }
})

// ── GET /api/public/lockscreen-stats (Public) ─────────────────────────────────
app.get('/api/public/lockscreen-stats', async (c) => {
  try {
    const dbCheckStart = Date.now()
    const migResult = await query('SELECT count(*)::int AS count FROM schema_migrations')
    const dbLatency = Date.now() - dbCheckStart

    const companiesResult = await query('SELECT count(*)::int AS count FROM companies')
    const tasksResult = await query("SELECT count(*)::int AS count FROM ops_tasks WHERE status != 'done'")
    const userCountResult = await query('SELECT count(*)::int AS count FROM users WHERE is_active = true')

    let n8nHealthy = false
    try {
      const n8nUrl = process.env.N8N_URL ?? 'http://localhost:5678'
      const n8nRes = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(1000) })
      n8nHealthy = n8nRes.ok
    } catch {
      // ignore
    }

    return c.json({
      dbConnected: true,
      dbLatencyMs: dbLatency,
      migrationsApplied: migResult.rows[0]?.count ?? 0,
      activeUsers: userCountResult.rows[0]?.count ?? 0,
      n8nStatus: n8nHealthy ? 'ONLINE' : 'OFFLINE',
      companiesCount: companiesResult.rows[0]?.count ?? 0,
      openTasksCount: tasksResult.rows[0]?.count ?? 0,
      timestamp: new Date().toISOString()
    })
  } catch (err: any) {
    return c.json({
      dbConnected: false,
      error: err.message,
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// ── GET /api/public/profiles (Public) ─────────────────────────────────────────
// Returns only name, email, avatarUrl — no role (role exposure is a security risk on a public endpoint).
// Sorted by display_order set in migration 066.
app.get('/api/public/profiles', async (c) => {
  try {
    const result = await query(
      `SELECT name, email, avatar_url AS "avatarUrl"
       FROM users
       WHERE is_active = true
       ORDER BY display_order NULLS LAST, name`
    )
    return c.json({ profiles: result.rows })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch profiles' }, 500)
  }
})

export default app
