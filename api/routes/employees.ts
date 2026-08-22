import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { sendEmail } from '../lib/mailer'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── Salary visibility helper ──────────────────────────────────────────────────
// Salary is only returned to ceo and creator. Redact for coo/cto.

function maybeRedactSalary(row: Record<string, unknown>, role: string): Record<string, unknown> {
  if (role === 'creator' || role === 'ceo') return row
  const { salary, ...rest } = row
  void salary // suppress unused var
  return rest
}

// ── GET /api/employees ────────────────────────────────────────────────────────

app.get('/api/employees', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const role       = c.get('role') as string

  const search      = c.req.query('search')      ?? ''
  const departmentId = c.req.query('department_id') ?? ''
  const isActiveStr  = c.req.query('is_active')    ?? 'true'
  const companyId    = c.req.query('company_id')   ?? ''

  // is_active filter: 'true' → active only, anything else → all
  const filterActive = isActiveStr === 'true'

  const params: unknown[] = [companyIds]
  const conditions: string[] = ['e.company_id = ANY($1)']

  if (filterActive) {
    conditions.push('e.is_active = true')
  }

  if (companyId) {
    if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden: company not in scope' }, 403)
    params.push(companyId)
    conditions.push(`e.company_id = $${params.length}`)
  }

  if (departmentId) {
    params.push(departmentId)
    conditions.push(`e.department_id = $${params.length}`)
  }

  if (search) {
    params.push(`%${search}%`)
    const n = params.length
    conditions.push(
      `(e.first_name ILIKE $${n} OR e.last_name ILIKE $${n} OR e.email ILIKE $${n} OR e.role_title ILIKE $${n})`
    )
  }

  const whereClause = conditions.join(' AND ')

  const result = await query(
    `SELECT
       e.id,
       e.company_id,
       e.department_id,
       e.user_id,
       e.first_name,
       e.last_name,
       e.email,
       e.phone,
       e.role_title,
       e.employment_type,
       e.start_date,
       e.end_date,
       e.is_active,
       e.manager_id,
       e.salary,
       e.currency,
       e.notes,
       e.created_at,
       e.updated_at,
       co.name                                    AS company_name,
       d.name                                     AS department_name,
       CONCAT(m.first_name, ' ', m.last_name)     AS manager_name,
       u.role                                     AS cbop_role
     FROM employees e
     LEFT JOIN companies co ON co.id = e.company_id
     LEFT JOIN departments d  ON d.id = e.department_id
     LEFT JOIN employees   m  ON m.id = e.manager_id
     LEFT JOIN users       u  ON u.id = e.user_id
     WHERE ${whereClause}
     ORDER BY e.first_name ASC, e.last_name ASC`,
    params
  )

  const employees = result.rows.map((row: Record<string, unknown>) => maybeRedactSalary(row, role))

  return c.json({ employees })
})

// ── POST /api/employees ───────────────────────────────────────────────────────

