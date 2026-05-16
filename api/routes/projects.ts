import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/projects ─────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT
       p.id, p.company_id, p.name, p.status, p.deadline, p.description, p.owner_id, p.created_at,
       co.name AS company_name,
       u.name  AS owner_name,
       COUNT(t.id)::int AS tasks_count,
       COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS tasks_done
     FROM ops_projects p
     LEFT JOIN companies co ON co.id = p.company_id
     LEFT JOIN users u      ON u.id  = p.owner_id
     LEFT JOIN ops_tasks t  ON t.project_id = p.id
     WHERE p.company_id = ANY($1)
     GROUP BY p.id, co.name, u.name
     ORDER BY p.created_at DESC`,
    [companyIds]
  )

  return c.json({ projects: result.rows })
})

// ── POST /api/projects ────────────────────────────────────────────────────────

app.post('/api/projects', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { company_id, name, description, deadline, owner_id } = body

  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const result = await query(
    `INSERT INTO ops_projects (company_id, name, description, deadline, owner_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id, name, status, created_at`,
    [company_id, name, description || null, deadline || null, owner_id || userId]
  )

  return c.json({ project: result.rows[0] }, 201)
})

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────

app.patch('/api/projects/:id', requireAuth, async (c) => {
  const projectId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, description, deadline, owner_id, status } = body

  const validStatuses = ['active', 'on_hold', 'completed', 'cancelled']
  if (status && !validStatuses.includes(status)) return c.json({ error: 'Invalid status' }, 400)

  const result = await query(
    `UPDATE ops_projects
     SET name        = COALESCE($1, name),
         description = COALESCE($2, description),
         deadline    = COALESCE($3, deadline),
         owner_id    = COALESCE($4, owner_id),
         status      = COALESCE($5, status)
     WHERE id = $6 AND company_id = ANY($7)
     RETURNING id, name, status`,
    [name || null, description || null, deadline || null, owner_id || null, status || null, projectId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Project not found' }, 404)
  return c.json({ success: true, project: result.rows[0] })
})

export default app
