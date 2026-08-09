import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import { notFound, validationError } from '../lib/route-utils'
import '../lib/hono-vars'

const app = new Hono()

const VALID_CATEGORIES = ['client', 'product', 'ops', 'rnd']
const VALID_HEALTHS    = ['on_track', 'at_risk', 'blocked']

// ── GET /api/projects ─────────────────────────────────────────────────────────

app.get('/api/projects', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const workType   = c.req.query('work_type')

  const result = await query(
    `SELECT
       p.id, p.company_id, p.name, p.status, p.work_type, p.category, p.health,
       p.deadline, p.description, p.owner_id, p.created_at,
       co.name AS company_name,
       u.name  AS owner_name,
       COUNT(t.id)::int AS tasks_count,
       COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS tasks_done
     FROM ops_projects p
     LEFT JOIN companies co ON co.id = p.company_id
     LEFT JOIN users u      ON u.id  = p.owner_id
     LEFT JOIN ops_tasks t  ON t.project_id = p.id
     WHERE (p.company_id = ANY($1) OR p.work_type = 'internal')
       ${workType ? "AND p.work_type = $2" : ''}
     GROUP BY p.id, co.name, u.name
     ORDER BY p.created_at DESC`,
    workType ? [companyIds, workType] : [companyIds]
  )

  return c.json({ projects: result.rows })
})

// ── POST /api/projects ────────────────────────────────────────────────────────

app.post('/api/projects', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const { company_id, name, description, deadline, owner_id, category } = body

  if (!name) return validationError(c, 'name is required')

  const cat      = VALID_CATEGORIES.includes(category) ? category : 'client'
  const workType = cat === 'client' ? 'client' : 'internal'

  if (cat === 'client') {
    if (!company_id)                      return validationError(c, 'company_id is required for client projects')
    if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)
  }

  const result = await query(
    `INSERT INTO ops_projects (company_id, name, description, deadline, owner_id, status, work_type, category)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
     RETURNING id, name, status, work_type, category, health, created_at`,
    [
      workType === 'internal' ? null : company_id,
      name,
      description || null,
      deadline || null,
      owner_id || userId,
      workType,
      cat,
    ]
  )

  return c.json({ project: result.rows[0] }, 201)
})

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────

app.patch('/api/projects/:id', requireAuth, async (c) => {
  const projectId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, description, deadline, owner_id, status, health, category } = body

  const validStatuses = ['active', 'on_hold', 'completed', 'cancelled']
  if (status   && !validStatuses.includes(status))      return validationError(c, 'Invalid status')
  if (health   && !VALID_HEALTHS.includes(health))      return validationError(c, 'Invalid health')
  if (category && !VALID_CATEGORIES.includes(category)) return validationError(c, 'Invalid category')

  const result = await query(
    `UPDATE ops_projects
     SET name        = COALESCE($1, name),
         description = COALESCE($2, description),
         deadline    = COALESCE($3, deadline),
         owner_id    = COALESCE($4, owner_id),
         status      = COALESCE($5, status),
         health      = COALESCE($6, health),
         category    = COALESCE($7, category)
     WHERE id = $8 AND (company_id = ANY($9) OR work_type = 'internal')
     RETURNING id, name, status, work_type, category, health`,
    [
      name || null, description || null, deadline || null, owner_id || null,
      status || null, health || null, category || null,
      projectId, companyIds,
    ]
  )

  if (result.rows.length === 0) return notFound(c, 'Project')
  return c.json({ success: true, project: result.rows[0] })
})

export default app
