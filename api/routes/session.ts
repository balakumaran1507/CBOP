import { Hono } from 'hono'
import { query } from '../lib/db'
import { requireAuth } from '../middleware/require-auth'
import { buildNavManifest } from '../lib/modules'
import '../lib/hono-vars'

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
    `SELECT id, name, email, telegram_chat_id FROM users WHERE id = $1`,
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
  await query(`UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, [name.trim(), userId])
  return c.json({ ok: true })
})

export default app
