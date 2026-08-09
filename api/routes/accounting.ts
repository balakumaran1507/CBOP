import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { requireModule } from '../middleware/require-module'
import { query, transaction } from '../lib/db'
import '../lib/hono-vars'

// CBOP Accounting — double-entry ledger engine.
// Schema + design reasoning: migrations/062_acct_accounting_module.sql,
// docs/modules/ACCOUNTING_Build_Plan.md.
//
// Access model (decided 2026-08-05 — see api/lib/modules.ts's accounting entry):
// the module itself is business-role accessible (ceo/coo/cto/creator) so COO/CTO
// can do real day-to-day bookkeeping, which is the entire reason this rebuild
// exists — the old /accounting page 403'd them on everything because
// /api/finance/* is unconditionally CEO-only. The sensitive routes stay
// CEO/creator-only at the route level: fiscal period locking here; P&L,
// balance sheet, trial balance and the cross-company rollup land in Slice 5
// with the same additional requireRole('ceo').
//
// Row-level audit history is automatic, not manual: migration 062 wires
// cbop_write_audit_log() (migration 059) onto every table below as an
// AFTER INSERT/UPDATE/DELETE trigger. It reads the actor from the
// transaction-local GUCs that api/lib/db.ts's transaction() sets from the
// requireAuth-established actor context - so every mutation in this file
// MUST go through transaction(), never plain query(), or the audit row
// records a NULL actor. There is no manual writeAuditLog() call anywhere in
// this file by design; the DB trigger is the single writer.

const app = new Hono()
const gate = [requireAuth, requireModule('accounting')] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertCompanyInScope(companyIds: string[], companyId: string): string | null {
  if (!companyId) return 'company_id is required'
  if (!companyIds.includes(companyId)) return 'Forbidden: company not in scope'
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateEntryNumber(client: { query: (text: string, params?: any[]) => Promise<any> }, companyId: string, prefix: string, entryDate: string): Promise<string> {
  // TODO(open question, docs/modules/ACCOUNTING_Build_Plan.md #4): this uses the
  // calendar year of entryDate, matching sales_invoices' current behaviour
  // (api/routes/invoices.ts). GST invoice numbering must reset per *financial*
  // year (Apr-Mar), not calendar year - both this and the invoice generator
  // need the same fix together once that's confirmed, not one at a time.
  const year = new Date(entryDate).getFullYear()
  const like = `${prefix}-JE-${year}-%`
  // Same advisory-lock pattern as generateInvoiceNumber in invoices.ts - serializes
  // concurrent number generation for this company+year for the life of the
  // enclosing transaction, so two concurrent POSTs can never compute the same seq.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acct_entry_seq:${companyId}:${year}`])
  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_no, '-', 4) AS INTEGER)), 0) AS max_seq
     FROM acct_journal_entries
     WHERE company_id = $1 AND entry_no LIKE $2`,
    [companyId, like]
  )
  const nextSeq = ((result.rows[0]?.max_seq as number) + 1).toString().padStart(4, '0')
  return `${prefix}-JE-${year}-${nextSeq}`
}

interface LineInput {
  account_id: string
  debit?: number
  credit?: number
  description?: string
}

function validateLines(lines: unknown): { error: string } | { lines: LineInput[] } {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { error: 'lines must be an array of at least 2 entries (a journal entry needs both a debit and a credit side)' }
  }
  let totalDebit = 0
  let totalCredit = 0
  const clean: LineInput[] = []
  for (const [i, raw] of (lines as unknown[]).entries()) {
    const l = raw as Partial<LineInput>
    if (!l.account_id) return { error: `lines[${i}].account_id is required` }
    const debit  = l.debit  ? parseFloat(String(l.debit))  : 0
    const credit = l.credit ? parseFloat(String(l.credit)) : 0
    if (isNaN(debit) || isNaN(credit) || debit < 0 || credit < 0) return { error: `lines[${i}]: debit/credit must be non-negative numbers` }
    if (debit > 0 && credit > 0) return { error: `lines[${i}]: a line cannot have both a debit and a credit` }
    if (debit === 0 && credit === 0) return { error: `lines[${i}]: a line must have either a debit or a credit` }
    totalDebit  += debit
    totalCredit += credit
    clean.push({ account_id: l.account_id, debit, credit, description: l.description })
  }
  // Not required at draft time (the DB trigger only enforces balance at post
  // time), but rejecting an obviously-unbalanced entry at creation is a much
  // better UX than letting it sit as a draft that can never be posted.
  if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
    return { error: `Entry does not balance: debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}` }
  }
  return { lines: clean }
}

// ═══════════════════════════════════════════════════════════════════════════
// Chart of accounts
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/accounting/accounts ─────────────────────────────────────────────

app.get('/api/accounting/accounts', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT id, parent_id, account_code, account_name, account_type, account_subtype,
            normal_balance, is_group, is_active, description, created_at, updated_at
     FROM acct_chart_of_accounts
     WHERE company_id = $1
     ORDER BY account_code`,
    [companyId]
  )
  return c.json({ accounts: result.rows })
})

// ── POST /api/accounting/accounts ────────────────────────────────────────────

app.post('/api/accounting/accounts', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, parent_id, account_code, account_name, account_type, account_subtype, normal_balance, is_group, description } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!account_code) return c.json({ error: 'account_code is required' }, 400)
  if (!account_name) return c.json({ error: 'account_name is required' }, 400)
  if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(account_type)) {
    return c.json({ error: "account_type must be one of asset|liability|equity|revenue|expense" }, 400)
  }
  if (!['debit', 'credit'].includes(normal_balance)) {
    return c.json({ error: "normal_balance must be 'debit' or 'credit'" }, 400)
  }

  try {
    const account = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO acct_chart_of_accounts
           (company_id, parent_id, account_code, account_name, account_type, account_subtype, normal_balance, is_group, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, parent_id, account_code, account_name, account_type, account_subtype, normal_balance, is_group, is_active, description, created_at`,
        [company_id, parent_id || null, account_code, account_name, account_type, account_subtype || null, normal_balance, !!is_group, description || null]
      )
      return result.rows[0]
    })
    return c.json({ account }, 201)
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return c.json({ error: `Account code '${account_code}' already exists for this company` }, 409)
    }
    throw err
  }
})

// ── PATCH /api/accounting/accounts/:id ───────────────────────────────────────

app.patch('/api/accounting/accounts/:id', ...gate, async (c) => {
  const id = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { account_name, account_subtype, description, is_active } = body

  const existing = await query(`SELECT company_id FROM acct_chart_of_accounts WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Account not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  if (account_name   !== undefined) { sets.push(`account_name = $${p++}`);   params.push(account_name) }
  if (account_subtype !== undefined) { sets.push(`account_subtype = $${p++}`); params.push(account_subtype) }
  if (description    !== undefined) { sets.push(`description = $${p++}`);    params.push(description) }
  if (is_active       !== undefined) { sets.push(`is_active = $${p++}`);       params.push(!!is_active) }
  // account_code, account_type, normal_balance are intentionally not editable
  // once created - they're load-bearing for every posted journal line and the
  // trial balance; changing them under existing postings would corrupt history.
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)
  params.push(id)

  const account = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE acct_chart_of_accounts SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
      params
    )
    return result.rows[0]
  })
  return c.json({ account })
})

// ═══════════════════════════════════════════════════════════════════════════
// Journal entries
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/accounting/journal-entries ──────────────────────────────────────

app.get('/api/accounting/journal-entries', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const status     = c.req.query('status')
  const from       = c.req.query('from')
  const to         = c.req.query('to')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const conditions = ['company_id = $1']
  const params: unknown[] = [companyId]
  let p = 2
  if (status) { conditions.push(`status = $${p++}`); params.push(status) }
  if (from)   { conditions.push(`entry_date >= $${p++}`); params.push(from) }
  if (to)     { conditions.push(`entry_date <= $${p++}`); params.push(to) }

  const result = await query(
    `SELECT je.id, je.entry_no, je.entry_date, je.reference, je.narration, je.source_type,
            je.source_id, je.status, je.posted_at, je.voided_at, je.void_reason,
            je.reversal_of_id, je.created_at,
            COALESCE((SELECT SUM(debit) FROM acct_journal_entry_lines WHERE journal_entry_id = je.id), 0) AS total_debit
     FROM acct_journal_entries je
     WHERE ${conditions.join(' AND ')}
     ORDER BY je.entry_date DESC, je.created_at DESC`,
    params
  )
  return c.json({ entries: result.rows })
})

