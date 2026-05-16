import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/tasks ────────────────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const projectId  = c.req.query('project_id')
  const mine       = c.req.query('mine') === 'true'
  const userId     = c.get('userId') as string

  const result = await query(
    `SELECT
       t.id, t.company_id, t.project_id, t.title, t.status, t.priority,
       t.due_date, t.notes, t.owner_id, t.linked_deal_id, t.created_at,
       p.name  AS project_name,
       u.name  AS owner_name,
       co.name AS company_name
     FROM ops_tasks t
     LEFT JOIN ops_projects p ON p.id = t.project_id
     LEFT JOIN users u        ON u.id = t.owner_id
     LEFT JOIN companies co   ON co.id = t.company_id
     WHERE t.company_id = ANY($1)
       ${projectId ? 'AND t.project_id = $2' : ''}
       ${mine ? `AND t.owner_id = $${projectId ? 3 : 2}` : ''}
     ORDER BY
       CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       t.due_date ASC NULLS LAST,
       t.created_at DESC`,
    [
      companyIds,
      ...(projectId ? [projectId] : []),
      ...(mine ? [userId] : []),
    ]
  )

  return c.json({ tasks: result.rows })
})

// ── POST /api/tasks ───────────────────────────────────────────────────────────

app.post('/api/tasks', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { project_id, title, priority, due_date, notes, owner_id, linked_deal_id } = body

  if (!project_id) return c.json({ error: 'project_id is required — every task must belong to a project' }, 400)
  if (!title)      return c.json({ error: 'title is required' }, 400)

  // Verify project belongs to user's scope and grab company_id
  const projectResult = await query(
    `SELECT id, company_id FROM ops_projects WHERE id = $1 AND company_id = ANY($2)`,
    [project_id, companyIds]
  )
  if (projectResult.rows.length === 0) return c.json({ error: 'Project not found or not in scope' }, 404)

  const company_id = projectResult.rows[0].company_id as string

  const result = await query(
    `INSERT INTO ops_tasks
       (company_id, project_id, title, priority, status, due_date, notes, owner_id, linked_deal_id)
     VALUES ($1, $2, $3, $4, 'todo', $5, $6, $7, $8)
     RETURNING id, title, status, priority, due_date, created_at`,
    [
      company_id, project_id, title,
      priority || 'medium',
      due_date || null,
      notes || null,
      owner_id || userId,
      linked_deal_id || null,
    ]
  )

  return c.json({ task: result.rows[0] }, 201)
})

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

app.patch('/api/tasks/:id', requireAuth, async (c) => {
  const taskId     = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { title, status, priority, due_date, notes, owner_id } = body

  const validStatuses  = ['todo', 'in_progress', 'review', 'done']
  const validPriorities = ['low', 'medium', 'high', 'critical']
  if (status   && !validStatuses.includes(status))   return c.json({ error: 'Invalid status' }, 400)
  if (priority && !validPriorities.includes(priority)) return c.json({ error: 'Invalid priority' }, 400)

  const result = await query(
    `UPDATE ops_tasks
     SET title    = COALESCE($1, title),
         status   = COALESCE($2, status),
         priority = COALESCE($3, priority),
         due_date = COALESCE($4, due_date),
         notes    = COALESCE($5, notes),
         owner_id = COALESCE($6, owner_id)
     WHERE id = $7 AND company_id = ANY($8)
     RETURNING id, title, status, priority`,
    [title || null, status || null, priority || null, due_date || null, notes || null, owner_id || null, taskId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Task not found' }, 404)
  return c.json({ success: true, task: result.rows[0] })
})

export default app
