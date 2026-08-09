import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { triggerAgent } from '../lib/openclaw'
import '../lib/hono-vars'
import { randomBytes } from 'crypto'

const app = new Hono()

type Persona = 'ca' | 'accountant' | 'tax_saving' | 'itr_filing' | 'auditor' | 'mba' | 'marketing_advisor' | 'tech_consultant' | 'legal'

const PERSONA_LABELS: Record<Persona, string> = {
  ca:                  'CA / Compliance',
  accountant:          'Accountant',
  tax_saving:          'Tax Saving',
  itr_filing:          'ITR Filing',
  auditor:             'Auditor',
  mba:                 'Business Consultant',
  marketing_advisor:   'Marketing Advisor',
  tech_consultant:     'Tech Consultant',
  legal:               'Legal',
}

const PERSONA_PROMPTS: Record<Persona, string> = {
  ca: 'You are a Chartered Accountant advising a tech entrepreneur running multiple companies in India. Your scope is specifically GST compliance, statutory filings, and audit-readiness of the books - not tax-saving strategy or return filing, those are separate advisors the founder can consult directly. Flag compliance gaps and regulatory risk directly and specifically.',
  accountant: 'You are the company accountant handling day-to-day bookkeeping for a founder running multiple companies in India. Focus on cash flow management, P&L accuracy, expense categorization, reconciliation, and the monthly close process. Practical and process-oriented - not tax strategy or compliance filings, those are separate advisors.',
  tax_saving: 'You are a tax-saving strategist advising a founder running multiple companies in India. Focus specifically on proactive tax optimization: eligible deductions and exemptions, timing of income/expenses, entity structuring for tax efficiency, and personal tax planning alongside company-level strategy. This is forward-looking planning - not compliance or return filing, those are separate advisors.',
  itr_filing: 'You are an ITR filing specialist advising a founder running multiple companies in India. Focus specifically on personal and company income tax return filing: which ITR form applies, required documents, filing deadlines, and common filing mistakes to avoid. This is execution-focused - not tax strategy or GST compliance, those are separate advisors.',
  auditor: "You are an internal auditor reviewing real financial data for a founder running multiple companies in India. You will be given a live data digest pulled directly from the company's books - base every finding strictly on those figures, never invent or estimate numbers that weren't given to you. Flag anything that needs investigation: duplicate expenses, unusual category spending spikes, overdue invoices, months with negative margin. Be direct and specific, and cite the actual figures from the digest.",
  mba: 'You are an MBA-trained business strategist. Focus on growth, market positioning, competitive moats, unit economics, and strategic decisions.',
  marketing_advisor: 'You are a seasoned marketing advisor specializing in B2B tech companies. Focus on positioning, lead generation, content strategy, and brand building.',
  tech_consultant: 'You are a senior technology consultant advising on architecture, hiring, tooling, security, and engineering team strategy.',
  legal: 'You are experienced legal counsel advising a founder running multiple companies in India. Focus on contracts and MOUs, employment and HR compliance, IP protection, company incorporation/structuring questions, and general regulatory risk. Flag clearly when something needs a licensed lawyer to actually execute or file, but give real, specific guidance rather than a generic disclaimer.',
}

// ── AI Auditor: grounded in real data, not blind chat ──────────────────────────
// Detection is deterministic SQL (auditable, no hallucinated numbers). The LLM's
// only job is to synthesize the findings into a prioritized narrative.