// ── GET /api/accounting/journal-entries/:id ──────────────────────────────────

app.get('/api/accounting/journal-entries/:id', ...gate, async (c) => {
  const id = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]

  const entryResult = await query(`SELECT * FROM acct_journal_entries WHERE id = $1`, [id])
  if (entryResult.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404)
  const entry = entryResult.rows[0]
  const scopeErr = assertCompanyInScope(companyIds, entry.company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const linesResult = await query(
    `SELECT l.id, l.line_no, l.account_id, l.debit, l.credit, l.description,
            a.account_code, a.account_name, a.account_type
     FROM acct_journal_entry_lines l
     JOIN acct_chart_of_accounts a ON a.id = l.account_id
     WHERE l.journal_entry_id = $1
     ORDER BY l.line_no`,
    [id]
  )
  return c.json({ entry, lines: linesResult.rows })
})

// ── POST /api/accounting/journal-entries ─────────────────────────────────────
// Always creates a draft. Posting is a separate, explicit step (below) so a
// mis-keyed entry never touches the ledger before someone reviews it.

app.post('/api/accounting/journal-entries', ...gate, async (c) => {
  const userId      = c.get('userId') as string
  const companyIds  = c.get('companyIds') as string[]
  const body        = await c.req.json()
  const { company_id, entry_date, reference, narration, source_type, source_id, lines } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!entry_date) return c.json({ error: 'entry_date is required' }, 400)

  const validated = validateLines(lines)
  if ('error' in validated) return c.json({ error: validated.error }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [company_id])
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)
  const prefix = companyResult.rows[0].invoice_prefix as string

  try {
    const entry = await transaction(async (client) => {
      const entryNo = await generateEntryNumber(client, company_id, prefix, entry_date)
      const entryResult = await client.query(
        `INSERT INTO acct_journal_entries
           (company_id, entry_no, entry_date, reference, narration, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [company_id, entryNo, entry_date, reference || null, narration || null, source_type || 'manual', source_id || null, userId]
      )
      const created = entryResult.rows[0]
      let lineNo = 1
      for (const line of validated.lines) {
        await client.query(
          `INSERT INTO acct_journal_entry_lines (journal_entry_id, company_id, line_no, account_id, debit, credit, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [created.id, company_id, lineNo++, line.account_id, line.debit || 0, line.credit || 0, line.description || null]
        )
      }
      return created
    })
    return c.json({ entry }, 201)
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return c.json({ error: 'Entry number collision - please retry.' }, 409)
    }
    throw err
  }
})

// ── PATCH /api/accounting/journal-entries/:id ────────────────────────────────
// Draft-only. The immutability trigger refuses this on posted/void entries at
// the DB level regardless, but check here too for a clean 409 instead of a 500.

app.patch('/api/accounting/journal-entries/:id', ...gate, async (c) => {
  const id = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { entry_date, reference, narration, lines } = body

  const existing = await query(`SELECT company_id, status FROM acct_journal_entries WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (existing.rows[0].status !== 'draft') {
    return c.json({ error: `Cannot edit a ${existing.rows[0].status} journal entry - only drafts are editable` }, 409)
  }

  let validatedLines: LineInput[] | undefined
  if (lines !== undefined) {
    const validated = validateLines(lines)
    if ('error' in validated) return c.json({ error: validated.error }, 400)
    validatedLines = validated.lines
  }

  const companyId = existing.rows[0].company_id as string
  const entry = await transaction(async (client) => {
    const sets: string[] = []
    const params: unknown[] = []
    let p = 1
    if (entry_date !== undefined) { sets.push(`entry_date = $${p++}`); params.push(entry_date) }
    if (reference  !== undefined) { sets.push(`reference = $${p++}`);  params.push(reference) }
    if (narration  !== undefined) { sets.push(`narration = $${p++}`);  params.push(narration) }
    if (sets.length > 0) {
      params.push(id)
      await client.query(`UPDATE acct_journal_entries SET ${sets.join(', ')} WHERE id = $${p}`, params)
    }
    if (validatedLines) {
      await client.query(`DELETE FROM acct_journal_entry_lines WHERE journal_entry_id = $1`, [id])
      let lineNo = 1
      for (const line of validatedLines) {
        await client.query(
          `INSERT INTO acct_journal_entry_lines (journal_entry_id, company_id, line_no, account_id, debit, credit, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, companyId, lineNo++, line.account_id, line.debit || 0, line.credit || 0, line.description || null]
        )
      }
    }
    const result = await client.query(`SELECT * FROM acct_journal_entries WHERE id = $1`, [id])
    return result.rows[0]
  })
  return c.json({ entry })
})

// ── DELETE /api/accounting/journal-entries/:id ───────────────────────────────
// Draft-only - the immutability trigger refuses this on posted/void entries.

app.delete('/api/accounting/journal-entries/:id', ...gate, async (c) => {
  const id = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id, status FROM acct_journal_entries WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  try {
    await transaction(async (client) => {
      await client.query(`DELETE FROM acct_journal_entries WHERE id = $1`, [id])
    })
  } catch (err) {
    // The DB trigger raises a plain exception, not a specific error code, on a
    // posted/void delete attempt - surface it as 409, not a 500.
    return c.json({ error: (err as Error).message }, 409)
  }
  return c.json({ ok: true })
})

// ── POST /api/accounting/journal-entries/:id/post ────────────────────────────
// The DB trigger (acct_check_entry_balances_on_post) enforces debits=credits
// and refuses to post into a locked fiscal period - this route just attempts
// the transition and translates the trigger's exception into a clean 4xx.

