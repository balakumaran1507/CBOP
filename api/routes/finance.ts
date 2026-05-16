import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/finance/company-health ──────────────────────────────────────────
// Returns latest P&L + cash position + runway per company

app.get('/api/finance/company-health', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const pl = await query(
    `SELECT fmp.company_id, c.name AS company_name, c.invoice_prefix,
            fmp.month, fmp.revenue, fmp.expenses, fmp.profit
     FROM finance_monthly_pl fmp
     JOIN companies c ON c.id = fmp.company_id
     WHERE fmp.company_id = ANY($1)
       AND fmp.month = (
         SELECT MAX(month) FROM finance_monthly_pl
         WHERE company_id = fmp.company_id
       )
     ORDER BY c.name`,
    [companyIds]
  )

  const cashPositions = await query(
    `SELECT fcp.company_id, fcp.amount
     FROM finance_cash_position fcp
     WHERE fcp.company_id = ANY($1)`,
    [companyIds]
  )

  const companies = await query(
    `SELECT id, name, invoice_prefix FROM companies WHERE id = ANY($1) ORDER BY name`,
    [companyIds]
  )

  const cashMap: Record<string, number> = {}
  for (const row of cashPositions.rows) {
    cashMap[row.company_id] = parseFloat(String(row.amount))
  }

  const plMap: Record<string, typeof pl.rows[0]> = {}
  for (const row of pl.rows) {
    plMap[row.company_id] = row
  }

  const result = companies.rows.map((co) => {
    const p = plMap[co.id]
    const cash = cashMap[co.id] ?? 0
    const monthlyExpenses = p ? parseFloat(String(p.expenses)) : 0
    const dailyBurn = monthlyExpenses / 30
    const runwayDays = dailyBurn > 0 ? Math.floor(cash / dailyBurn) : null

    return {
      company_id:      co.id,
      company_name:    co.name,
      invoice_prefix:  co.invoice_prefix,
      month:           p?.month ?? null,
      revenue:         p ? parseFloat(String(p.revenue)) : 0,
      expenses:        p ? parseFloat(String(p.expenses)) : 0,
      profit:          p ? parseFloat(String(p.profit)) : 0,
      cash_position:   cash,
      runway_days:     runwayDays,
    }
  })

  return c.json({ companies: result })
})

// ── POST /api/finance/company-health/cash ────────────────────────────────────
// Upsert cash position for a company

app.post('/api/finance/company-health/cash', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, amount } = body

  if (!company_id || amount === undefined) {
    return c.json({ error: 'company_id and amount required' }, 400)
  }
  if (!companyIds.includes(company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await query(
    `INSERT INTO finance_cash_position (company_id, amount, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (company_id) DO UPDATE
       SET amount = EXCLUDED.amount, updated_at = NOW()`,
    [company_id, amount]
  )

  return c.json({ ok: true })
})

// ── GET /api/finance/monthly-pl ──────────────────────────────────────────────
// Returns last 12 months of P&L for all companies (for trend display)

app.get('/api/finance/monthly-pl', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT fmp.company_id, c.name AS company_name,
            fmp.month, fmp.revenue, fmp.expenses, fmp.profit
     FROM finance_monthly_pl fmp
     JOIN companies c ON c.id = fmp.company_id
     WHERE fmp.company_id = ANY($1)
       AND fmp.month >= date_trunc('month', NOW() - INTERVAL '11 months')
     ORDER BY fmp.month ASC, c.name`,
    [companyIds]
  )

  return c.json({ pl: result.rows })
})

// ── POST /api/finance/monthly-pl ─────────────────────────────────────────────
// Upsert a monthly P&L entry manually

app.post('/api/finance/monthly-pl', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, month, revenue, expenses } = body

  if (!company_id || !month || revenue === undefined || expenses === undefined) {
    return c.json({ error: 'company_id, month, revenue, expenses required' }, 400)
  }
  if (!companyIds.includes(company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const profit = parseFloat(String(revenue)) - parseFloat(String(expenses))

  await query(
    `INSERT INTO finance_monthly_pl (company_id, month, revenue, expenses, profit, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (company_id, month) DO UPDATE
       SET revenue = EXCLUDED.revenue,
           expenses = EXCLUDED.expenses,
           profit = EXCLUDED.profit,
           updated_at = NOW()`,
    [company_id, month, revenue, expenses, profit]
  )

  return c.json({ ok: true })
})

// ── GET /api/finance/holdings ────────────────────────────────────────────────

app.get('/api/finance/holdings', requireAuth, requireRole('ceo'), async (c) => {
  const result = await query(
    `SELECT id, company_name, equity_pct, valuation, updated_at
     FROM finance_holdings
     ORDER BY company_name`,
    []
  )

  return c.json({
    holdings: result.rows.map((r) => ({
      ...r,
      equity_pct: parseFloat(String(r.equity_pct)),
      valuation:  parseFloat(String(r.valuation)),
      your_stake: parseFloat(String(r.valuation)) * parseFloat(String(r.equity_pct)) / 100,
    })),
  })
})

// ── POST /api/finance/holdings ───────────────────────────────────────────────

app.post('/api/finance/holdings', requireAuth, requireRole('ceo'), async (c) => {
  const body = await c.req.json()
  const { company_name, equity_pct, valuation } = body

  if (!company_name || equity_pct === undefined || valuation === undefined) {
    return c.json({ error: 'company_name, equity_pct, valuation required' }, 400)
  }

  const result = await query(
    `INSERT INTO finance_holdings (company_name, equity_pct, valuation)
     VALUES ($1, $2, $3)
     RETURNING id, company_name, equity_pct, valuation, updated_at`,
    [company_name, equity_pct, valuation]
  )

  const row = result.rows[0]
  return c.json({
    holding: {
      ...row,
      equity_pct: parseFloat(String(row.equity_pct)),
      valuation:  parseFloat(String(row.valuation)),
      your_stake: parseFloat(String(row.valuation)) * parseFloat(String(row.equity_pct)) / 100,
    },
  }, 201)
})

// ── PATCH /api/finance/holdings/:id ─────────────────────────────────────────

app.patch('/api/finance/holdings/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { company_name, equity_pct, valuation } = body

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (company_name !== undefined) { sets.push(`company_name = $${p++}`); params.push(company_name) }
  if (equity_pct  !== undefined) { sets.push(`equity_pct = $${p++}`);  params.push(equity_pct)  }
  if (valuation   !== undefined) { sets.push(`valuation = $${p++}`);   params.push(valuation)   }

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  sets.push(`updated_at = NOW()`)
  params.push(id)

  const result = await query(
    `UPDATE finance_holdings SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
    params
  )

  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)

  const row = result.rows[0]
  return c.json({
    holding: {
      ...row,
      equity_pct: parseFloat(String(row.equity_pct)),
      valuation:  parseFloat(String(row.valuation)),
      your_stake: parseFloat(String(row.valuation)) * parseFloat(String(row.equity_pct)) / 100,
    },
  })
})

