import { Hono } from 'hono'
import { auth } from '../lib/auth'
import { query } from '../lib/db'

const app = new Hono()

app.get('/api/session', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: 'Unauthorized' }, 401)

  const result = await query(
    `SELECT u.id, u.name, u.email, u.role, u.telegram_chat_id,
            array_agg(DISTINCT uc.company_id) FILTER (WHERE uc.company_id IS NOT NULL) as company_ids,
            json_agg(DISTINCT jsonb_build_object('id', co.id, 'name', co.name, 'invoice_prefix', co.invoice_prefix))
              FILTER (WHERE co.id IS NOT NULL) as companies
     FROM users u
     LEFT JOIN user_companies uc ON uc.user_id = u.id
     LEFT JOIN companies co ON co.id = uc.company_id
     WHERE u.email = $1 AND u.is_active = true
     GROUP BY u.id`,
    [session.user.email]
  )

  if (result.rows.length === 0) return c.json({ error: 'User not found' }, 401)

  const user = result.rows[0]
  return c.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    telegramChatId: user.telegram_chat_id,
    companyIds: user.company_ids || [],
    companies: user.companies || [],
  })
})

export default app
