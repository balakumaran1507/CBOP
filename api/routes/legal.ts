import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { writeMutationAuditLog } from '../lib/audit-log'
import '../lib/hono-vars'

const app = new Hono()

// ── Contract repository - existing templates (contract/nda/mou), no new schema ─

app.get('/api/legal/documents', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT t.id, t.name, t.type, t.updated_at, c.name AS company_name
     FROM templates t JOIN companies c ON c.id = t.company_id
     WHERE t.company_id = ANY($1) AND t.type IN ('contract', 'nda', 'mou')
     ORDER BY t.updated_at DESC`,
    [companyIds]
  )
  return c.json({ documents: result.rows })
})

// ── Contract lifecycle tracking ───────────────────────────────────────────────

app.get('/api/legal/contracts', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const result = await query(
    `SELECT lc.*, c.name AS company_name
     FROM legal_contracts lc JOIN companies c ON c.id = lc.company_id
     WHERE lc.company_id = ANY($1)
     ORDER BY lc.expiry_date ASC NULLS LAST, lc.created_at DESC`,
    [companyIds]
  )
  return c.json({ contracts: result.rows })
})

app.post('/api/legal/contracts', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, title, counterparty, contract_type, status, effective_date, expiry_date, renewal_reminder_days, notes } = body
  if (!company_id || !title) return c.json({ error: 'company_id, title required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)

  const result = await query(
    `INSERT INTO legal_contracts (company_id, title, counterparty, contract_type, status, effective_date, expiry_date, renewal_reminder_days, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [company_id, title, counterparty ?? null, contract_type ?? 'contract', status ?? 'draft',
     effective_date ?? null, expiry_date ?? null, renewal_reminder_days ?? 30, notes ?? null]
  )
  const contract = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'legal_contracts', op: 'create', id: contract.id, after: contract, companyId: company_id,
  })

  return c.json({ contract }, 201)
})

app.patch('/api/legal/contracts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()

  const existing = await query(`SELECT * FROM legal_contracts WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  for (const field of ['title', 'counterparty', 'contract_type', 'status', 'effective_date', 'expiry_date', 'renewal_reminder_days', 'notes']) {
    if (body[field] !== undefined) { sets.push(`${field} = $${p++}`); params.push(body[field]) }
  }
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)
  sets.push(`updated_at = NOW()`)
  params.push(id)

  const result = await query(`UPDATE legal_contracts SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`, params)
  const contract = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'legal_contracts', op: 'update', id, before, after: contract, companyId: before.company_id,
  })

  return c.json({ contract })
})

app.delete('/api/legal/contracts/:id', requireAuth, requireRole('ceo'), async (c) => {
  const id = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const existing = await query(`SELECT * FROM legal_contracts WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(existing.rows[0].company_id)) return c.json({ error: 'Forbidden' }, 403)
  const before = existing.rows[0]

  await query(`DELETE FROM legal_contracts WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'legal_contracts', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

export default app
