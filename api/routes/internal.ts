import { Hono } from 'hono'
import { sendEmail } from '../lib/mailer'

const app = new Hono()

// Internal-only — called by n8n for transactional emails (onboarding, welcome, etc.)
// Protected by N8N_WEBHOOK_SECRET header, same as other webhook endpoints.
// Never expose this route externally via Nginx.
app.post('/api/internal/send-email', async (c) => {
  const secret = c.req.header('x-internal-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()
  const { to, subject, text, html } = body

  if (!to || !subject || (!text && !html)) {
    return c.json({ error: 'Missing required fields: to, subject, and text or html' }, 400)
  }

  await sendEmail({
    to,
    subject,
    text: text || '',
    html: html || `<p>${text}</p>`,
  })

  return c.json({ ok: true })
})

export default app
