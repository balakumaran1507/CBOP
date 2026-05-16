import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import '../lib/hono-vars'

const app = new Hono()

app.get('/api/dashboard', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const role = c.get('role') as string
  const companyIds = c.get('companyIds') as string[]

  if (companyIds.length === 0) {
    return c.json({ role, statCards: {}, alerts: [], myTasks: [], todaysPriorities: [], activityFeed: [], invoiceAlerts: [] })
  }

  // All date comparisons use Postgres CURRENT_DATE / NOW() — avoids Node UTC vs IST mismatch

  const [
    revenueRes,
    openDealsRes,
    activeProjectsRes,
    tasksDueTodayRes,
    myTasksTodayRes,
    teamPendingRes,
    overdueInvoicesRes,
    unownedTasksRes,
    staleDealsRes,
    myTasksRes,
    activityRes,
    invoiceAlertsRes,
  ] = await Promise.all([
    role !== 'cto'
      ? query(
          `SELECT COALESCE(SUM(total), 0)::numeric as revenue
           FROM sales_invoices
           WHERE company_id = ANY($1) AND status = 'paid'
             AND created_at >= DATE_TRUNC('month', NOW())`,
          [companyIds]
        )
      : Promise.resolve({ rows: [{ revenue: '0' }] }),

    role !== 'cto'
      ? query(
          `SELECT COUNT(*)::int as count
           FROM sales_deals
           WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')`,
          [companyIds]
        )
      : Promise.resolve({ rows: [{ count: 0 }] }),

    query(
      `SELECT COUNT(*)::int as count FROM ops_projects WHERE company_id = ANY($1) AND status = 'active'`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int as count FROM ops_tasks
       WHERE company_id = ANY($1) AND due_date = CURRENT_DATE AND status != 'done'`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int as count FROM ops_tasks
       WHERE owner_id = $1 AND due_date = CURRENT_DATE AND status != 'done' AND company_id = ANY($2)`,
      [userId, companyIds]
    ),

    role === 'coo'
      ? query(
          `SELECT COUNT(*)::int as count FROM ops_tasks WHERE company_id = ANY($1) AND status != 'done'`,
          [companyIds]
        )
      : Promise.resolve({ rows: [{ count: 0 }] }),

    query(
      `SELECT COUNT(*)::int as count FROM sales_invoices
       WHERE company_id = ANY($1) AND due_date < CURRENT_DATE AND status != 'paid'`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int as count FROM ops_tasks
       WHERE company_id = ANY($1) AND owner_id IS NULL
         AND due_date <= CURRENT_DATE + INTERVAL '2 days' AND status != 'done'`,
      [companyIds]
    ),

    query(
      `SELECT COUNT(*)::int as count FROM sales_deals
       WHERE company_id = ANY($1) AND stage NOT IN ('closed_won','closed_lost')
         AND updated_at < NOW() - INTERVAL '7 days'`,
      [companyIds]
    ).catch(() => ({ rows: [{ count: 0 }] })),

    query(
      `SELECT t.id, t.title, t.priority, t.status, t.due_date,
              p.name as project_name
       FROM ops_tasks t
       LEFT JOIN ops_projects p ON p.id = t.project_id
       WHERE t.owner_id = $1 AND t.due_date <= CURRENT_DATE AND t.status != 'done' AND t.company_id = ANY($2)
       ORDER BY t.due_date ASC,
                CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC
       LIMIT 10`,
      [userId, companyIds]
    ),

    query(
      `SELECT id, name, type, status, completed_at, error_message
       FROM system_jobs ORDER BY created_at DESC LIMIT 5`
    ),

    query(
      `SELECT i.id, i.invoice_no, i.total, i.due_date, i.status,
              c.name as client_name
       FROM sales_invoices i
       LEFT JOIN sales_clients c ON c.id = i.client_id
       WHERE i.company_id = ANY($1) AND i.due_date < CURRENT_DATE AND i.status != 'paid'
       ORDER BY i.due_date ASC LIMIT 5`,
      [companyIds]
    ),
  ])

  const overdueCount = overdueInvoicesRes.rows[0].count as number
  const unownedCount = unownedTasksRes.rows[0].count as number
  const staleCount = staleDealsRes.rows[0].count as number

  const alerts: { type: string; count: number; message: string }[] = []
  if (overdueCount > 0) alerts.push({ type: 'invoice_overdue', count: overdueCount, message: `${overdueCount} invoice${overdueCount > 1 ? 's' : ''} overdue` })
  if (unownedCount > 0) alerts.push({ type: 'task_unowned', count: unownedCount, message: `${unownedCount} task${unownedCount > 1 ? 's' : ''} unowned and due soon` })
  if (staleCount > 0) alerts.push({ type: 'deal_stale', count: staleCount, message: `${staleCount} deal${staleCount > 1 ? 's' : ''} unchanged for 7+ days` })

  const statCards: Record<string, number | null> = {
    tasksDueToday: tasksDueTodayRes.rows[0].count as number,
  }

  if (role === 'ceo') {
    statCards.revenueThisMonth = parseFloat(revenueRes.rows[0].revenue as string)
    statCards.openDeals = openDealsRes.rows[0].count as number
    statCards.cashPosition = null
  } else if (role === 'coo') {
    statCards.revenueThisMonth = parseFloat(revenueRes.rows[0].revenue as string)
    statCards.openDeals = openDealsRes.rows[0].count as number
    statCards.teamTasksPending = teamPendingRes.rows[0].count as number
  } else {
    statCards.activeProjects = activeProjectsRes.rows[0].count as number
    statCards.myTasksToday = myTasksTodayRes.rows[0].count as number
  }

  const myTasks = myTasksRes.rows
  return c.json({
    role,
    statCards,
    alerts,
    myTasks,
    todaysPriorities: myTasks.slice(0, 5),
    activityFeed: activityRes.rows,
    invoiceAlerts: invoiceAlertsRes.rows,
  })
})

// Minimal mark-done stub — full task CRUD will live in api/routes/tasks.ts (Slice 6)
app.patch('/api/tasks/:id/done', requireAuth, async (c) => {
  const taskId = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `UPDATE ops_tasks SET status = 'done', updated_at = NOW()
     WHERE id = $1 AND company_id = ANY($2) RETURNING id`,
    [taskId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Task not found' }, 404)
  return c.json({ success: true })
})

export default app
