import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { runAuditChecks } from '../lib/audit-checks'
import '../lib/hono-vars'

const app = new Hono()

// ── POST /api/audit/scan ─────────────────────────────────────────────────────
// Re-runs the deterministic SQL checks and upserts findings. Never auto-closes
// a finding the checks no longer detect - status changes are always explicit,
// done by a human via PATCH below, except a 'resolved' finding that's detected
// again (meaning it's still actually a live issue) reopens automatically.

app.post('/api/audit/scan', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const detected = await runAuditChecks(companyIds)

  let inserted = 0
  let reopened = 0

  for (const f of detected) {
    const result = await query(
      `INSERT INTO audit_findings (company_id, type, severity, status, detail, dedupe_key, detected_at)
       VALUES ($1, $2, $3, 'open', $4, $5, NOW())
       ON CONFLICT (company_id, type, dedupe_key) DO UPDATE SET
         detail = EXCLUDED.detail,
         detected_at = NOW(),
         status = CASE WHEN audit_findings.status = 'resolved' THEN 'open' ELSE audit_findings.status END
       RETURNING (xmax = 0) AS was_insert, status`,
      [f.company_id, f.type, f.severity, f.detail, f.dedupe_key]
    )
    if (result.rows[0]?.was_insert) inserted++
  }

  return c.json({ scanned: detected.length, inserted, checked_at: new Date().toISOString() })
})

// ── GET /api/audit/findings ──────────────────────────────────────────────────

app.get('/api/audit/findings', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { status } = c.req.query()

  let sql = `SELECT af.id, af.company_id, c.name AS company_name, af.type, af.severity, af.status,
                    af.detail, af.detected_at, af.resolved_at
             FROM audit_findings af
             JOIN companies c ON c.id = af.company_id
             WHERE af.company_id = ANY($1)`
  const params: unknown[] = [companyIds]

  if (status) {
    sql += ` AND af.status = $2`
    params.push(status)
  }

  sql += ` ORDER BY af.status = 'open' DESC, af.severity = 'critical' DESC, af.detected_at DESC LIMIT 300`

  const result = await query(sql, params)
  return c.json({ findings: result.rows })
})

// ── GET /api/audit/findings/trend ────────────────────────────────────────────
// Count of findings detected per day, last 30 days - for the trend chart

app.get('/api/audit/findings/trend', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT date_trunc('day', detected_at) AS day, COUNT(*)::int AS count
     FROM audit_findings
     WHERE company_id = ANY($1) AND detected_at >= NOW() - INTERVAL '30 days'
     GROUP BY date_trunc('day', detected_at)
     ORDER BY day ASC`,
    [companyIds]
  )
  return c.json({ trend: result.rows })
})

// ── PATCH /api/audit/findings/:id ────────────────────────────────────────────

app.patch('/api/audit/findings/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { status } = body as { status: 'open' | 'dismissed' | 'resolved' }

  if (!['open', 'dismissed', 'resolved'].includes(status)) return c.json({ error: 'Invalid status' }, 400)

  const existing = await query(`SELECT company_id FROM audit_findings WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `UPDATE audit_findings SET status = $1, resolved_at = CASE WHEN $1 IN ('dismissed','resolved') THEN NOW() ELSE NULL END
     WHERE id = $2 RETURNING *`,
    [status, id]
  )

  return c.json({ finding: result.rows[0] })
})

export default app