app.post('/api/employees', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json() as {
    company_id:      string
    first_name:      string
    last_name:       string
    email:           string
    phone?:          string
    role_title?:     string
    employment_type?: string
    start_date?:     string
    department_id?:  string
    manager_id?:     string
    user_id?:        string
    salary?:         number
    currency?:       string
    notes?:          string
  }

  const {
    company_id, first_name, last_name, email,
    phone, role_title, employment_type, start_date,
    department_id, manager_id, user_id, salary, currency, notes,
  } = body

  // Validation
  if (!company_id)  return c.json({ error: 'company_id is required' }, 400)
  if (!first_name)  return c.json({ error: 'first_name is required' }, 400)
  if (!last_name)   return c.json({ error: 'last_name is required' }, 400)
  if (!email)       return c.json({ error: 'email is required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  // Validate department scope
  if (department_id) {
    const deptCheck = await query(
      `SELECT id FROM departments WHERE id = $1 AND company_id = $2`,
      [department_id, company_id]
    )
    if (deptCheck.rows.length === 0) return c.json({ error: 'Department not found in this company' }, 400)
  }

  // Validate manager scope
  if (manager_id) {
    const manCheck = await query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [manager_id, company_id]
    )
    if (manCheck.rows.length === 0) return c.json({ error: 'Manager not found or not active in this company' }, 400)
  }

  // Validate user_id scope
  if (user_id) {
    const userCheck = await query(`SELECT id FROM users WHERE id = $1`, [user_id])
    if (userCheck.rows.length === 0) return c.json({ error: 'Linked CBOP user not found' }, 400)
  }

  const validTypes = ['full_time', 'part_time', 'contractor', 'intern']
  const empType = employment_type && validTypes.includes(employment_type) ? employment_type : 'full_time'

  const result = await query(
    `INSERT INTO employees
       (company_id, department_id, user_id, first_name, last_name, email,
        phone, role_title, employment_type, start_date, manager_id, salary, currency, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      company_id,
      department_id || null,
      user_id       || null,
      first_name,
      last_name,
      email,
      phone         || null,
      role_title    || null,
      empType,
      start_date    || null,
      manager_id    || null,
      salary        ?? null,
      currency      || 'MYR',
      notes         || null,
    ]
  )
  const employee = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'employees', op: 'create', id: employee.id, after: employee, companyId: company_id,
  })

  return c.json({ employee }, 201)
})

// ── GET /api/employees/:id ────────────────────────────────────────────────────

app.get('/api/employees/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const role       = c.get('role') as string
  const id         = c.req.param('id')

  const result = await query(
    `SELECT
       e.*,
       co.name                                    AS company_name,
       d.name                                     AS department_name,
       CONCAT(m.first_name, ' ', m.last_name)     AS manager_name,
       u.role                                     AS cbop_role,
       u.email                                    AS cbop_user_email
     FROM employees e
     LEFT JOIN companies  co ON co.id = e.company_id
     LEFT JOIN departments d  ON d.id = e.department_id
     LEFT JOIN employees   m  ON m.id = e.manager_id
     LEFT JOIN users       u  ON u.id = e.user_id
     WHERE e.id = $1 AND e.company_id = ANY($2)`,
    [id, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Employee not found' }, 404)

  const employee = maybeRedactSalary(result.rows[0] as Record<string, unknown>, role)

  return c.json({ employee })
})

// ── PATCH /api/employees/:id ──────────────────────────────────────────────────

app.patch('/api/employees/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json() as Record<string, unknown>

  // Verify employee is in scope
  const existing = await query(
    `SELECT * FROM employees WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Employee not found' }, 404)

  const before = existing.rows[0]
  const companyId = before.company_id as string

  // Validate department if changing
  if (body.department_id) {
    const deptCheck = await query(
      `SELECT id FROM departments WHERE id = $1 AND company_id = $2`,
      [body.department_id, companyId]
    )
    if (deptCheck.rows.length === 0) return c.json({ error: 'Department not found in this company' }, 400)
  }

  // Validate manager if changing
  if (body.manager_id) {
    if (body.manager_id === id) return c.json({ error: 'Employee cannot be their own manager' }, 400)
    const manCheck = await query(
      `SELECT id FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [body.manager_id, companyId]
    )
    if (manCheck.rows.length === 0) return c.json({ error: 'Manager not found or not active in this company' }, 400)
  }

  // Allowed mutable fields
  const allowed = [
    'department_id', 'user_id', 'first_name', 'last_name', 'email', 'phone',
    'role_title', 'employment_type', 'start_date', 'end_date', 'is_active',
    'manager_id', 'salary', 'currency', 'notes',
  ]

  const setClauses: string[] = []
  const params: unknown[]    = []

  for (const field of allowed) {
    if (field in body) {
      params.push(body[field] ?? null)
      setClauses.push(`${field} = $${params.length}`)
    }
  }

  if (setClauses.length === 0) return c.json({ error: 'No fields to update' }, 400)

  // Always update updated_at
  setClauses.push('updated_at = NOW()')

  params.push(id)
  const result = await query(
    `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  )
  const employee = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'employees', op: 'update', id, before, after: employee, companyId,
  })

  return c.json({ employee })
})

// ── DELETE /api/employees/:id ─────────────────────────────────────────────────
// Soft-delete: set is_active = false, end_date = NOW().

app.delete('/api/employees/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const existing = await query(
    `SELECT * FROM employees WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Employee not found' }, 404)
  const before = existing.rows[0]

  await query(
    `UPDATE employees SET is_active = false, end_date = NOW()::date, updated_at = NOW() WHERE id = $1`,
    [id]
  )

  await writeMutationAuditLog(c, {
    table: 'employees', op: 'update', id,
    before: { is_active: before.is_active, end_date: before.end_date },
    after: { is_active: false, end_date: new Date().toISOString().slice(0, 10) },
    companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── POST /api/employees/:id/offboard ─────────────────────────────────────────
// Formal offboarding: set end_date, is_active=false, send offboarding email.

app.post('/api/employees/:id/offboard', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json() as { end_date?: string; notes?: string }

  const existing = await query(
    `SELECT e.*, co.name AS company_name
     FROM employees e
     LEFT JOIN companies co ON co.id = e.company_id
     WHERE e.id = $1 AND e.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Employee not found' }, 404)

  const emp = existing.rows[0]
  if (!emp.is_active) return c.json({ error: 'Employee is already offboarded' }, 409)

  const endDate = body.end_date || new Date().toISOString().slice(0, 10)

  await query(
    `UPDATE employees
     SET is_active = false, end_date = $1, notes = COALESCE($2, notes), updated_at = NOW()
     WHERE id = $3`,
    [endDate, body.notes || null, id]
  )

  await writeMutationAuditLog(c, {
    table: 'employees', op: 'update', id,
    before: { is_active: emp.is_active, end_date: emp.end_date, notes: emp.notes },
    after: { is_active: false, end_date: endDate, notes: body.notes || emp.notes },
    companyId: emp.company_id,
  })

  // Send offboarding notification email if the employee has an email
  if (emp.email) {
    const fullName = `${emp.first_name} ${emp.last_name}`
    await sendEmail({
      to:        emp.email,
      subject:   `Your employment at ${emp.company_name} — offboarding confirmation`,
      html: `
        <p>Dear ${fullName},</p>
        <p>This email confirms that your employment with <strong>${emp.company_name}</strong>
        has been concluded as of <strong>${endDate}</strong>.</p>
        <p>We wish you all the best in your future endeavours.</p>
        <br>
        <p>Regards,<br>${emp.company_name}</p>
      `,
      kind:              'transactional',
      companyId:         emp.company_id,
      enforceVerified:   false,
      respectSuppression: false,
    }).catch(() => { /* non-fatal — log but don't block */ })
  }

  return c.json({ ok: true, end_date: endDate })
})

export default app