// ── DELETE /api/finance/holdings/:id ────────────────────────────────────────

app.delete('/api/finance/holdings/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id')
  await query(`DELETE FROM finance_holdings WHERE id = $1`, [id])
  return c.json({ ok: true })
})

// ── GET /api/finance/personal-wealth ────────────────────────────────────────

app.get('/api/finance/personal-wealth', requireAuth, requireRole('ceo'), async (c) => {
  const result = await query(
    `SELECT id, snapshot_date, net_worth, cash, equity_stakes, other_assets, created_at
     FROM finance_personal_wealth
     ORDER BY snapshot_date DESC`,
    []
  )

  return c.json({
    snapshots: result.rows.map((r) => ({
      ...r,
      net_worth:     parseFloat(String(r.net_worth)),
      cash:          parseFloat(String(r.cash)),
      equity_stakes: parseFloat(String(r.equity_stakes)),
      other_assets:  parseFloat(String(r.other_assets)),
    })),
  })
})

// ── POST /api/finance/personal-wealth ───────────────────────────────────────

app.post('/api/finance/personal-wealth', requireAuth, requireRole('ceo'), async (c) => {
  const body = await c.req.json()
  const { snapshot_date, net_worth, cash, equity_stakes, other_assets } = body

  if (!snapshot_date || net_worth === undefined || cash === undefined) {
    return c.json({ error: 'snapshot_date, net_worth, cash required' }, 400)
  }

  const result = await query(
    `INSERT INTO finance_personal_wealth (snapshot_date, net_worth, cash, equity_stakes, other_assets)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (snapshot_date) DO UPDATE
       SET net_worth = EXCLUDED.net_worth,
           cash = EXCLUDED.cash,
           equity_stakes = EXCLUDED.equity_stakes,
           other_assets = EXCLUDED.other_assets
     RETURNING id, snapshot_date, net_worth, cash, equity_stakes, other_assets`,
    [snapshot_date, net_worth, cash, equity_stakes ?? 0, other_assets ?? 0]
  )

  const row = result.rows[0]
  return c.json({
    snapshot: {
      ...row,
      net_worth:     parseFloat(String(row.net_worth)),
      cash:          parseFloat(String(row.cash)),
      equity_stakes: parseFloat(String(row.equity_stakes)),
      other_assets:  parseFloat(String(row.other_assets)),
    },
  }, 201)
})

// ── GET /api/finance/expenses ────────────────────────────────────────────────

app.get('/api/finance/expenses', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { company_id } = c.req.query()

  let sql = `SELECT fe.id, fe.company_id, c.name AS company_name,
                    fe.category, fe.amount, fe.description, fe.date, fe.created_at
             FROM finance_expenses fe
             JOIN companies c ON c.id = fe.company_id
             WHERE fe.company_id = ANY($1)`
  const params: unknown[] = [companyIds]

  if (company_id) {
    sql += ` AND fe.company_id = $2`
    params.push(company_id)
  }

  sql += ` ORDER BY fe.date DESC LIMIT 200`

  const result = await query(sql, params)

  return c.json({
    expenses: result.rows.map((r) => ({
      ...r,
      amount: parseFloat(String(r.amount)),
    })),
  })
})

// ── POST /api/finance/expenses ───────────────────────────────────────────────

app.post('/api/finance/expenses', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, category, amount, description, date } = body

  if (!company_id || !amount || !date) {
    return c.json({ error: 'company_id, amount, date required' }, 400)
  }
  if (!companyIds.includes(company_id)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const result = await query(
    `INSERT INTO finance_expenses (company_id, category, amount, description, date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, category, amount, description, date, created_at`,
    [company_id, category ?? 'general', amount, description ?? '', date]
  )

  const row = result.rows[0]
  return c.json({ expense: { ...row, amount: parseFloat(String(row.amount)) } }, 201)
})

export default app
