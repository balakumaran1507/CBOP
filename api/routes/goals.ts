import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { notFound, validationError } from '../lib/route-utils'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/goals ────────────────────────────────────────────────────────────

app.get('/api/goals', requireAuth, async (c) => {
  const year    = parseInt(c.req.query('year')    || '', 10)
  const quarter = parseInt(c.req.query('quarter') || '', 10)

  if (!year || !quarter || quarter < 1 || quarter > 4)
    return validationError(c, 'year and quarter (1-4) are required')

  const result = await query(
    `SELECT
       g.id, g.year, g.quarter, g.objective, g.owner_id, g.created_at,
       u.name AS owner_name,
       COALESCE(json_agg(DISTINCT jsonb_build_object(
         'id', kr.id,
         'description', kr.description,
         'target_value', kr.target_value,
         'current_value', kr.current_value,
         'unit', kr.unit
       )) FILTER (WHERE kr.id IS NOT NULL), '[]') AS key_results,
       COALESCE(json_agg(DISTINCT jsonb_build_object(
         'id', p.id,
         'name', p.name,
         'status', p.status,
         'tasks_count', (SELECT COUNT(*) FROM ops_tasks t WHERE t.project_id = p.id),
         'tasks_done', (SELECT COUNT(*) FROM ops_tasks t WHERE t.project_id = p.id AND t.status = 'done')
       )) FILTER (WHERE p.id IS NOT NULL), '[]') AS linked_projects
     FROM quarterly_goals g
     LEFT JOIN users u                ON u.id  = g.owner_id
     LEFT JOIN quarterly_key_results kr ON kr.goal_id = g.id
     LEFT JOIN goal_projects gp       ON gp.goal_id = g.id
     LEFT JOIN ops_projects p         ON p.id = gp.project_id
     WHERE g.year = $1 AND g.quarter = $2
     GROUP BY g.id, u.name
     ORDER BY g.created_at ASC`,
    [year, quarter]
  )

  const goals = result.rows.map(g => {
    const projects   = g.linked_projects as { tasks_count: number; tasks_done: number }[]
    const totalCount = projects.reduce((s, p) => s + Number(p.tasks_count), 0)
    const totalDone  = projects.reduce((s, p) => s + Number(p.tasks_done), 0)
    return { ...g, progress: totalCount > 0 ? Math.round((totalDone / totalCount) * 100) : 0 }
  })

  return c.json({ goals })
})

// ── POST /api/goals ───────────────────────────────────────────────────────────

app.post('/api/goals', requireAuth, async (c) => {
  const body = await c.req.json()
  const { year, quarter, objective, owner_id } = body

  if (!year || !Number.isInteger(Number(year)))              return validationError(c, 'year is required')
  if (!quarter || Number(quarter) < 1 || Number(quarter) > 4) return validationError(c, 'quarter must be 1-4')
  if (!objective?.trim())                                    return validationError(c, 'objective is required')

  const result = await query(
    `INSERT INTO quarterly_goals (year, quarter, objective, owner_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, year, quarter, objective, owner_id, created_at`,
    [Number(year), Number(quarter), objective.trim(), owner_id || null]
  )

  return c.json({ goal: result.rows[0] }, 201)
})

// ── PATCH /api/goals/:id ──────────────────────────────────────────────────────

app.patch('/api/goals/:id', requireAuth, async (c) => {
  const goalId = c.req.param('id')
  const body   = await c.req.json()
  const { objective, owner_id } = body

  const result = await query(
    `UPDATE quarterly_goals
     SET objective = COALESCE($1, objective),
         owner_id  = COALESCE($2, owner_id)
     WHERE id = $3
     RETURNING id, year, quarter, objective, owner_id, created_at`,
    [objective?.trim() || null, owner_id || null, goalId]
  )

  if (result.rows.length === 0) return notFound(c, 'Goal')
  return c.json({ success: true, goal: result.rows[0] })
})

// ── DELETE /api/goals/:id ─────────────────────────────────────────────────────

app.delete('/api/goals/:id', requireAuth, requireRole('ceo'), async (c) => {
  const goalId = c.req.param('id')
  await query(`DELETE FROM quarterly_goals WHERE id = $1`, [goalId])
  return new Response(null, { status: 204 })
})

// ── POST /api/goals/:id/key-results ──────────────────────────────────────────

app.post('/api/goals/:id/key-results', requireAuth, async (c) => {
  const goalId = c.req.param('id')
  const body   = await c.req.json()
  const { description, target_value, unit } = body

  if (!description?.trim()) return validationError(c, 'description is required')

  const result = await query(
    `INSERT INTO quarterly_key_results (goal_id, description, target_value, unit)
     VALUES ($1, $2, $3, $4)
     RETURNING id, goal_id, description, target_value, current_value, unit, created_at`,
    [goalId, description.trim(), target_value ?? null, unit || null]
  )

  return c.json({ key_result: result.rows[0] }, 201)
})

// ── PATCH /api/goals/:id/key-results/:krId ───────────────────────────────────

app.patch('/api/goals/:id/key-results/:krId', requireAuth, async (c) => {
  const krId = c.req.param('krId')
  const body = await c.req.json()
  const { description, target_value, current_value, unit } = body

  const result = await query(
    `UPDATE quarterly_key_results
     SET description   = COALESCE($1, description),
         target_value  = COALESCE($2, target_value),
         current_value = COALESCE($3, current_value),
         unit          = COALESCE($4, unit)
     WHERE id = $5
     RETURNING id, goal_id, description, target_value, current_value, unit`,
    [
      description?.trim() || null,
      target_value ?? null,
      current_value ?? null,
      unit ?? null,
      krId,
    ]
  )

  if (result.rows.length === 0) return notFound(c, 'Key result')
  return c.json({ success: true, key_result: result.rows[0] })
})

// ── DELETE /api/goals/:id/key-results/:krId ───────────────────────────────────

app.delete('/api/goals/:id/key-results/:krId', requireAuth, requireRole('ceo'), async (c) => {
  const krId = c.req.param('krId')
  await query(`DELETE FROM quarterly_key_results WHERE id = $1`, [krId])
  return new Response(null, { status: 204 })
})

// ── POST /api/goals/:id/projects ──────────────────────────────────────────────

app.post('/api/goals/:id/projects', requireAuth, async (c) => {
  const goalId = c.req.param('id')
  const body   = await c.req.json()
  const { project_id } = body

  if (!project_id) return validationError(c, 'project_id is required')

  await query(
    `INSERT INTO goal_projects (goal_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [goalId, project_id]
  )

  return c.json({ success: true }, 201)
})

// ── DELETE /api/goals/:id/projects/:projectId ─────────────────────────────────

app.delete('/api/goals/:id/projects/:projectId', requireAuth, requireRole('ceo'), async (c) => {
  const goalId    = c.req.param('id')
  const projectId = c.req.param('projectId')
  await query(`DELETE FROM goal_projects WHERE goal_id = $1 AND project_id = $2`, [goalId, projectId])
  return new Response(null, { status: 204 })
})

export default app