app.post('/api/accounting/journal-entries/:id/post', ...gate, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id, status FROM acct_journal_entries WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (existing.rows[0].status !== 'draft') {
    return c.json({ error: `Cannot post a ${existing.rows[0].status} journal entry - only drafts can be posted` }, 409)
  }

  try {
    const entry = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2 WHERE id = $1 RETURNING *`,
        [id, userId]
      )
      return result.rows[0]
    })
    return c.json({ entry })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409)
  }
})

// ── POST /api/accounting/journal-entries/:id/void ────────────────────────────
// Voids a posted entry AND posts an equal-and-opposite reversal entry in the
// same transaction, per docs/modules/ACCOUNTING_Build_Plan.md - voiding never
// makes the ledger inconsistent, it adds a correcting entry dated today.

app.post('/api/accounting/journal-entries/:id/void', ...gate, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json().catch(() => ({}))
  const reason = body?.reason as string | undefined
  if (!reason) return c.json({ error: 'reason is required to void a posted journal entry' }, 400)
  const voidReason: string = reason

  const existing = await query(`SELECT company_id, status, entry_no FROM acct_journal_entries WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Journal entry not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (existing.rows[0].status !== 'posted') {
    return c.json({ error: `Cannot void a ${existing.rows[0].status} journal entry - only posted entries can be voided` }, 409)
  }
  const companyId = existing.rows[0].company_id as string

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [companyId])
  const prefix = companyResult.rows[0].invoice_prefix as string

  try {
    const result = await transaction(async (client) =>
      voidEntryWithReversal(client, { entryId: id as string, companyId, prefix, userId, reason: voidReason })
    )
    return c.json(result)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Fiscal periods
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/accounting/fiscal-periods ───────────────────────────────────────

app.get('/api/accounting/fiscal-periods', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT id, period_type, period_start, period_end, label, locked_at, locked_by, created_at
     FROM acct_fiscal_periods
     WHERE company_id = $1
     ORDER BY period_start DESC`,
    [companyId]
  )
  return c.json({ periods: result.rows })
})

// ── POST /api/accounting/fiscal-periods ──────────────────────────────────────

app.post('/api/accounting/fiscal-periods', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, period_type, period_start, period_end, label } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!period_start || !period_end) return c.json({ error: 'period_start and period_end are required' }, 400)
  if (!label) return c.json({ error: 'label is required' }, 400)

  try {
    const period = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO acct_fiscal_periods (company_id, period_type, period_start, period_end, label)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [company_id, period_type || 'month', period_start, period_end, label]
      )
      return result.rows[0]
    })
    return c.json({ period }, 201)
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') {
      return c.json({ error: 'A fiscal period with this date range already exists for this company' }, 409)
    }
    throw err
  }
})

// ── POST /api/accounting/fiscal-periods/:id/lock ─────────────────────────────
// CEO/creator only - closing a period is a statutory-adjacent action (see
// docs/modules/ACCOUNTING_Build_Plan.md's period-locking section), not
// day-to-day bookkeeping. The DB trigger additionally makes unlocking
// impossible through the application at all, for anyone.

app.post('/api/accounting/fiscal-periods/:id/lock', requireAuth, requireModule('accounting'), requireRole('ceo'), async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT company_id, locked_at FROM acct_fiscal_periods WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Fiscal period not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, existing.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (existing.rows[0].locked_at) return c.json({ error: 'Period is already locked' }, 409)

  const period = await transaction(async (client) => {
    const result = await client.query(
      `UPDATE acct_fiscal_periods SET locked_at = NOW(), locked_by = $2 WHERE id = $1 RETURNING *`,
      [id, userId]
    )
    return result.rows[0]
  })
  return c.json({ period })
})

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers used by the sections below (Bills, Expenses, Transfers,
// Bank Accounts, AR payment recording) - written after Slice 2's core engine
// once it became clear these all need the same two things: a way to find a
// company's system accounts (AR/AP/Cash/Bank) without hardcoding IDs, and a
// void+reversal routine that isn't copy-pasted per feature.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Look up a company's account by account_subtype (e.g. 'accounts_receivable',
 * 'accounts_payable', 'cash', 'bank'). These are seeded once via
 * POST /api/accounting/accounts/seed-defaults - if that hasn't run yet, every
 * route below fails with a clear, actionable message instead of a null-ref.
 */
async function getSystemAccount(companyId: string, subtype: string): Promise<{ id: string; account_name: string } | null> {
  const result = await query(
    `SELECT id, account_name FROM acct_chart_of_accounts
     WHERE company_id = $1 AND account_subtype = $2 AND is_active = true
     ORDER BY account_code LIMIT 1`,
    [companyId, subtype]
  )
  return result.rows[0] ?? null
}

const MISSING_ACCOUNTS_ERROR =
  "This company has no chart of accounts set up yet. A CEO/creator needs to run POST /api/accounting/accounts/seed-defaults first."

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = { query: (text: string, params?: any[]) => Promise<any> }

/**
 * Void a posted journal entry and post its equal-and-opposite reversal, inside
 * an already-open transaction client. Same routine as
 * POST /api/accounting/journal-entries/:id/void below - factored out because
 * Bills' void path (further down) needs to void the bill's underlying AP
 * entry the same way, and a second hand-copied implementation is exactly how
 * these two versions drift and one of them stops actually verifying balance.
 */
async function voidEntryWithReversal(
  client: TxClient,
  args: { entryId: string; companyId: string; prefix: string; userId: string; reason: string }
): Promise<{ voided: unknown; reversal: unknown }> {
  const { entryId, companyId, prefix, userId, reason } = args

  const entryRes = await client.query(`SELECT entry_no, status FROM acct_journal_entries WHERE id = $1`, [entryId])
  if (entryRes.rows.length === 0) throw new Error('Journal entry not found')
  if (entryRes.rows[0].status !== 'posted') throw new Error(`Cannot void a ${entryRes.rows[0].status} journal entry - only posted entries can be voided`)
  const originalEntryNo = entryRes.rows[0].entry_no as string

  const linesResult = await client.query(
    `SELECT account_id, debit, credit, description FROM acct_journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_no`,
    [entryId]
  )

  const today = new Date().toISOString().slice(0, 10)
  const reversalNo = await generateEntryNumber(client, companyId, prefix, today)
  const reversalResult = await client.query(
    `INSERT INTO acct_journal_entries
       (company_id, entry_no, entry_date, reference, narration, source_type, reversal_of_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7)
     RETURNING *`,
    [companyId, reversalNo, today, `Reversal of ${originalEntryNo}`, `Void reason: ${reason}`, entryId, userId]
  )
  const reversal = reversalResult.rows[0]

  let lineNo = 1
  for (const line of linesResult.rows) {
    await client.query(
      `INSERT INTO acct_journal_entry_lines (journal_entry_id, company_id, line_no, account_id, debit, credit, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [reversal.id, companyId, lineNo++, line.account_id, line.credit, line.debit, line.description]
    )
  }

  const postedReversalResult = await client.query(
    `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2 WHERE id = $1 RETURNING *`,
    [reversal.id, userId]
  )

  const voidResult = await client.query(
    `UPDATE acct_journal_entries
     SET status = 'void', voided_at = NOW(), voided_by = $2, void_reason = $3
     WHERE id = $1
     RETURNING *`,
    [entryId, userId, reason]
  )

  return { voided: voidResult.rows[0], reversal: postedReversalResult.rows[0] }
}

/** Create + immediately post a simple two-line journal entry (Dr one account, Cr another). Used by Expenses and Transfers, which are always-already-happened events, not drafts to review later. */
async function postSimpleEntry(
  client: TxClient,
  args: { companyId: string; prefix: string; entryDate: string; drAccountId: string; crAccountId: string; amount: number; reference: string; narration: string; sourceType: string; userId: string }
): Promise<unknown> {
  const { companyId, prefix, entryDate, drAccountId, crAccountId, amount, reference, narration, sourceType, userId } = args
  const entryNo = await generateEntryNumber(client, companyId, prefix, entryDate)
  const entryResult = await client.query(
    `INSERT INTO acct_journal_entries (company_id, entry_no, entry_date, reference, narration, source_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [companyId, entryNo, entryDate, reference, narration, sourceType, userId]
  )
  const entryId = entryResult.rows[0].id
  await client.query(
    `INSERT INTO acct_journal_entry_lines (journal_entry_id, company_id, line_no, account_id, debit, credit) VALUES ($1, $2, 1, $3, $4, 0)`,
    [entryId, companyId, drAccountId, amount]
  )
  await client.query(
    `INSERT INTO acct_journal_entry_lines (journal_entry_id, company_id, line_no, account_id, debit, credit) VALUES ($1, $2, 2, $3, 0, $4)`,
    [entryId, companyId, crAccountId, amount]
  )
  const posted = await client.query(
    `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2 WHERE id = $1 RETURNING *`,
    [entryId, userId]
  )
  return posted.rows[0]
}

// ═══════════════════════════════════════════════════════════════════════════
// Seed default chart of accounts
// ═══════════════════════════════════════════════════════════════════════════
// A standard Indian-SMB-services chart. CEO/creator only - one-time company
// setup, not day-to-day bookkeeping. Refuses to run twice (no upsert/merge)
// so it can never silently duplicate or clobber a company's real chart.

const DEFAULT_ACCOUNTS: { code: string; name: string; type: string; subtype: string; normal: 'debit' | 'credit' }[] = [
  { code: '1000', name: 'Cash',                      type: 'asset',     subtype: 'cash',                  normal: 'debit' },
  { code: '1010', name: 'Bank Account',               type: 'asset',     subtype: 'bank',                  normal: 'debit' },
  { code: '1200', name: 'Accounts Receivable',        type: 'asset',     subtype: 'accounts_receivable',   normal: 'debit' },
  { code: '1400', name: 'GST Input CGST',             type: 'asset',     subtype: 'gst_input',              normal: 'debit' },
  { code: '1401', name: 'GST Input SGST',             type: 'asset',     subtype: 'gst_input',              normal: 'debit' },
  { code: '1402', name: 'GST Input IGST',             type: 'asset',     subtype: 'gst_input',              normal: 'debit' },
  { code: '2000', name: 'Accounts Payable',           type: 'liability', subtype: 'accounts_payable',       normal: 'credit' },
  { code: '2200', name: 'GST Output CGST',            type: 'liability', subtype: 'gst_output',             normal: 'credit' },
  { code: '2201', name: 'GST Output SGST',            type: 'liability', subtype: 'gst_output',             normal: 'credit' },
  { code: '2202', name: 'GST Output IGST',            type: 'liability', subtype: 'gst_output',             normal: 'credit' },
  { code: '2300', name: 'TDS Payable',                type: 'liability', subtype: 'tds_payable',            normal: 'credit' },
  { code: '3000', name: 'Opening Balance Equity',     type: 'equity',    subtype: 'opening_balance_equity',  normal: 'credit' },
  { code: '4000', name: 'Revenue - Services',         type: 'revenue',   subtype: 'operating_revenue',       normal: 'credit' },
  { code: '5000', name: 'Contractor & Professional Fees', type: 'expense', subtype: 'cogs',                 normal: 'debit' },
  { code: '5100', name: 'Salaries & Wages',           type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5200', name: 'Rent',                       type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5300', name: 'Software & Subscriptions',   type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5400', name: 'Marketing & Advertising',    type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5500', name: 'Travel & Conveyance',        type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5600', name: 'Office Expenses',            type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
  { code: '5900', name: 'Miscellaneous Expenses',     type: 'expense',   subtype: 'operating_expense',       normal: 'debit' },
]

app.post('/api/accounting/accounts/seed-defaults', requireAuth, requireModule('accounting'), requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id } = body
  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const existing = await query(`SELECT id FROM acct_chart_of_accounts WHERE company_id = $1 LIMIT 1`, [company_id])
  if (existing.rows.length > 0) {
    return c.json({ error: 'This company already has a chart of accounts - seed-defaults only runs once, to avoid duplicating or clobbering real data.' }, 409)
  }

  const accounts = await transaction(async (client) => {
    const created = []
    for (const a of DEFAULT_ACCOUNTS) {
      const result = await client.query(
        `INSERT INTO acct_chart_of_accounts (company_id, account_code, account_name, account_type, account_subtype, normal_balance)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [company_id, a.code, a.name, a.type, a.subtype, a.normal]
      )
      created.push(result.rows[0])
    }
    return created
  })
  return c.json({ accounts }, 201)
})

