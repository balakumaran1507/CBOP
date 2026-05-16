import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/sessions ─────────────────────────────────────────────────────────

app.get('/api/sessions', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT
       s.id, s.company_id, s.project_id, s.goal, s.output,
       s.attendees, s.scheduled_at, s.completed_at,
       p.name  AS project_name,
       co.name AS company_name
     FROM ops_work_sessions s
     LEFT JOIN ops_projects p ON p.id = s.project_id
     LEFT JOIN companies co   ON co.id = s.company_id
     WHERE s.company_id = ANY($1)
     ORDER BY s.scheduled_at DESC NULLS LAST, s.id DESC`,
    [companyIds]
  )

  return c.json({ sessions: result.rows })
})

// ── POST /api/sessions ────────────────────────────────────────────────────────

app.post('/api/sessions', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { project_id, goal, attendees, scheduled_at } = body

  if (!goal?.trim())   return c.json({ error: 'goal is required' }, 400)
  if (!project_id)     return c.json({ error: 'project_id is required' }, 400)

  const projectResult = await query(
    `SELECT id, company_id FROM ops_projects WHERE id = $1 AND company_id = ANY($2)`,
    [project_id, companyIds]
  )
  if (projectResult.rows.length === 0) return c.json({ error: 'Project not found or not in scope' }, 404)

  const company_id = projectResult.rows[0].company_id as string

  const result = await query(
    `INSERT INTO ops_work_sessions (company_id, project_id, goal, attendees, scheduled_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, project_id, goal, attendees, scheduled_at, completed_at`,
    [
      company_id,
      project_id,
      goal.trim(),
      attendees ? JSON.stringify(attendees) : null,
      scheduled_at || null,
    ]
  )

  return c.json({ session: result.rows[0] }, 201)
})

// ── PATCH /api/sessions/:id ───────────────────────────────────────────────────

app.patch('/api/sessions/:id', requireAuth, async (c) => {
  const sessionId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { goal, output, attendees, scheduled_at, completed_at } = body

  // Completing a session requires output
  if (completed_at && !output?.trim()) {
    return c.json({ error: 'output is required when completing a session' }, 400)
  }

  const result = await query(
    `UPDATE ops_work_sessions
     SET goal         = COALESCE($1, goal),
         output       = COALESCE($2, output),
         attendees    = COALESCE($3, attendees),
         scheduled_at = COALESCE($4, scheduled_at),
         completed_at = COALESCE($5, completed_at)
     WHERE id = $6 AND company_id = ANY($7)
     RETURNING id, goal, output, attendees, scheduled_at, completed_at`,
    [
      goal?.trim() || null,
      output?.trim() || null,
      attendees ? JSON.stringify(attendees) : null,
      scheduled_at || null,
      completed_at || null,
      sessionId,
      companyIds,
    ]
  )

  if (result.rows.length === 0) return c.json({ error: 'Session not found' }, 404)
  return c.json({ success: true, session: result.rows[0] })
})

export default app
