import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// GET /api/notifications — paginated list (last 30)
app.get('/api/notifications', requireAuth, async (c) => {
  const userId = c.get('userId')
  const result = await query(
    `SELECT id, type, title, body, link, read, created_at
     FROM app_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [userId]
  )
  return c.json(result.rows)
})

// GET /api/notifications/unread-count
app.get('/api/notifications/unread-count', requireAuth, async (c) => {
  const userId = c.get('userId')
  const result = await query(
    `SELECT COUNT(*) as count FROM app_notifications WHERE user_id = $1 AND read = FALSE`,
    [userId]
  )
  return c.json({ count: parseInt(result.rows[0]?.count ?? '0', 10) })
})

// PATCH /api/notifications/read-all — must come before /:id/read to avoid route collision
app.patch('/api/notifications/read-all', requireAuth, async (c) => {
  const userId = c.get('userId')
  await query(
    `UPDATE app_notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
    [userId]
  )
  return c.json({ ok: true })
})

// PATCH /api/notifications/:id/read
app.patch('/api/notifications/:id/read', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { id } = c.req.param()
  await query(
    `UPDATE app_notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return c.json({ ok: true })
})

export default app