// ═══════════════════════════════════════════════════════════════════════════
// Bills (Accounts Payable)
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/accounting/bills', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const status     = c.req.query('status')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const conditions = ['company_id = $1']
  const params: unknown[] = [companyId]
  if (status) { conditions.push(`status = $2`); params.push(status) }

  const result = await query(
    `SELECT id, vendor_name, bill_no, bill_date, due_date, amount, status, created_at
     FROM acct_bills WHERE ${conditions.join(' AND ')}
     ORDER BY bill_date DESC, created_at DESC`,
    params
  )
  return c.json({ bills: result.rows })
})

app.get('/api/accounting/bills/:id', ...gate, async (c) => {
  const id = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const result = await query(`SELECT * FROM acct_bills WHERE id = $1`, [id])
  if (result.rows.length === 0) return c.json({ error: 'Bill not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, result.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  return c.json({ bill: result.rows[0] })
})

// Creates the bill AND posts its AP-recognition entry (Dr expense_account_id,
// Cr Accounts Payable) atomically - a bill with no ledger effect isn't real
// bookkeeping, so there's no "draft bill" state the way journal entries have one.
app.post('/api/accounting/bills', ...gate, async (c) => {
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, vendor_name, bill_no, bill_date, due_date, amount, expense_account_id } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!vendor_name) return c.json({ error: 'vendor_name is required' }, 400)
  if (!bill_date) return c.json({ error: 'bill_date is required' }, 400)
  if (!expense_account_id) return c.json({ error: 'expense_account_id is required' }, 400)
  const amt = parseFloat(String(amount))
  if (isNaN(amt) || amt <= 0) return c.json({ error: 'amount must be a positive number' }, 400)

  const ap = await getSystemAccount(company_id, 'accounts_payable')
  if (!ap) return c.json({ error: MISSING_ACCOUNTS_ERROR }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [company_id])
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)
  const prefix = companyResult.rows[0].invoice_prefix as string

  const bill = await transaction(async (client) => {
    const entry = (await postSimpleEntry(client, {
      companyId: company_id, prefix, entryDate: bill_date,
      drAccountId: expense_account_id, crAccountId: ap.id, amount: amt,
      reference: bill_no || vendor_name, narration: `Bill from ${vendor_name}`,
      sourceType: 'bill', userId,
    })) as { id: string }

    const billResult = await client.query(
      `INSERT INTO acct_bills (company_id, vendor_name, bill_no, bill_date, due_date, amount, status, journal_entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8) RETURNING *`,
      [company_id, vendor_name, bill_no || null, bill_date, due_date || null, amt, entry.id, userId]
    )
    return billResult.rows[0]
  })
  return c.json({ bill }, 201)
})

