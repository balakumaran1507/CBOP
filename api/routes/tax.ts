import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/tax/gst-summary ──────────────────────────────────────────────────
// GST collected (from real invoice data) per company, current + prior month.
// Honest scope note: this is GST *collected* only - CBOP's expenses aren't
// tagged with input tax credit, so a net-liability figure isn't derivable yet.

app.get('/api/tax/gst-summary', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT i.company_id, c.name AS company_name,
            date_trunc('month', i.created_at) AS month,
            COALESCE(SUM(i.gst_amount), 0)::numeric AS gst_collected,
            COALESCE(SUM(i.total), 0)::numeric AS total_billed
     FROM sales_invoices i
     JOIN companies c ON c.id = i.company_id
     WHERE i.company_id = ANY($1) AND i.created_at >= NOW() - INTERVAL '2 months'
     GROUP BY i.company_id, c.name, date_trunc('month', i.created_at)
     ORDER BY month DESC`,
    [companyIds]
  )

  return c.json({
    summary: result.rows.map(r => ({ ...r, gst_collected: parseFloat(String(r.gst_collected)), total_billed: parseFloat(String(r.total_billed)) })),
  })
})

// ── Filing deadline tracker ───────────────────────────────────────────────────

app.get('/api/tax/filings', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT tf.*, c.name AS company_name
     FROM tax_filings tf JOIN companies c ON c.id = tf.company_id
     WHERE tf.company_id = ANY($1)
       AND (tf.status != 'filed' OR tf.due_date >= CURRENT_DATE - INTERVAL '30 days')
     ORDER BY tf.due_date ASC`,
    [companyIds]
  )
  // Surface anything past due and still pending as 'overdue' without a background job
  const rows = result.rows.map(r => ({
    ...r,
    status: r.status === 'pending' && new Date(r.due_date) < new Date() ? 'overdue' : r.status,
  }))
  return c.json({ filings: rows })
})

app.post('/api/tax/filings', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, filing_type, period, due_date, notes } = body
  if (!company_id || !filing_type || !period || !due_date) return c.json({ error: 'company_id, filing_type, period, due_date required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `INSERT INTO tax_filings (company_id, filing_type, period, due_date, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [company_id, filing_type, period, due_date, notes ?? null]
  )
  const filing = result.rows[0]
  await writeMutationAuditLog(c, {
    table: 'tax_filings', op: 'create', id: filing.id, after: filing, companyId: company_id,
  })
  return c.json({ filing }, 201)
})

app.patch('/api/tax/filings/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { status } = body as { status: 'pending' | 'filed' }

  const existing = await query(`SELECT * FROM tax_filings WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  const result = await query(
    `UPDATE tax_filings SET status = $1, filed_at = CASE WHEN $1 = 'filed' THEN NOW() ELSE NULL END WHERE id = $2 RETURNING *`,
    [status, id]
  )
  const after = result.rows[0]
  await writeMutationAuditLog(c, {
    table: 'tax_filings', op: 'update', id, before, after, companyId: before.company_id,
  })
  return c.json({ filing: after })
})

// ── Tax regime estimator - pure calculator, no DB, published FY2025-26 slabs ──

app.post('/api/tax/estimate-regime', requireAuth, requireRole('ceo'), async (c) => {
  const body = await c.req.json()
  const income = parseFloat(body.income) || 0
  const deductions = parseFloat(body.deductions) || 0

  // New regime (default, FY2025-26): no deductions applied, slabs below
  function newRegimeTax(taxableIncome: number): number {
    const slabs: [number, number, number][] = [
      [0, 400000, 0], [400000, 800000, 0.05], [800000, 1200000, 0.10],
      [1200000, 1600000, 0.15], [1600000, 2000000, 0.20], [2000000, 2400000, 0.25], [2400000, Infinity, 0.30],
    ]
    let tax = 0
    for (const [lo, hi, rate] of slabs) {
      if (taxableIncome > lo) tax += (Math.min(taxableIncome, hi) - lo) * rate
    }
    return Math.max(0, tax)
  }

  // Old regime: deductions apply, slightly different slabs
  function oldRegimeTax(taxableIncome: number): number {
    const slabs: [number, number, number][] = [
      [0, 250000, 0], [250000, 500000, 0.05], [500000, 1000000, 0.20], [1000000, Infinity, 0.30],
    ]
    let tax = 0
    for (const [lo, hi, rate] of slabs) {
      if (taxableIncome > lo) tax += (Math.min(taxableIncome, hi) - lo) * rate
    }
    return Math.max(0, tax)
  }

  const newTax = Math.round(newRegimeTax(income))
  const oldTax = Math.round(oldRegimeTax(Math.max(0, income - deductions)))

  return c.json({
    new_regime: { taxable_income: income, tax: newTax },
    old_regime: { taxable_income: Math.max(0, income - deductions), tax: oldTax },
    better: newTax <= oldTax ? 'new' : 'old',
    savings: Math.abs(newTax - oldTax),
    disclaimer: 'Estimate only - published slab rates, does not include cess/surcharge or every deduction category. Not a substitute for a real filing.',
  })
})

export default app
