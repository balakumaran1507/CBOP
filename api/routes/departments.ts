import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/departments ──────────────────────────────────────────────────────
// Lists departments for user's companies, with employee count and manager name.

app.get('/api/departments', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')

  const params: unknown[] = [companyIds]
  let companyFilter = ''
  if (companyId) {
    if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden: company not in scope' }, 403)
    params.push(companyId)
    companyFilter = `AND d.company_id = $${params.length}`
  }

  const result = await query(
    `SELECT
       d.id,
       d.company_id,
       d.name,
       d.description,
       d.manager_id,
       d.created_at,
       co.name AS company_name,
       COUNT(DISTINCT e.id) FILTER (WHERE e.is_active = true) AS employee_count,
       CONCAT(m.first_name, ' ', m.last_name) AS manager_name
     FROM departments d
     LEFT JOIN companies  co ON co.id = d.company_id
     LEFT JOIN employees  e  ON e.department_id = d.id
     LEFT JOIN employees  m  ON m.id = d.manager_id
     WHERE d.company_id = ANY($1) ${companyFilter}
     GROUP BY d.id, co.name, m.first_name, m.last_name
     ORDER BY d.name ASC`,
    params
  )

  return c.json({ departments: result.rows })
})

// ── POST /api/departments ─────────────────────────────────────────────────────

app.post('/api/departments', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json() as {
    company_id: string
    name: string
    description?: string
    manager_id?: string
  }
  const { company_id, name, description, manager_id } = body

  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  // Validate manager belongs to the same company if provided
  if (manager_id) {
    const managerCheck = await query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [manager_id, company_id]
    )
    if (managerCheck.rows.length === 0) return c.json({ error: 'Manager not found or not in same company' }, 400)
  }

  const result = await query(
    `INSERT INTO departments (company_id, name, description, manager_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, company_id, name, description, manager_id, created_at`,
    [company_id, name, description || null, manager_id || null]
  )

  return c.json({ department: result.rows[0] }, 201)
})

// ── PATCH /api/departments/:id ────────────────────────────────────────────────

app.patch('/api/departments/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds   = c.get('companyIds') as string[]
  const departmentId = c.req.param('id')
  const body         = await c.req.json() as {
    name?: string
    description?: string
    manager_id?: string | null
  }

  // Verify department is in scope
  const existing = await query(
    `SELECT id, company_id FROM departments WHERE id = $1 AND company_id = ANY($2)`,
    [departmentId, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Department not found' }, 404)

  const dept = existing.rows[0]

  // Validate manager if provided
  if (body.manager_id) {
    const managerCheck = await query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [body.manager_id, dept.company_id]
    )
    if (managerCheck.rows.length === 0) return c.json({ error: 'Manager not found or not in same company' }, 400)
  }

  const setClauses: string[] = []
  const params: unknown[]    = []

  if (body.name !== undefined) {
    params.push(body.name)
    setClauses.push(`name = $${params.length}`)
  }
  if (body.description !== undefined) {
    params.push(body.description)
    setClauses.push(`description = $${params.length}`)
  }
  if ('manager_id' in body) {
    params.push(body.manager_id ?? null)
    setClauses.push(`manager_id = $${params.length}`)
  }

  if (setClauses.length === 0) return c.json({ error: 'No fields to update' }, 400)

  params.push(departmentId)
  const result = await query(
    `UPDATE departments SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  )

  return c.json({ department: result.rows[0] })
})

// ── DELETE /api/departments/:id ───────────────────────────────────────────────
// Guard: only allowed if no active employees are assigned to this department.

app.delete('/api/departments/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds   = c.get('companyIds') as string[]
  const departmentId = c.req.param('id')

  // Scope check
  const existing = await query(
    `SELECT id FROM departments WHERE id = $1 AND company_id = ANY($2)`,
    [departmentId, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Department not found' }, 404)

  // Guard: check for active employees
  const activeEmployees = await query(
    `SELECT COUNT(*) AS cnt FROM employees WHERE department_id = $1 AND is_active = true`,
    [departmentId]
  )
  if (parseInt(activeEmployees.rows[0].cnt, 10) > 0) {
    return c.json({ error: 'Cannot delete department with active employees. Reassign or offboard them first.' }, 409)
  }

  await query(`DELETE FROM departments WHERE id = $1`, [departmentId])

  return c.json({ ok: true })
})

export default app