app.post('/api/accounting/bills/:id/record-payment', ...gate, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { bank_account_id, payment_date } = body

  const existing = await query(`SELECT * FROM acct_bills WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Bill not found' }, 404)
  const bill = existing.rows[0]
  const scopeErr = assertCompanyInScope(companyIds, bill.company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (bill.status !== 'approved') return c.json({ error: `Cannot record payment on a ${bill.status} bill` }, 409)
  if (!bank_account_id) return c.json({ error: 'bank_account_id is required' }, 400)

  const ap = await getSystemAccount(bill.company_id, 'accounts_payable')
  if (!ap) return c.json({ error: MISSING_ACCOUNTS_ERROR }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [bill.company_id])
  const prefix = companyResult.rows[0].invoice_prefix as string
  const date = payment_date || new Date().toISOString().slice(0, 10)

  const result = await transaction(async (client) => {
    const entry = (await postSimpleEntry(client, {
      companyId: bill.company_id, prefix, entryDate: date,
      drAccountId: ap.id, crAccountId: bank_account_id, amount: parseFloat(bill.amount),
      reference: bill.bill_no || bill.vendor_name, narration: `Payment for bill from ${bill.vendor_name}`,
      sourceType: 'payment', userId,
    })) as { id: string }

    const updated = await client.query(
      `UPDATE acct_bills SET status = 'paid', paid_journal_entry_id = $2 WHERE id = $1 RETURNING *`,
      [id, entry.id]
    )
    return { bill: updated.rows[0], paymentEntry: entry }
  })
  return c.json(result)
})

app.post('/api/accounting/bills/:id/void', ...gate, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json().catch(() => ({}))
  const reason = body?.reason as string | undefined
  if (!reason) return c.json({ error: 'reason is required to void a bill' }, 400)
  const voidReason: string = reason

  const existing = await query(`SELECT * FROM acct_bills WHERE id = $1`, [id])
  if (existing.rows.length === 0) return c.json({ error: 'Bill not found' }, 404)
  const bill = existing.rows[0]
  const scopeErr = assertCompanyInScope(companyIds, bill.company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (bill.status === 'paid') return c.json({ error: 'Cannot void a paid bill - it has a payment recorded against it. Void the payment entry via the journal entries page first.' }, 409)
  if (bill.status === 'void') return c.json({ error: 'Bill is already void' }, 409)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [bill.company_id])
  const prefix = companyResult.rows[0].invoice_prefix as string

  try {
    const result = await transaction(async (client) => {
      await voidEntryWithReversal(client, { entryId: bill.journal_entry_id, companyId: bill.company_id, prefix, userId, reason: voidReason })
      const updated = await client.query(`UPDATE acct_bills SET status = 'void' WHERE id = $1 RETURNING *`, [id])
      return updated.rows[0]
    })
    return c.json({ bill: result })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409)
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Expenses — quick-add, ledger-backed (replaces finance_expenses for new entry)
// ═══════════════════════════════════════════════════════════════════════════
// docs/modules/ACCOUNTING_Build_Plan.md: "migrate quick-add UX from old
// /accounting page" - same one-row, fast-entry feel, but every expense is now
// a real posted journal entry (Dr expense account, Cr cash/bank), not a row in
// the old flat finance_expenses table.

app.get('/api/accounting/expenses', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  // An "expense" is a posted journal entry with source_type='expense'. The
  // debit line (the expense account, never the cash/bank credit side) is what
  // the UI shows as "category" - mirroring the old page's day-book shape.
  const result = await query(
    `SELECT je.id, je.entry_no, je.entry_date, je.narration, je.reference, je.created_at,
            l.debit AS amount, a.account_name AS category, a.id AS account_id
     FROM acct_journal_entries je
     JOIN acct_journal_entry_lines l ON l.journal_entry_id = je.id AND l.debit > 0
     JOIN acct_chart_of_accounts a ON a.id = l.account_id
     WHERE je.company_id = $1 AND je.source_type = 'expense' AND je.status = 'posted'
     ORDER BY je.entry_date DESC, je.created_at DESC`,
    [companyId]
  )
  return c.json({ expenses: result.rows })
})

app.post('/api/accounting/expenses', ...gate, async (c) => {
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, date, expense_account_id, bank_account_id, amount, description } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!date) return c.json({ error: 'date is required' }, 400)
  if (!expense_account_id) return c.json({ error: 'expense_account_id is required' }, 400)
  if (!bank_account_id) return c.json({ error: 'bank_account_id is required' }, 400)
  const amt = parseFloat(String(amount))
  if (isNaN(amt) || amt <= 0) return c.json({ error: 'amount must be a positive number' }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [company_id])
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)
  const prefix = companyResult.rows[0].invoice_prefix as string

  const entry = await transaction(async (client) =>
    postSimpleEntry(client, {
      companyId: company_id, prefix, entryDate: date,
      drAccountId: expense_account_id, crAccountId: bank_account_id, amount: amt,
      reference: description || 'Expense', narration: description || 'Quick-add expense',
      sourceType: 'expense', userId,
    })
  )
  return c.json({ entry }, 201)
})

// ═══════════════════════════════════════════════════════════════════════════
// Transfer Funds — between two of the company's own cash/bank accounts
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/accounting/transfers', ...gate, async (c) => {
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { company_id, date, from_account_id, to_account_id, amount, description } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!date) return c.json({ error: 'date is required' }, 400)
  if (!from_account_id || !to_account_id) return c.json({ error: 'from_account_id and to_account_id are required' }, 400)
  if (from_account_id === to_account_id) return c.json({ error: 'from_account_id and to_account_id must be different' }, 400)
  const amt = parseFloat(String(amount))
  if (isNaN(amt) || amt <= 0) return c.json({ error: 'amount must be a positive number' }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [company_id])
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)
  const prefix = companyResult.rows[0].invoice_prefix as string

  const entry = await transaction(async (client) =>
    // source_type has no dedicated 'transfer' value (CHECK constraint in
    // migrations/062) - 'manual' plus a clear reference is enough to identify
    // these without a schema migration for a purely cosmetic distinction.
    postSimpleEntry(client, {
      companyId: company_id, prefix, entryDate: date,
      drAccountId: to_account_id, crAccountId: from_account_id, amount: amt,
      reference: description || 'Transfer', narration: description || 'Fund transfer',
      sourceType: 'manual', userId,
    })
  )
  return c.json({ entry }, 201)
})

// ═══════════════════════════════════════════════════════════════════════════
// Bank / Cash accounts — these are just chart-of-accounts rows with
// account_subtype 'bank' or 'cash', not a separate table (see ACCOUNTING_Build_Plan.md's
// R&D reasoning: an accounting system's "bank account list" IS its asset accounts).
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/accounting/bank-accounts', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT ca.id, ca.account_code, ca.account_name, ca.account_subtype,
            COALESCE((
              SELECT SUM(l.debit) - SUM(l.credit)
              FROM acct_journal_entry_lines l
              JOIN acct_journal_entries je ON je.id = l.journal_entry_id
              WHERE l.account_id = ca.id AND je.status = 'posted'
            ), 0) AS balance
     FROM acct_chart_of_accounts ca
     WHERE ca.company_id = $1 AND ca.account_subtype IN ('bank', 'cash') AND ca.is_active = true
     ORDER BY ca.account_code`,
    [companyId]
  )
  return c.json({ accounts: result.rows })
})

