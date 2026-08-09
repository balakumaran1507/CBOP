import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

// ── GET /api/ceo/pulse ────────────────────────────────────────────────────────
// Cross-company executive overview for the Command Panel's Pulse tab.
// Scoped by companyIds - 'creator' sees all companies, 'ceo' sees only its
// assigned companies (see api/middleware/require-auth.ts).

app.get('/api/ceo/pulse', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  if (companyIds.length === 0) {
    return c.json({ companies: [], alerts: [], stats: {}, activity: [] })
  }

  const [
    companiesRes,
    runwayRes,
    overdueInvoicesRes,
    staleDealsRes,
    hiringPendingRes,
    hiringInterviewsRes,
    hiringBatchesStuckRes,
    campaignsRes,
    docBatchesRes,
    subscribersRes,
    domainCapRes,
    jobFailuresRes,
    activityRes,
    seoAuditRes,
    stuckScheduledPostsRes,
  ] = await Promise.all([
    query(`SELECT id, name, invoice_prefix FROM companies WHERE id = ANY($1) ORDER BY name`, [companyIds]),

    query(
      `SELECT fmp.company_id, c.name AS company_name, fmp.expenses, fmp.revenue,
              COALESCE(fcp.amount, 0) AS cash
       FROM finance_monthly_pl fmp
       JOIN companies c ON c.id = fmp.company_id
       LEFT JOIN finance_cash_position fcp ON fcp.company_id = fmp.company_id
       WHERE fmp.company_id = ANY($1)
         AND fmp.month = (SELECT MAX(month) FROM finance_monthly_pl WHERE company_id = fmp.company_id)`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS total
       FROM sales_invoices WHERE company_id = ANY($1) AND due_date < CURRENT_DATE AND status != 'paid'`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int AS count FROM sales_deals
       WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')
         AND updated_at < NOW() - INTERVAL '7 days'`,
      [companyIds]
    ).catch(() => ({ rows: [{ count: 0 }] })),

    query(
      `SELECT COUNT(*)::int AS count FROM hiring_applicants
       WHERE company_id = ANY($1) AND stage IN ('applied','reviewed')`,
      [companyIds]
    ).catch(() => ({ rows: [{ count: 0 }] })),

    query(
      `SELECT COUNT(*)::int AS count FROM hiring_applicants
       WHERE company_id = ANY($1) AND stage = 'interview_scheduled' AND interview_at::date = CURRENT_DATE`,
      [companyIds]
    ).catch(() => ({ rows: [{ count: 0 }] })),

    query(
      `SELECT b.id, b.batch_name, b.status, c.name AS company_name
       FROM hiring_batches b JOIN companies c ON c.id = b.company_id
       WHERE b.company_id = ANY($1) AND b.status = 'active' AND b.scheduled_at < NOW() - INTERVAL '2 hours'`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT id, name, status, failed_count, sent_count, total_count, company_id
       FROM marketing_campaigns WHERE company_id = ANY($1) AND type = 'email'
         AND status IN ('running','paused')`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT b.id, b.name, b.status, b.done_count, b.total_count, c.name AS company_name
       FROM document_batches b JOIN companies c ON c.id = b.company_id
       WHERE b.company_id = ANY($1) AND b.status IN ('generating','failed')`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT status, COUNT(*)::int AS count FROM email_subscribers
       WHERE company_id = ANY($1) GROUP BY status`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT d.domain, d.daily_cap, c.name AS company_name,
              COUNT(l.id) FILTER (WHERE l.created_at >= CURRENT_DATE)::int AS sent_today
       FROM email_domains d
       LEFT JOIN companies c ON c.id = d.company_id
       LEFT JOIN email_send_log l ON split_part(l.from_email, '@', 2) = d.domain
       WHERE d.company_id = ANY($1) AND d.verified = true
       GROUP BY d.domain, d.daily_cap, c.name`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT id, name, type, status, error_message, completed_at, created_at
       FROM system_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5`
    ).catch(() => ({ rows: [] })),

    query(
      `SELECT id, name, type, status, completed_at, created_at
       FROM system_jobs ORDER BY created_at DESC LIMIT 10`
    ).catch(() => ({ rows: [] })),

    // Most recent technical SEO audit per company (low score = worth a look)
    query(
      `SELECT DISTINCT ON (a.company_id) a.company_id, c.name AS company_name, a.url, a.score, a.audited_at
       FROM technical_seo_audits a JOIN companies c ON c.id = a.company_id
       WHERE a.company_id = ANY($1)
       ORDER BY a.company_id, a.audited_at DESC`,
      [companyIds]
    ).catch(() => ({ rows: [] })),

    // Blog posts stuck in 'scheduled' past their scheduled_at (same stuck-job
    // symptom pattern as the hiring-batch / document-batch checks above)
    query(
      `SELECT bp.id, bp.title, c.name AS company_name
       FROM blog_posts bp JOIN companies c ON c.id = bp.company_id
       WHERE bp.company_id = ANY($1) AND bp.status = 'scheduled' AND bp.scheduled_at < NOW() - INTERVAL '1 hour'`,
      [companyIds]
    ).catch(() => ({ rows: [] })),
  ])

  const alerts: { severity: 'critical' | 'warning'; type: string; message: string; href: string }[] = []

  for (const row of runwayRes.rows) {
    const monthlyExpenses = parseFloat(String(row.expenses))
    const dailyBurn = monthlyExpenses / 30
    const runwayDays = dailyBurn > 0 ? Math.floor(parseFloat(String(row.cash)) / dailyBurn) : null
    if (runwayDays !== null && runwayDays < 60) {
      alerts.push({
        severity: runwayDays < 30 ? 'critical' : 'warning',
        type: 'runway',
        message: `${row.company_name}: ${runwayDays}d runway remaining`,
        href: '/command?tab=health',
      })
    }
  }

  const overdueCount = overdueInvoicesRes.rows[0].count as number
  if (overdueCount > 0) {
    alerts.push({
      severity: 'warning',
      type: 'invoice_overdue',
      message: `${overdueCount} invoice${overdueCount > 1 ? 's' : ''} overdue (₹${Math.round(parseFloat(String(overdueInvoicesRes.rows[0].total))).toLocaleString('en-IN')})`,
      href: '/sales',
    })
  }

  const staleCount = staleDealsRes.rows[0].count as number
  if (staleCount > 0) {
    alerts.push({ severity: 'warning', type: 'deal_stale', message: `${staleCount} deal${staleCount > 1 ? 's' : ''} unchanged for 7+ days`, href: '/sales' })
  }

  for (const row of hiringBatchesStuckRes.rows) {
    alerts.push({
      severity: 'warning',
      type: 'hiring_batch_stuck',
      message: `${row.company_name}: interview batch "${row.batch_name || 'Untitled'}" still active 2h+ after its scheduled time`,
      href: '/hiring',
    })
  }

  for (const row of docBatchesRes.rows) {
    if (row.status === 'failed') {
      alerts.push({ severity: 'critical', type: 'doc_batch_failed', message: `${row.company_name}: document batch "${row.name}" failed`, href: '/documents' })
    }
  }

  for (const row of campaignsRes.rows) {
    if (row.status === 'paused' && (row.failed_count as number) > 0) {
      alerts.push({
        severity: 'warning',
        type: 'campaign_paused',
        message: `"${row.name}" paused after ${row.failed_count} failed send${row.failed_count > 1 ? 's' : ''}`,
        href: '/campaigns',
      })
    }
  }

  for (const row of domainCapRes.rows) {
    const cap = row.daily_cap as number
    const sent = row.sent_today as number
    if (cap > 0 && sent / cap >= 0.8) {
      alerts.push({
        severity: sent >= cap ? 'critical' : 'warning',
        type: 'domain_cap',
        message: `${row.domain}: ${sent}/${cap} of today's send cap used`,
        href: '/email-studio',
      })
    }
  }

  for (const row of jobFailuresRes.rows) {
    alerts.push({ severity: 'warning', type: 'job_failed', message: `Automation "${row.name}" failed`, href: '/settings?tab=jobs' })
  }

  for (const row of seoAuditRes.rows) {
    const score = row.score as number
    if (score < 70) {
      alerts.push({
        severity: score < 50 ? 'critical' : 'warning',
        type: 'seo_audit_low_score',
        message: `${row.company_name}: technical SEO score ${score}/100 for ${row.url}`,
        href: '/seo',
      })
    }
  }

  // Note: CBOP has no auto-publish scheduler for blog posts (by design - see
  // CLAUDE.md's "n8n for all automations" constraint, no custom scheduler code
  // here). A scheduled post never publishes itself; this is a reminder to
  // publish it by hand, not a malfunction signal.
  for (const row of stuckScheduledPostsRes.rows) {
    alerts.push({
      severity: 'warning',
      type: 'blog_post_needs_manual_publish',
      message: `${row.company_name}: "${row.title}" was scheduled for earlier and still needs to be published manually`,
      href: '/blog',
    })
  }

  const subscribersByStatus = Object.fromEntries(subscribersRes.rows.map((r) => [r.status, r.count]))

  const stats = {
    companiesTracked:      companiesRes.rows.length,
    revenueThisMonth:      runwayRes.rows.reduce((s, r) => s + parseFloat(String(r.revenue)), 0),
    overdueInvoices:       overdueCount,
    staleDeals:            staleCount,
    hiringPendingReview:   hiringPendingRes.rows[0].count as number,
    hiringInterviewsToday: hiringInterviewsRes.rows[0].count as number,
    campaignsRunning:      campaignsRes.rows.filter((r) => r.status === 'running').length,
    campaignsPaused:       campaignsRes.rows.filter((r) => r.status === 'paused').length,
    documentBatchesActive: docBatchesRes.rows.filter((r) => r.status === 'generating').length,
    documentBatchesFailed: docBatchesRes.rows.filter((r) => r.status === 'failed').length,
    subscribersActive:     subscribersByStatus['subscribed'] || 0,
    subscribersSuppressed: subscribersRes.rows.reduce((s, r) => s + (r.status !== 'subscribed' ? Number(r.count) : 0), 0),
    seoAuditsLow:          seoAuditRes.rows.filter((r) => (r.score as number) < 70).length,
    blogPostsAwaitingPublish: stuckScheduledPostsRes.rows.length,
  }

  const activity = activityRes.rows.map((r) => ({
    id:          r.id,
    label:       r.name,
    type:        r.type,
    status:      r.status,
    ts:          r.completed_at || r.created_at,
  }))

  return c.json({
    companies: companiesRes.rows,
    alerts:    alerts.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1)),
    stats,
    activity,
  })
})

export default app
