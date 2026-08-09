import { query } from './db'

export interface DetectedFinding {
  company_id: string
  type:       'duplicate_expense' | 'category_spike' | 'overdue_invoice' | 'negative_margin'
  severity:   'warning' | 'critical'
  detail:     string
  dedupe_key: string
}

// Per-record detection (one row per actionable issue, not an aggregate) so each
// finding can drill down to the source expense/invoice. Deterministic SQL only -
// no LLM involved, this is the source of truth the Auditor persona narrates from.

export async function runAuditChecks(companyIds: string[]): Promise<DetectedFinding[]> {
  if (companyIds.length === 0) return []

  const [dupExpenses, categorySpikes, overdueInvoices, negativeMonths] = await Promise.all([
    query(
      `SELECT DISTINCT ON (a.id) a.id, a.company_id, c.name AS company_name, a.category, a.amount, a.date, a.description
       FROM finance_expenses a
       JOIN finance_expenses b ON b.company_id = a.company_id AND b.amount = a.amount
         AND b.category = a.category AND b.id != a.id AND ABS(b.date - a.date) <= 3
       JOIN companies c ON c.id = a.company_id
       WHERE a.company_id = ANY($1)
       ORDER BY a.id, a.date DESC`,
      [companyIds]
    ),

    query(
      `WITH monthly AS (
         SELECT company_id, category, date_trunc('month', date) AS month, SUM(amount) AS total
         FROM finance_expenses WHERE company_id = ANY($1)
         GROUP BY company_id, category, date_trunc('month', date)
       )
       SELECT m1.company_id, c.name AS company_name, m1.category, m1.month, m1.total AS this_month, AVG(m2.total) AS avg_prior_3mo
       FROM monthly m1
       JOIN companies c ON c.id = m1.company_id
       JOIN monthly m2 ON m2.company_id = m1.company_id AND m2.category = m1.category
         AND m2.month < m1.month AND m2.month >= m1.month - INTERVAL '3 months'
       WHERE m1.month = date_trunc('month', CURRENT_DATE)
       GROUP BY m1.company_id, c.name, m1.category, m1.month, m1.total
       HAVING m1.total > AVG(m2.total) * 1.5`,
      [companyIds]
    ),

    query(
      `SELECT i.id, i.company_id, c.name AS company_name, i.invoice_no, i.total, i.due_date,
              (CURRENT_DATE - i.due_date) AS days_overdue
       FROM sales_invoices i JOIN companies c ON c.id = i.company_id
       WHERE i.company_id = ANY($1) AND i.due_date < CURRENT_DATE AND i.status != 'paid'`,
      [companyIds]
    ),

    query(
      `SELECT fmp.company_id, c.name AS company_name, fmp.month, fmp.revenue, fmp.expenses, fmp.profit
       FROM finance_monthly_pl fmp JOIN companies c ON c.id = fmp.company_id
       WHERE fmp.company_id = ANY($1) AND fmp.profit < 0`,
      [companyIds]
    ),
  ])

  const findings: DetectedFinding[] = []

  for (const r of dupExpenses.rows) {
    findings.push({
      company_id: r.company_id,
      type: 'duplicate_expense',
      severity: 'warning',
      detail: `${r.company_name}: possible duplicate - ${r.category} Rs.${r.amount} on ${new Date(r.date).toISOString().slice(0, 10)} (${r.description || 'no description'})`,
      dedupe_key: r.id,
    })
  }

  for (const r of categorySpikes.rows) {
    const monthKey = new Date(r.month).toISOString().slice(0, 7)
    findings.push({
      company_id: r.company_id,
      type: 'category_spike',
      severity: 'warning',
      detail: `${r.company_name}: ${r.category} spending spiked to Rs.${Math.round(r.this_month)} this month (avg Rs.${Math.round(r.avg_prior_3mo)})`,
      dedupe_key: `${r.category}:${monthKey}`,
    })
  }

  for (const r of overdueInvoices.rows) {
    findings.push({
      company_id: r.company_id,
      type: 'overdue_invoice',
      severity: (r.days_overdue as number) > 30 ? 'critical' : 'warning',
      detail: `${r.company_name}: invoice ${r.invoice_no} - Rs.${r.total} overdue by ${r.days_overdue} days`,
      dedupe_key: r.id,
    })
  }

  for (const r of negativeMonths.rows) {
    const monthKey = new Date(r.month).toISOString().slice(0, 7)
    findings.push({
      company_id: r.company_id,
      type: 'negative_margin',
      severity: 'critical',
      detail: `${r.company_name}: ${monthKey} closed with negative margin - revenue Rs.${Math.round(r.revenue)}, expenses Rs.${Math.round(r.expenses)}, profit Rs.${Math.round(r.profit)}`,
      dedupe_key: monthKey,
    })
  }

  return findings
}