app.get('/api/accounting/bank-accounts/:accountId/register', ...gate, async (c) => {
  const accountId = c.req.param('accountId')
  const companyIds = c.get('companyIds') as string[]

  const acctResult = await query(`SELECT company_id, account_name FROM acct_chart_of_accounts WHERE id = $1`, [accountId])
  if (acctResult.rows.length === 0) return c.json({ error: 'Account not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, acctResult.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT je.entry_date, je.entry_no, je.reference, je.narration, je.source_type,
            l.debit, l.credit,
            SUM(l.debit - l.credit) OVER (ORDER BY je.entry_date, je.created_at, l.line_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
     FROM acct_journal_entry_lines l
     JOIN acct_journal_entries je ON je.id = l.journal_entry_id
     WHERE l.account_id = $1 AND je.status = 'posted'
     ORDER BY je.entry_date, je.created_at, l.line_no`,
    [accountId]
  )
  return c.json({ account_name: acctResult.rows[0].account_name, lines: result.rows })
})

// ═══════════════════════════════════════════════════════════════════════════
// AR — record a payment against an existing sales_invoices row
// ═══════════════════════════════════════════════════════════════════════════
// Invoices themselves (create/send/list) stay on the main app's
// /api/invoices (api/routes/invoices.ts) - not duplicated here. This route is
// the one piece that was missing: recording a payment so far only flipped
// sales_invoices.status, with no ledger effect at all. Now it also posts
// Dr [bank_account] / Cr Accounts Receivable.

app.post('/api/accounting/invoices/:invoiceId/record-payment', ...gate, async (c) => {
  const invoiceId = c.req.param('invoiceId')
  const userId = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const { bank_account_id, payment_date } = body

  const invoiceResult = await query(`SELECT * FROM sales_invoices WHERE id = $1`, [invoiceId])
  if (invoiceResult.rows.length === 0) return c.json({ error: 'Invoice not found' }, 404)
  const invoice = invoiceResult.rows[0]
  const scopeErr = assertCompanyInScope(companyIds, invoice.company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (invoice.status === 'paid') return c.json({ error: 'Invoice is already paid' }, 409)
  if (!bank_account_id) return c.json({ error: 'bank_account_id is required' }, 400)

  const ar = await getSystemAccount(invoice.company_id, 'accounts_receivable')
  if (!ar) return c.json({ error: MISSING_ACCOUNTS_ERROR }, 400)

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [invoice.company_id])
  const prefix = companyResult.rows[0].invoice_prefix as string
  const date = payment_date || new Date().toISOString().slice(0, 10)

  const result = await transaction(async (client) => {
    const entry = (await postSimpleEntry(client, {
      companyId: invoice.company_id, prefix, entryDate: date,
      drAccountId: bank_account_id, crAccountId: ar.id, amount: parseFloat(invoice.total),
      reference: invoice.invoice_no, narration: `Payment received for ${invoice.invoice_no}`,
      sourceType: 'invoice', userId,
    })) as { id: string }

    const updated = await client.query(
      `UPDATE sales_invoices SET status = 'paid', paid_at = NOW() WHERE id = $1 RETURNING id, status, paid_at`,
      [invoiceId]
    )
    return { invoice: updated.rows[0], paymentEntry: entry }
  })
  return c.json(result)
})

// ═══════════════════════════════════════════════════════════════════════════
// Reports (Slice 5) — Trial Balance, P&L, Balance Sheet, General Ledger,
// Day Book, AR/AP Aging, Customer/Vendor Balance Summary, cross-company rollup.
//
// All CEO/creator-only (requireRole('ceo') on top of the module gate) - these
// are the "sensitive aggregate views" the Slice 2 access-split decision
// reserved, unlike the transactional routes above which are business-role.
// ═══════════════════════════════════════════════════════════════════════════

const reportGate = [requireAuth, requireModule('accounting'), requireRole('ceo')] as const

// ── GET /api/accounting/reports/trial-balance ────────────────────────────────

app.get('/api/accounting/reports/trial-balance', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const asOf       = c.req.query('as_of') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT a.id, a.account_code, a.account_name, a.account_type, a.normal_balance,
            COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM acct_chart_of_accounts a
     LEFT JOIN acct_journal_entry_lines l ON l.account_id = a.id
     LEFT JOIN acct_journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted' AND je.entry_date <= $2
     WHERE a.company_id = $1 AND a.is_group = false
     GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.normal_balance
     HAVING COALESCE(SUM(l.debit), 0) != 0 OR COALESCE(SUM(l.credit), 0) != 0
     ORDER BY a.account_code`,
    [companyId, asOf]
  )
  const accounts = result.rows.map((r) => {
    const debit = parseFloat(r.debit)
    const credit = parseFloat(r.credit)
    const balance = r.normal_balance === 'debit' ? debit - credit : credit - debit
    return { ...r, debit, credit, balance }
  })
  const totals = {
    debit: accounts.reduce((s, a) => s + a.debit, 0),
    credit: accounts.reduce((s, a) => s + a.credit, 0),
  }
  return c.json({ as_of: asOf, accounts, totals })
})

// ── GET /api/accounting/reports/profit-and-loss ──────────────────────────────

app.get('/api/accounting/reports/profit-and-loss', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const from       = c.req.query('from') || '1900-01-01'
  const to         = c.req.query('to') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT a.id, a.account_code, a.account_name, a.account_type,
            COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM acct_chart_of_accounts a
     JOIN acct_journal_entry_lines l ON l.account_id = a.id
     JOIN acct_journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted'
       AND je.entry_date BETWEEN $2 AND $3
     WHERE a.company_id = $1 AND a.account_type IN ('revenue', 'expense') AND a.is_group = false
     GROUP BY a.id, a.account_code, a.account_name, a.account_type
     ORDER BY a.account_code`,
    [companyId, from, to]
  )
  const revenue = result.rows.filter((r) => r.account_type === 'revenue')
    .map((r) => ({ ...r, amount: parseFloat(r.credit) - parseFloat(r.debit) }))
  const expenses = result.rows.filter((r) => r.account_type === 'expense')
    .map((r) => ({ ...r, amount: parseFloat(r.debit) - parseFloat(r.credit) }))
  const total_revenue = revenue.reduce((s, a) => s + a.amount, 0)
  const total_expenses = expenses.reduce((s, a) => s + a.amount, 0)
  return c.json({ from, to, revenue, expenses, total_revenue, total_expenses, net_profit: total_revenue - total_expenses })
})

// ── GET /api/accounting/reports/balance-sheet ────────────────────────────────
// Equity includes a computed "Net Income (undistributed)" line = all-time
// revenue minus expenses up to as_of - this repo has no period-closing step
// that formally transfers P&L into retained earnings, so the sheet only
// balances (Assets = Liabilities + Equity) if that line is shown explicitly.
// This is the standard presentation for a system without formal closing
// entries, not a shortcut - see docs/modules/ACCOUNTING_Build_Plan.md.

app.get('/api/accounting/reports/balance-sheet', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const asOf       = c.req.query('as_of') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const balResult = await query(
    `SELECT a.id, a.account_code, a.account_name, a.account_type,
            COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net_debit
     FROM acct_chart_of_accounts a
     LEFT JOIN acct_journal_entry_lines l ON l.account_id = a.id
     LEFT JOIN acct_journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted' AND je.entry_date <= $2
     WHERE a.company_id = $1 AND a.account_type IN ('asset', 'liability', 'equity') AND a.is_group = false
     GROUP BY a.id, a.account_code, a.account_name, a.account_type
     HAVING COALESCE(SUM(l.debit), 0) != 0 OR COALESCE(SUM(l.credit), 0) != 0
     ORDER BY a.account_code`,
    [companyId, asOf]
  )
  const assets = balResult.rows.filter((r) => r.account_type === 'asset').map((r) => ({ ...r, amount: parseFloat(r.net_debit) }))
  const liabilities = balResult.rows.filter((r) => r.account_type === 'liability').map((r) => ({ ...r, amount: -parseFloat(r.net_debit) }))
  const equity = balResult.rows.filter((r) => r.account_type === 'equity').map((r) => ({ ...r, amount: -parseFloat(r.net_debit) }))

  const pnlResult = await query(
    `SELECT a.account_type, COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net_debit
     FROM acct_chart_of_accounts a
     JOIN acct_journal_entry_lines l ON l.account_id = a.id
     JOIN acct_journal_entries je ON je.id = l.journal_entry_id AND je.status = 'posted' AND je.entry_date <= $2
     WHERE a.company_id = $1 AND a.account_type IN ('revenue', 'expense')
     GROUP BY a.account_type`,
    [companyId, asOf]
  )
  let netIncome = 0
  for (const r of pnlResult.rows) {
    netIncome += r.account_type === 'expense' ? parseFloat(r.net_debit) : -parseFloat(r.net_debit)
  }

  const total_assets = assets.reduce((s, a) => s + a.amount, 0)
  const total_liabilities = liabilities.reduce((s, a) => s + a.amount, 0)
  const total_equity = equity.reduce((s, a) => s + a.amount, 0) + netIncome

  return c.json({
    as_of: asOf, assets, liabilities, equity, net_income: netIncome,
    total_assets, total_liabilities, total_equity,
    total_liabilities_and_equity: total_liabilities + total_equity,
  })
})

// ── GET /api/accounting/reports/ledger/:accountId ────────────────────────────
// General ledger for ANY account (not just bank/cash - see the bank-accounts
// register above for that narrower, subtype-filtered case reused by the
// Banking page). This is the general-purpose version every other account
// (revenue, expense, AR, AP, GST accounts) needs too.

app.get('/api/accounting/reports/ledger/:accountId', ...reportGate, async (c) => {
  const accountId = c.req.param('accountId')
  const companyIds = c.get('companyIds') as string[]
  const from = c.req.query('from') || '1900-01-01'
  const to   = c.req.query('to') || new Date().toISOString().slice(0, 10)

  const acctResult = await query(`SELECT company_id, account_name, account_code, normal_balance FROM acct_chart_of_accounts WHERE id = $1`, [accountId])
  if (acctResult.rows.length === 0) return c.json({ error: 'Account not found' }, 404)
  const scopeErr = assertCompanyInScope(companyIds, acctResult.rows[0].company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT je.entry_date, je.entry_no, je.reference, je.narration, je.source_type,
            l.debit, l.credit,
            SUM(l.debit - l.credit) OVER (ORDER BY je.entry_date, je.created_at, l.line_no
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
     FROM acct_journal_entry_lines l
     JOIN acct_journal_entries je ON je.id = l.journal_entry_id
     WHERE l.account_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
     ORDER BY je.entry_date, je.created_at, l.line_no`,
    [accountId, from, to]
  )
  return c.json({ account: acctResult.rows[0], from, to, lines: result.rows })
})

// ── GET /api/accounting/reports/day-book ─────────────────────────────────────
// Every posted transaction, chronological, across all accounts - the
// unfiltered "everything that happened" view.

