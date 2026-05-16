import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'
import { randomBytes } from 'crypto'

const app = new Hono()

type Persona = 'ca' | 'mba' | 'marketing_advisor' | 'tech_consultant'

const PERSONA_LABELS: Record<Persona, string> = {
  ca:                  'Chartered Accountant',
  mba:                 'MBA / Business Strategist',
  marketing_advisor:   'Marketing Advisor',
  tech_consultant:     'Tech Consultant',
}

const PERSONA_PROMPTS: Record<Persona, string> = {
  ca: 'You are an experienced Chartered Accountant advising a tech entrepreneur in India. Focus on tax planning, GST compliance, cash flow, P&L optimization, and financial regulations.',
  mba: 'You are an MBA-trained business strategist. Focus on growth, market positioning, competitive moats, unit economics, and strategic decisions.',
  marketing_advisor: 'You are a seasoned marketing advisor specializing in B2B tech companies. Focus on positioning, lead generation, content strategy, and brand building.',
  tech_consultant: 'You are a senior technology consultant advising on architecture, hiring, tooling, security, and engineering team strategy.',
}

async function callOpenClaw(persona: Persona, history: { role: string; content: string }[]): Promise<string> {
  const url = process.env.OPENCLAW_URL
  if (!url) throw new Error('OPENCLAW_URL not configured')

  const res = await fetch(`${url}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'mentor_council',
      payload: {
        persona,
        system: PERSONA_PROMPTS[persona],
        history,
      },
    }),
  })

  if (!res.ok) throw new Error(`OpenClaw agent error: ${res.status}`)
  const data = await res.json() as { response?: string; message?: string }
  return data.response ?? data.message ?? 'No response from agent'
}

// ── GET /api/mentor/history/:persona ────────────────────────────────────────

app.get('/api/mentor/history/:persona', requireAuth, requireRole('ceo'), async (c) => {
  const userId  = c.get('userId') as string
  const persona = c.req.param('persona') as Persona

  if (!PERSONA_LABELS[persona]) return c.json({ error: 'Invalid persona' }, 400)

  const result = await query(
    `SELECT id, persona, messages, updated_at
     FROM mentor_conversations
     WHERE user_id = $1 AND persona = $2`,
    [userId, persona]
  )

  if (result.rows.length === 0) {
    return c.json({ conversation: null, messages: [] })
  }

  const row = result.rows[0]
  return c.json({
    conversation: { id: row.id, persona: row.persona, updated_at: row.updated_at },
    messages: row.messages as { role: string; content: string; ts: string }[],
  })
})

// ── POST /api/mentor/chat ────────────────────────────────────────────────────

app.post('/api/mentor/chat', requireAuth, requireRole('ceo'), async (c) => {
  const userId  = c.get('userId') as string
  const body    = await c.req.json()
  const { persona, message } = body as { persona: Persona; message: string }

  if (!PERSONA_LABELS[persona]) return c.json({ error: 'Invalid persona' }, 400)
  if (!message?.trim()) return c.json({ error: 'message required' }, 400)

  // Load or create conversation
  let convResult = await query(
    `SELECT id, messages FROM mentor_conversations WHERE user_id = $1 AND persona = $2`,
    [userId, persona]
  )

  if (convResult.rows.length === 0) {
    convResult = await query(
      `INSERT INTO mentor_conversations (user_id, persona, messages)
       VALUES ($1, $2, '[]')
       RETURNING id, messages`,
      [userId, persona]
    )
  }

  const convId   = convResult.rows[0].id as string
  const history  = convResult.rows[0].messages as { role: string; content: string; ts: string }[]

  const newUserMsg = { role: 'user', content: message.trim(), ts: new Date().toISOString() }
  const updatedHistory = [...history, newUserMsg]

  // Call OpenClaw agent
  let agentResponse: string
  let agentError: string | null = null

  try {
    agentResponse = await callOpenClaw(persona, updatedHistory.map(m => ({ role: m.role, content: m.content })))
  } catch (err) {
    agentError = err instanceof Error ? err.message : 'Agent unavailable'
    agentResponse = `[Mentor offline — message saved. ${agentError}]`
  }

  const assistantMsg = { role: 'assistant', content: agentResponse, ts: new Date().toISOString() }
  const finalHistory = [...updatedHistory, assistantMsg]

  await query(
    `UPDATE mentor_conversations
     SET messages = $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(finalHistory), convId]
  )

  return c.json({
    conversation_id: convId,
    response: agentResponse,
    error: agentError,
  })
})

// ── POST /api/mentor/share ───────────────────────────────────────────────────

app.post('/api/mentor/share', requireAuth, requireRole('ceo'), async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json()
  const { persona } = body as { persona: Persona }

  if (!PERSONA_LABELS[persona]) return c.json({ error: 'Invalid persona' }, 400)

  const convResult = await query(
    `SELECT id FROM mentor_conversations WHERE user_id = $1 AND persona = $2`,
    [userId, persona]
  )

  if (convResult.rows.length === 0) return c.json({ error: 'No conversation found' }, 404)

  const conversationId = convResult.rows[0].id as string
  const token          = randomBytes(24).toString('hex')
  const expiresAt      = new Date(Date.now() + 72 * 60 * 60 * 1000)

  await query(
    `INSERT INTO mentor_share_links (conversation_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [conversationId, token, expiresAt.toISOString()]
  )

  return c.json({ token, expires_at: expiresAt.toISOString() })
})

// ── GET /api/mentor/shared/:token ────────────────────────────────────────────
// Public — no auth required

app.get('/api/mentor/shared/:token', async (c) => {
  const token = c.req.param('token')

  const result = await query(
    `SELECT msl.expires_at, mc.persona, mc.messages, mc.updated_at
     FROM mentor_share_links msl
     JOIN mentor_conversations mc ON mc.id = msl.conversation_id
     WHERE msl.token = $1`,
    [token]
  )

  if (result.rows.length === 0) return c.json({ error: 'Link not found' }, 404)

  const row = result.rows[0]
  if (new Date(row.expires_at) < new Date()) {
    return c.json({ error: 'Link expired' }, 410)
  }

  return c.json({
    persona:     row.persona,
    persona_label: PERSONA_LABELS[row.persona as Persona] ?? row.persona,
    messages:    row.messages,
    updated_at:  row.updated_at,
    expires_at:  row.expires_at,
  })
})

export default app