async function buildAuditDigest(companyIds: string[]): Promise<string> {
  if (companyIds.length === 0) return 'No companies in scope for this account.'

  const [dupExpenses, categorySpikes, overdueInvoices, negativeMonths] = await Promise.all([
    query(
      `SELECT DISTINCT c.name AS company_name, a.category, a.amount, a.date, a.description
       FROM finance_expenses a
       JOIN finance_expenses b ON b.company_id = a.company_id AND b.amount = a.amount
         AND b.category = a.category AND b.id != a.id AND ABS(b.date - a.date) <= 3
       JOIN companies c ON c.id = a.company_id
       WHERE a.company_id = ANY($1)
       ORDER BY a.date DESC LIMIT 15`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `WITH monthly AS (
         SELECT company_id, category, date_trunc('month', date) AS month, SUM(amount) AS total
         FROM finance_expenses WHERE company_id = ANY($1)
         GROUP BY company_id, category, date_trunc('month', date)
       )
       SELECT c.name AS company_name, m1.category, m1.total AS this_month, AVG(m2.total) AS avg_prior_3mo
       FROM monthly m1
       JOIN companies c ON c.id = m1.company_id
       JOIN monthly m2 ON m2.company_id = m1.company_id AND m2.category = m1.category
         AND m2.month < m1.month AND m2.month >= m1.month - INTERVAL '3 months'
       WHERE m1.month = date_trunc('month', CURRENT_DATE)
       GROUP BY c.name, m1.category, m1.total
       HAVING m1.total > AVG(m2.total) * 1.5
       LIMIT 15`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT c.name AS company_name, COUNT(*)::int AS count, COALESCE(SUM(i.total), 0)::numeric AS total
       FROM sales_invoices i JOIN companies c ON c.id = i.company_id
       WHERE i.company_id = ANY($1) AND i.due_date < CURRENT_DATE AND i.status != 'paid'
       GROUP BY c.name`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT c.name AS company_name, fmp.month, fmp.revenue, fmp.expenses, fmp.profit
       FROM finance_monthly_pl fmp JOIN companies c ON c.id = fmp.company_id
       WHERE fmp.company_id = ANY($1) AND fmp.profit < 0
       ORDER BY fmp.month DESC LIMIT 10`,
      [companyIds]
    ).catch(() => ({ rows: [] })),
  ])

  const lines: string[] = []

  lines.push(`POTENTIAL DUPLICATE EXPENSES (same amount + category within 3 days): ${dupExpenses.rows.length}`)
  for (const r of dupExpenses.rows) {
    lines.push(`  - ${r.company_name}: ${r.category} - Rs.${r.amount} on ${new Date(r.date).toISOString().slice(0, 10)} (${r.description || 'no description'})`)
  }

  lines.push(`\nCATEGORY SPENDING SPIKES (this month vs 3-month avg, >50% increase): ${categorySpikes.rows.length}`)
  for (const r of categorySpikes.rows) {
    lines.push(`  - ${r.company_name}: ${r.category} - Rs.${Math.round(r.this_month)} this month vs avg Rs.${Math.round(r.avg_prior_3mo)}`)
  }

  lines.push(`\nOVERDUE INVOICES: ${overdueInvoices.rows.length} companies affected`)
  for (const r of overdueInvoices.rows) {
    lines.push(`  - ${r.company_name}: ${r.count} overdue, Rs.${Math.round(r.total)} total`)
  }

  lines.push(`\nMONTHS WITH NEGATIVE MARGIN: ${negativeMonths.rows.length}`)
  for (const r of negativeMonths.rows) {
    lines.push(`  - ${r.company_name}: ${new Date(r.month).toISOString().slice(0, 7)} - revenue Rs.${Math.round(r.revenue)}, expenses Rs.${Math.round(r.expenses)}, profit Rs.${Math.round(r.profit)}`)
  }

  return lines.join('\n')
}

async function callMentorAgent(persona: Persona, history: { role: string; content: string }[], companyIds: string[]): Promise<string> {
  let system = PERSONA_PROMPTS[persona]

  if (persona === 'auditor') {
    const digest = await buildAuditDigest(companyIds)
    system = `${system}\n\nLIVE DATA DIGEST (as of now):\n${digest}`
  }

  const data = await triggerAgent({
    agent: 'mentor_council',
    context: { persona, system, history },
  }) as { response?: string; message?: string }
  return data?.response ?? data?.message ?? 'No response from agent'
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
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
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

  let agentResponse: string
  let agentError: string | null = null

  try {
    agentResponse = await callMentorAgent(persona, updatedHistory.map(m => ({ role: m.role, content: m.content })), companyIds)
  } catch (err) {
    agentError = err instanceof Error ? err.message : 'Agent unavailable'
    agentResponse = `[Mentor offline - message saved. ${agentError}]`
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
// Public - no auth required

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