app.get('/api/accounting/reports/day-book', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const from       = c.req.query('from') || '1900-01-01'
  const to         = c.req.query('to') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT je.id, je.entry_no, je.entry_date, je.reference, je.narration, je.source_type,
            a.account_code, a.account_name, l.debit, l.credit
     FROM acct_journal_entries je
     JOIN acct_journal_entry_lines l ON l.journal_entry_id = je.id
     JOIN acct_chart_of_accounts a ON a.id = l.account_id
     WHERE je.company_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
     ORDER BY je.entry_date DESC, je.created_at DESC, l.line_no`,
    [companyId, from, to]
  )
  return c.json({ from, to, lines: result.rows })
})

// ── GET /api/accounting/reports/ar-aging, /ap-aging ──────────────────────────
// Same bucket logic (Current / 1-30 / 31-60 / 60+ days overdue) as the AR
// aging strip already computed client-side on the Invoices page - this is the
// server-side version other reports (and the rollup below) reuse, so the
// bucket thresholds live in exactly one place going forward.

function agingBuckets(rows: { total: number; due_date: string | null }[]): { current: number; d1_30: number; d31_60: number; d60_plus: number } {
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 }
  const today = new Date()
  for (const r of rows) {
    if (!r.due_date) { buckets.current += r.total; continue }
    const days = Math.floor((today.getTime() - new Date(r.due_date).getTime()) / 86_400_000)
    if (days <= 0) buckets.current += r.total
    else if (days <= 30) buckets.d1_30 += r.total
    else if (days <= 60) buckets.d31_60 += r.total
    else buckets.d60_plus += r.total
  }
  return buckets
}

app.get('/api/accounting/reports/ar-aging', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT total, due_date FROM sales_invoices WHERE company_id = $1 AND status IN ('sent', 'overdue')`,
    [companyId]
  )
  const rows = result.rows.map((r) => ({ total: parseFloat(r.total), due_date: r.due_date }))
  return c.json({ buckets: agingBuckets(rows), total_outstanding: rows.reduce((s, r) => s + r.total, 0) })
})

app.get('/api/accounting/reports/ap-aging', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT amount AS total, due_date FROM acct_bills WHERE company_id = $1 AND status = 'approved'`,
    [companyId]
  )
  const rows = result.rows.map((r) => ({ total: parseFloat(r.total), due_date: r.due_date }))
  return c.json({ buckets: agingBuckets(rows), total_outstanding: rows.reduce((s, r) => s + r.total, 0) })
})

// ── GET /api/accounting/reports/customer-balances, /vendor-balances ─────────

app.get('/api/accounting/reports/customer-balances', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT sc.id AS client_id, sc.name AS client_name,
            COALESCE(SUM(si.total) FILTER (WHERE si.status IN ('sent','overdue')), 0) AS outstanding,
            COALESCE(SUM(si.total) FILTER (WHERE si.status = 'paid'), 0) AS paid_total
     FROM sales_clients sc
     JOIN sales_invoices si ON si.client_id = sc.id
     WHERE si.company_id = $1
     GROUP BY sc.id, sc.name
     HAVING COALESCE(SUM(si.total) FILTER (WHERE si.status IN ('sent','overdue')), 0) != 0
     ORDER BY outstanding DESC`,
    [companyId]
  )
  return c.json({ customers: result.rows })
})

app.get('/api/accounting/reports/vendor-balances', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT vendor_name,
            COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS outstanding,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_total
     FROM acct_bills
     WHERE company_id = $1
     GROUP BY vendor_name
     HAVING COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) != 0
     ORDER BY outstanding DESC`,
    [companyId]
  )
  return c.json({ vendors: result.rows })
})

// ── GET /api/accounting/reports/rollup ────────────────────────────────────────
// The thing the old /accounting page explicitly could not do: every company
// the caller can see, side by side. Defaults to all of the caller's
// companyIds (creator sees all companies system-wide, per requireAuth).

app.get('/api/accounting/reports/rollup', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const requested = c.req.query('company_ids')
  const ids = requested ? requested.split(',').filter((id) => companyIds.includes(id)) : companyIds
  if (ids.length === 0) return c.json({ companies: [] })

  const result = await query(
    `SELECT co.id AS company_id, co.name AS company_name,
       COALESCE((
         SELECT SUM(l.credit) - SUM(l.debit) FROM acct_journal_entry_lines l
         JOIN acct_journal_entries je ON je.id = l.journal_entry_id
         JOIN acct_chart_of_accounts a ON a.id = l.account_id
         WHERE a.company_id = co.id AND a.account_type = 'revenue' AND je.status = 'posted'
       ), 0) AS revenue,
       COALESCE((
         SELECT SUM(l.debit) - SUM(l.credit) FROM acct_journal_entry_lines l
         JOIN acct_journal_entries je ON je.id = l.journal_entry_id
         JOIN acct_chart_of_accounts a ON a.id = l.account_id
         WHERE a.company_id = co.id AND a.account_type = 'expense' AND je.status = 'posted'
       ), 0) AS expenses,
       COALESCE((
         SELECT SUM(l.debit) - SUM(l.credit) FROM acct_journal_entry_lines l
         JOIN acct_journal_entries je ON je.id = l.journal_entry_id
         JOIN acct_chart_of_accounts a ON a.id = l.account_id
         WHERE a.company_id = co.id AND a.account_subtype IN ('bank','cash') AND je.status = 'posted'
       ), 0) AS cash_and_bank,
       COALESCE((SELECT SUM(total) FROM sales_invoices WHERE company_id = co.id AND status IN ('sent','overdue')), 0) AS ar_outstanding,
       COALESCE((SELECT SUM(amount) FROM acct_bills WHERE company_id = co.id AND status = 'approved'), 0) AS ap_outstanding
     FROM companies co
     WHERE co.id = ANY($1)
     ORDER BY co.name`,
    [ids]
  )
  const companiesOut = result.rows.map((r) => ({
    ...r,
    revenue: parseFloat(r.revenue), expenses: parseFloat(r.expenses),
    net_profit: parseFloat(r.revenue) - parseFloat(r.expenses),
    cash_and_bank: parseFloat(r.cash_and_bank), ar_outstanding: parseFloat(r.ar_outstanding), ap_outstanding: parseFloat(r.ap_outstanding),
  }))
  const totals = {
    revenue: companiesOut.reduce((s, x) => s + x.revenue, 0),
    expenses: companiesOut.reduce((s, x) => s + x.expenses, 0),
    net_profit: companiesOut.reduce((s, x) => s + x.net_profit, 0),
    cash_and_bank: companiesOut.reduce((s, x) => s + x.cash_and_bank, 0),
    ar_outstanding: companiesOut.reduce((s, x) => s + x.ar_outstanding, 0),
    ap_outstanding: companiesOut.reduce((s, x) => s + x.ap_outstanding, 0),
  }
  return c.json({ companies: companiesOut, totals })
})

// ═══════════════════════════════════════════════════════════════════════════
// GST / TDS (Slice 6) — acct_tax_details CRUD + GSTR-1/GSTR-3B/TDS export reports
// ═══════════════════════════════════════════════════════════════════════════
// Per docs/modules/ACCOUNTING_Build_Plan.md's compliance R&D: CBOP's job is
// producing GSTR-1/3B-SHAPED reports a CA can use directly, and a correct
// TDS-deduction ledger - NOT filing with the government (that stays the CA's
// job, no GSTN/IRP integration here, deliberately).
//
// acct_tax_details (migration 062) already has every field this needs -
// GSTIN, HSN/SAC, CGST/SGST/IGST split, TDS section/rate/amount - attached to
// a doc_type/doc_id (invoice or bill). There is still no acct_vendors master
// table (deliberate, see migration 062's own comment) so vendor PAN/TDS
// defaults live per-bill on its tax_details row, not on a vendor record -
// acceptable at this scale, revisit if a real vendor master gets built later.

app.get('/api/accounting/tax-details', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const docType    = c.req.query('doc_type')
  const docId      = c.req.query('doc_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (docType && !['invoice', 'bill'].includes(docType)) return c.json({ error: "doc_type must be 'invoice' or 'bill'" }, 400)

  const conditions = ['company_id = $1']
  const params: unknown[] = [companyId]
  let p = 2
  if (docType) { conditions.push(`doc_type = $${p++}`); params.push(docType) }
  if (docId)   { conditions.push(`doc_id = $${p++}`);   params.push(docId) }

  const result = await query(
    `SELECT * FROM acct_tax_details WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  )
  return c.json({ tax_details: result.rows })
})

app.post('/api/accounting/tax-details', ...gate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const {
    company_id, doc_type, doc_id, counterparty_gstin, hsn_sac_code, taxable_value,
    cgst_rate, sgst_rate, igst_rate, cess_amount, tds_section, tds_rate,
  } = body

  const scopeErr = assertCompanyInScope(companyIds, company_id)
  if (scopeErr) return c.json({ error: scopeErr }, 403)
  if (!['invoice', 'bill'].includes(doc_type)) return c.json({ error: "doc_type must be 'invoice' or 'bill'" }, 400)
  if (!doc_id) return c.json({ error: 'doc_id is required' }, 400)
  const taxableVal = parseFloat(String(taxable_value))
  if (isNaN(taxableVal) || taxableVal < 0) return c.json({ error: 'taxable_value must be a non-negative number' }, 400)

  const cgstR = parseFloat(String(cgst_rate ?? 0)) || 0
  const sgstR = parseFloat(String(sgst_rate ?? 0)) || 0
  const igstR = parseFloat(String(igst_rate ?? 0)) || 0
  if (igstR > 0 && (cgstR > 0 || sgstR > 0)) {
    return c.json({ error: 'A line is either intra-state (CGST+SGST) or inter-state (IGST), not both' }, 400)
  }
  const cgstAmt = round2(taxableVal * cgstR / 100)
  const sgstAmt = round2(taxableVal * sgstR / 100)
  const igstAmt = round2(taxableVal * igstR / 100)
  const tdsR = tds_section ? parseFloat(String(tds_rate ?? 0)) || 0 : 0
  const tdsAmt = tds_section ? round2(taxableVal * tdsR / 100) : 0

  const detail = await transaction(async (client) => {
    const result = await client.query(
      `INSERT INTO acct_tax_details
         (company_id, doc_type, doc_id, counterparty_gstin, hsn_sac_code, taxable_value,
          cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, cess_amount,
          tds_section, tds_rate, tds_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [company_id, doc_type, doc_id, counterparty_gstin || null, hsn_sac_code || null, taxableVal,
       cgstR, cgstAmt, sgstR, sgstAmt, igstR, igstAmt, parseFloat(String(cess_amount ?? 0)) || 0,
       tds_section || null, tdsR || null, tdsAmt]
    )
    return result.rows[0]
  })
  return c.json({ tax_detail: detail }, 201)
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── GET /api/accounting/reports/gstr1 ────────────────────────────────────────
// B2B invoice-level table + HSN/SAC summary, shaped to match GSTR-1's actual
// portal columns (docs/modules/ACCOUNTING_Build_Plan.md R&D §1) - export only,
// never transmitted anywhere by CBOP.

app.get('/api/accounting/reports/gstr1', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const from       = c.req.query('from') || '1900-01-01'
  const to         = c.req.query('to') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const b2bResult = await query(
    `SELECT si.invoice_no, si.created_at::date AS invoice_date, td.counterparty_gstin, td.hsn_sac_code,
            td.taxable_value, td.cgst_amount, td.sgst_amount, td.igst_amount, td.cess_amount,
            (td.taxable_value + td.cgst_amount + td.sgst_amount + td.igst_amount + td.cess_amount) AS invoice_value
     FROM acct_tax_details td
     JOIN sales_invoices si ON si.id = td.doc_id AND td.doc_type = 'invoice'
     WHERE td.company_id = $1 AND si.created_at::date BETWEEN $2 AND $3
     ORDER BY si.created_at`,
    [companyId, from, to]
  )

  const hsnResult = await query(
    `SELECT td.hsn_sac_code, COUNT(*) AS invoice_count, SUM(td.taxable_value) AS taxable_value,
            SUM(td.cgst_amount) AS cgst_amount, SUM(td.sgst_amount) AS sgst_amount, SUM(td.igst_amount) AS igst_amount
     FROM acct_tax_details td
     JOIN sales_invoices si ON si.id = td.doc_id AND td.doc_type = 'invoice'
     WHERE td.company_id = $1 AND si.created_at::date BETWEEN $2 AND $3 AND td.hsn_sac_code IS NOT NULL
     GROUP BY td.hsn_sac_code
     ORDER BY td.hsn_sac_code`,
    [companyId, from, to]
  )

  return c.json({ from, to, b2b_invoices: b2bResult.rows, hsn_summary: hsnResult.rows })
})

// ── GET /api/accounting/reports/gstr3b ───────────────────────────────────────
// Table 3.1-shaped outward-supply summary by rate. Does NOT compute ITC
// (Table 4) - that's driven by GSTR-2B from the supplier side, outside
// CBOP's data entirely, per the R&D's software-vs-CA division of labor.

app.get('/api/accounting/reports/gstr3b', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const from       = c.req.query('from') || '1900-01-01'
  const to         = c.req.query('to') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT SUM(td.taxable_value) AS total_taxable_value,
            SUM(td.cgst_amount) AS total_cgst, SUM(td.sgst_amount) AS total_sgst,
            SUM(td.igst_amount) AS total_igst, SUM(td.cess_amount) AS total_cess
     FROM acct_tax_details td
     JOIN sales_invoices si ON si.id = td.doc_id AND td.doc_type = 'invoice'
     WHERE td.company_id = $1 AND si.created_at::date BETWEEN $2 AND $3`,
    [companyId, from, to]
  )
  const row = result.rows[0]
  return c.json({
    from, to,
    outward_taxable_supplies: {
      taxable_value: parseFloat(row.total_taxable_value) || 0,
      cgst: parseFloat(row.total_cgst) || 0,
      sgst: parseFloat(row.total_sgst) || 0,
      igst: parseFloat(row.total_igst) || 0,
      cess: parseFloat(row.total_cess) || 0,
    },
    note: 'ITC (Table 4) is not computed here - it is driven by GSTR-2B from the supplier side, reconciled by your CA.',
  })
})

// ── GET /api/accounting/reports/tds-ledger ───────────────────────────────────
// Per-vendor TDS deduction ledger from bill-linked tax_details. CBOP tracks
// what was deducted; challan deposit and 26Q/24Q filing stay the CA's job.

app.get('/api/accounting/reports/tds-ledger', ...reportGate, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.query('company_id')
  const from       = c.req.query('from') || '1900-01-01'
  const to         = c.req.query('to') || new Date().toISOString().slice(0, 10)
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const result = await query(
    `SELECT ab.vendor_name, td.counterparty_gstin AS vendor_pan_or_gstin, ab.bill_no, ab.bill_date,
            td.tds_section, td.tds_rate, td.taxable_value, td.tds_amount
     FROM acct_tax_details td
     JOIN acct_bills ab ON ab.id = td.doc_id AND td.doc_type = 'bill'
     WHERE td.company_id = $1 AND td.tds_section IS NOT NULL AND ab.bill_date BETWEEN $2 AND $3
     ORDER BY ab.bill_date`,
    [companyId, from, to]
  )
  const bySection: Record<string, number> = {}
  for (const r of result.rows) {
    bySection[r.tds_section] = (bySection[r.tds_section] || 0) + parseFloat(r.tds_amount)
  }
  const total_tds = result.rows.reduce((s, r) => s + parseFloat(r.tds_amount), 0)
  return c.json({ from, to, deductions: result.rows, total_tds, by_section: bySection })
})

// ═══════════════════════════════════════════════════════════════════════════
// Audit trail (Slice 7) — read-only view over the platform-wide audit_logs
// table (migration 059) for acct_* resources. No writer here - migration 062
// already wired cbop_write_audit_log() as an AFTER trigger on every acct_*
// table, so every insert/update/delete is already being recorded; this is
// purely the read/display side.
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/accounting/audit-log', requireAuth, requireModule('accounting'), requireRole('ceo'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const companyId   = c.req.query('company_id')
  const resourceType = c.req.query('resource_type')
  const resourceId   = c.req.query('resource_id')
  if (!companyId) return c.json({ error: 'company_id is required' }, 400)
  const scopeErr = assertCompanyInScope(companyIds, companyId)
  if (scopeErr) return c.json({ error: scopeErr }, 403)

  const conditions = ['al.company_id = $1']
  const params: unknown[] = [companyId]
  let p = 2
  if (resourceType) { conditions.push(`al.resource_type = $${p++}`); params.push(resourceType) }
  if (resourceId)   { conditions.push(`al.resource_id = $${p++}`);   params.push(resourceId) }

  const result = await query(
    `SELECT al.id, al.actor_id, al.actor_role, al.action, al.resource_type, al.resource_id,
            al.before_json, al.after_json, al.ip_address, al.created_at,
            u.name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT 500`,
    params
  )
  return c.json({ entries: result.rows })
})

export default app
