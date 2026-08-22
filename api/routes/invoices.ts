import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query, transaction } from '../lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest, writeMutationAuditLog } from '../lib/audit-log'
import { sendViaOpenClaw } from '../lib/openclaw'
import { buildInvoicePdf } from '../lib/pdf-generator'
import { notFound, validationError } from '../lib/route-utils'
import '../lib/hono-vars'
import { format } from 'date-fns'

const app = new Hono()

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateInvoiceNumber(client: { query: (text: string, params?: any[]) => Promise<any> }, companyId: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear()
  const like = `${prefix}-${year}-%`
  // Serializes concurrent invoice-number generation for this company+year (held for
  // the lifetime of the enclosing transaction) so two concurrent POSTs can never
  // compute the same next sequence number - the prior SELECT-MAX-then-INSERT was a
  // plain race with no locking. Locking on `prefix` (not just companyId) is what
  // keeps invoice and quotation numbering as two independent sequences even though
  // they share this same function.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice_seq:${companyId}:${prefix}:${year}`])
  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_no, '-', 3) AS INTEGER)), 0) AS max_seq
     FROM sales_invoices
     WHERE company_id = $1 AND invoice_no LIKE $2`,
    [companyId, like]
  )
  const nextSeq = ((result.rows[0]?.max_seq as number) + 1).toString().padStart(4, '0')
  return `${prefix}-${year}-${nextSeq}`
}

function formatDate(d: Date): string {
  return format(d, 'd MMM yyyy')
}

/** Round to 2 decimal places - every rupee amount in this file goes through this. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ItemInput {
  description: string
  hsn_code?: string | null
  quantity: number
  unit_price: number
  discount_type?: 'flat' | 'percent' | null
  discount_value?: number | null
}

interface ComputedItem {
  description: string
  hsn_code: string | null
  quantity: number
  unit_price: number
  discount_type: 'flat' | 'percent' | null
  discount_value: number
  amount: number
}

/**
 * GST-compliant computation shared by POST and PATCH: item discounts reduce
 * each line before it's summed, the overall discount reduces the subtotal
 * before tax, and GST (if not in 'none' mode) is computed on that post-
 * discount taxable value - not the previous behaviour, where GST was always
 * a flat 18% of the raw amount with no discount applied before tax at all.
 */
function computeInvoiceTotals(
  items: ItemInput[],
  opts: {
    gst_mode: 'standard' | 'none'
    gst_rate: number
    round_off: boolean
    overall_discount_type: 'flat' | 'percent' | null
    overall_discount_value: number
    status: string
  }
): {
  items: ComputedItem[]
  subtotal: number
  overallDiscountAmount: number
  taxableAmount: number
  gstAmount: number
  total: number
  balanceDue: number
} {
  const computedItems: ComputedItem[] = items.map((it) => {
    const qty  = Number(it.quantity)
    const rate = Number(it.unit_price)
    const discountType  = it.discount_type ?? null
    const discountValue = Number(it.discount_value || 0)
    const itemDiscount = discountType === 'percent'
      ? round2(qty * rate * discountValue / 100)
      : discountValue
    return {
      description:    it.description,
      hsn_code:       it.hsn_code || null,
      quantity:       qty,
      unit_price:     rate,
      discount_type:  discountType,
      discount_value: discountValue,
      amount:         round2(qty * rate - itemDiscount),
    }
  })

  const subtotal = round2(computedItems.reduce((sum, it) => sum + it.amount, 0))

  const overallDiscountAmount = opts.overall_discount_type === 'percent'
    ? round2(subtotal * opts.overall_discount_value / 100)
    : (opts.overall_discount_value || 0)

  const taxableAmount = round2(subtotal - overallDiscountAmount)
  const gstAmount = opts.gst_mode === 'none' ? 0 : round2(taxableAmount * opts.gst_rate / 100)
  const rawTotal = taxableAmount + gstAmount
  const total = opts.round_off ? Math.round(rawTotal) : round2(rawTotal)
  const balanceDue = opts.status === 'paid' ? 0 : total

  return { items: computedItems, subtotal, overallDiscountAmount, taxableAmount, gstAmount, total, balanceDue }
}

function validateItems(items: unknown): { ok: true; items: ItemInput[] } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'At least one line item is required' }
  const out: ItemInput[] = []
  for (const raw of items) {
    const it = raw as Record<string, unknown>
    const description = String(it.description || '').trim()
    if (!description) return { ok: false, error: 'Every line item needs a description' }
    const quantity = Number(it.quantity)
    if (!(quantity > 0)) return { ok: false, error: `"${description}" needs a quantity greater than 0` }
    const unit_price = Number(it.unit_price)
    if (!(unit_price >= 0)) return { ok: false, error: `"${description}" needs a non-negative unit price` }
    const discount_type = it.discount_type === 'flat' || it.discount_type === 'percent' ? it.discount_type : null
    out.push({
      description,
      hsn_code:       it.hsn_code ? String(it.hsn_code) : null,
      quantity,
      unit_price,
      discount_type,
      discount_value: discount_type ? Number(it.discount_value || 0) : 0,
    })
  }
  return { ok: true, items: out }
}

async function insertItems(client: { query: (text: string, params?: any[]) => Promise<any> }, invoiceId: string, items: ComputedItem[]) {
  let i = 0
  for (const item of items) {
    await client.query(
      `INSERT INTO sales_invoice_items
         (invoice_id, sort_order, description, hsn_code, quantity, unit_price, discount_type, discount_value, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [invoiceId, i++, item.description, item.hsn_code, item.quantity, item.unit_price, item.discount_type, item.discount_value, item.amount]
    )
  }
}

// ── GET /api/invoices ─────────────────────────────────────────────────────────

app.get('/api/invoices', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const showAll    = c.req.query('all') === 'true'
  const docType    = c.req.query('doc_type') === 'quotation' ? 'quotation' : 'invoice'

  // "Due soon / overdue" filtering only makes sense for invoices - quotations
  // don't have a due_date-driven urgency concept, so showAll is effectively
  // always true for them.
  const baseQuery = `
    SELECT si.id, si.invoice_no, si.doc_type, si.amount, si.gst_type, si.gst_mode, si.gst_rate,
           si.gst_amount, si.discount_amount, si.round_off, si.total, si.balance_due,
           si.due_date, si.valid_until, si.invoice_date, si.paid_at, si.status, si.created_at,
           si.notes, si.deal_id, si.client_id,
           sc.name       AS client_name,
           sc.org_name   AS client_org,
           sc.email      AS client_email,
           sc.phone      AS client_phone,
           co.name       AS company_name,
           co.invoice_prefix,
           co.quotation_prefix,
           sd.name       AS deal_name
    FROM sales_invoices si
    LEFT JOIN sales_clients sc ON sc.id = si.client_id
    LEFT JOIN companies co     ON co.id = si.company_id
    LEFT JOIN sales_deals sd   ON sd.id = si.deal_id
    WHERE si.company_id = ANY($1) AND si.doc_type = $2
    ${(!showAll && docType === 'invoice') ? `AND (
      si.status = 'overdue'
      OR (si.status IN ('draft','sent') AND si.due_date <= CURRENT_DATE + INTERVAL '7 days')
    )` : ''}
    ORDER BY si.due_date ASC NULLS LAST, si.created_at DESC
  `

  const result = await query(baseQuery, [companyIds, docType])
  return c.json({ invoices: result.rows })
})

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
// Full single-document fetch, including line items - what the sales page's
// edit slide-over prefills from.

app.get('/api/invoices/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT si.*, sc.name AS client_name, sc.gstin AS client_gstin, co.name AS company_name,
            co.invoice_prefix, co.quotation_prefix
     FROM sales_invoices si
     LEFT JOIN sales_clients sc ON sc.id = si.client_id
     LEFT JOIN companies co     ON co.id = si.company_id
     WHERE si.id = $1 AND si.company_id = ANY($2)`,
    [invoiceId, companyIds]
  )
  if (result.rows.length === 0) return notFound(c, 'Invoice')

  const items = await query(
    `SELECT id, sort_order, description, hsn_code, quantity, unit_price, discount_type, discount_value, amount
     FROM sales_invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
    [invoiceId]
  )

  return c.json({ invoice: result.rows[0], items: items.rows })
})

// ── POST /api/invoices ────────────────────────────────────────────────────────

app.post('/api/invoices', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string
  const body       = await c.req.json()
  const {
    company_id, client_id, deal_id,
    doc_type: rawDocType,
    invoice_date, supply_date, due_date, valid_until,
    items: rawItems,
    gst_type, gst_mode: rawGstMode, gst_rate: rawGstRate, round_off,
    overall_discount_type, overall_discount_value,
    payment_terms_label, terms_conditions, place_of_supply,
    show_company_gstin, client_gstin_override,
    po_number, notes,
  } = body

  const docType = rawDocType === 'quotation' ? 'quotation' : 'invoice'
  const gstMode = rawGstMode === 'none' ? 'none' : 'standard'
  const gstRate = rawGstRate != null ? Number(rawGstRate) : 18

  if (!company_id) return validationError(c, 'company_id is required')
  if (!client_id)  return validationError(c, 'client_id is required')
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)
  if (docType === 'invoice'    && !due_date)    return validationError(c, 'due_date is required for an invoice')
  if (docType === 'quotation'  && !valid_until) return validationError(c, 'valid_until is required for a quotation')
  if (gstMode === 'standard' && !gst_type)      return validationError(c, 'gst_type is required unless gst_mode is "none"')

  const itemsCheck = validateItems(rawItems)
  if (!itemsCheck.ok) return validationError(c, itemsCheck.error)

  const companyResult = await query(
    `SELECT invoice_prefix, quotation_prefix FROM companies WHERE id = $1`,
    [company_id]
  )
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)
  const prefix = docType === 'quotation'
    ? companyResult.rows[0].quotation_prefix as string
    : companyResult.rows[0].invoice_prefix as string

  const totals = computeInvoiceTotals(itemsCheck.items, {
    gst_mode: gstMode,
    gst_rate: gstRate,
    round_off: !!round_off,
    overall_discount_type: overall_discount_type === 'flat' || overall_discount_type === 'percent' ? overall_discount_type : null,
    overall_discount_value: Number(overall_discount_value || 0),
    status: 'draft',
  })

  try {
    const invoice = await transaction(async (client) => {
      const invoiceNo = await generateInvoiceNumber(client, company_id, prefix)
      const result = await client.query(
        `INSERT INTO sales_invoices
           (company_id, client_id, deal_id, invoice_no, doc_type,
            invoice_date, supply_date, due_date, valid_until,
            amount, gst_type, gst_mode, gst_rate, gst_amount, discount_amount, round_off,
            overall_discount_type, overall_discount_value, total, balance_due,
            payment_terms_label, terms_conditions, place_of_supply,
            show_company_gstin, client_gstin_override,
            po_number, rate, quantity, status, service_description, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                 $21, $22, $23, $24, $25, $26, $27, $28, 'draft', $29, $30)
         RETURNING *`,
        [
          company_id, client_id, deal_id || null, invoiceNo, docType,
          invoice_date || new Date().toISOString().slice(0, 10), supply_date || new Date().toISOString().slice(0, 10),
          due_date || null, valid_until || null,
          totals.taxableAmount, gstMode === 'standard' ? gst_type : null, gstMode, gstRate,
          totals.gstAmount, totals.overallDiscountAmount, !!round_off,
          overall_discount_type === 'flat' || overall_discount_type === 'percent' ? overall_discount_type : null,
          Number(overall_discount_value || 0), totals.total, totals.balanceDue,
          payment_terms_label || 'Net 14', terms_conditions || null, place_of_supply || null,
          show_company_gstin !== false, client_gstin_override || null,
          po_number || null, totals.items[0]?.unit_price ?? totals.taxableAmount, totals.items[0]?.quantity ?? 1,
          totals.items.map((i) => i.description).join('; ') || null, notes || null,
        ]
      )
      const row = result.rows[0]
      await insertItems(client, row.id, totals.items)
      return row
    })

    await writeMutationAuditLog(c, {
      table: 'sales_invoices', op: 'create', id: invoice.id, after: invoice, companyId: company_id,
    })

    return c.json({ invoice, items: totals.items }, 201)
  } catch (err) {
    // Defense in depth - the advisory lock in generateInvoiceNumber should make this
    // unreachable, but a unique-constraint hit on invoice_no is a clean 409, not a 500.
    if ((err as { code?: string })?.code === '23505') {
      return c.json({ error: 'Document number collision - please retry.' }, 409)
    }
    throw err
  }
})

// ── PATCH /api/invoices/:id ───────────────────────────────────────────────────

const FINANCIAL_FIELDS = ['items', 'gst_mode', 'gst_rate', 'round_off', 'overall_discount_type', 'overall_discount_value', 'gst_type', 'status'] as const

app.patch('/api/invoices/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()

  const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'accepted', 'rejected', 'expired']
  if (body.status && !validStatuses.includes(body.status)) return validationError(c, 'Invalid status')

  const existing = await query(`SELECT * FROM sales_invoices WHERE id = $1 AND company_id = ANY($2)`, [invoiceId, companyIds])
  if (existing.rows.length === 0) return notFound(c, 'Invoice')
  const before = existing.rows[0]

  const touchesFinancials = FINANCIAL_FIELDS.some((f) => body[f] !== undefined)

  let itemsForCompute: ItemInput[] | null = null
  if (body.items !== undefined) {
    const itemsCheck = validateItems(body.items)
    if (!itemsCheck.ok) return validationError(c, itemsCheck.error)
    itemsForCompute = itemsCheck.items
  }

  let computed: ReturnType<typeof computeInvoiceTotals> | null = null
  if (touchesFinancials) {
    if (!itemsForCompute) {
      const existingItems = await query(
        `SELECT description, hsn_code, quantity, unit_price, discount_type, discount_value FROM sales_invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
        [invoiceId]
      )
      itemsForCompute = existingItems.rows as ItemInput[]
    }
    computed = computeInvoiceTotals(itemsForCompute, {
      gst_mode: body.gst_mode === 'none' ? 'none' : (body.gst_mode === 'standard' ? 'standard' : before.gst_mode),
      gst_rate: body.gst_rate != null ? Number(body.gst_rate) : Number(before.gst_rate),
      round_off: body.round_off != null ? !!body.round_off : !!before.round_off,
      overall_discount_type: body.overall_discount_type !== undefined
        ? (body.overall_discount_type === 'flat' || body.overall_discount_type === 'percent' ? body.overall_discount_type : null)
        : before.overall_discount_type,
      overall_discount_value: body.overall_discount_value != null ? Number(body.overall_discount_value) : Number(before.overall_discount_value || 0),
      status: body.status || before.status,
    })
  }

  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  function set(col: string, val: unknown) { sets.push(`${col} = $${p++}`); params.push(val) }

  if (body.status !== undefined)               set('status', body.status)
  if (body.notes !== undefined)                 set('notes', body.notes || null)
  if (body.invoice_date !== undefined)          set('invoice_date', body.invoice_date)
  if (body.supply_date !== undefined)           set('supply_date', body.supply_date)
  if (body.due_date !== undefined)              set('due_date', body.due_date || null)
  if (body.valid_until !== undefined)           set('valid_until', body.valid_until || null)
  if (body.payment_terms_label !== undefined)   set('payment_terms_label', body.payment_terms_label || null)
  if (body.terms_conditions !== undefined)      set('terms_conditions', body.terms_conditions || null)
  if (body.place_of_supply !== undefined)       set('place_of_supply', body.place_of_supply || null)
  if (body.show_company_gstin !== undefined)    set('show_company_gstin', !!body.show_company_gstin)
  if (body.client_gstin_override !== undefined) set('client_gstin_override', body.client_gstin_override || null)
  if (body.po_number !== undefined)             set('po_number', body.po_number || null)
  if (body.gst_type !== undefined)              set('gst_type', body.gst_type || null)

  if (computed) {
    set('gst_mode', body.gst_mode === 'none' ? 'none' : (body.gst_mode === 'standard' ? 'standard' : before.gst_mode))
    set('gst_rate', body.gst_rate != null ? Number(body.gst_rate) : Number(before.gst_rate))
    set('round_off', body.round_off != null ? !!body.round_off : !!before.round_off)
    set('overall_discount_type', body.overall_discount_type !== undefined
      ? (body.overall_discount_type === 'flat' || body.overall_discount_type === 'percent' ? body.overall_discount_type : null)
      : before.overall_discount_type)
    set('overall_discount_value', body.overall_discount_value != null ? Number(body.overall_discount_value) : Number(before.overall_discount_value || 0))
    set('amount', computed.taxableAmount)
    set('discount_amount', computed.overallDiscountAmount)
    set('gst_amount', computed.gstAmount)
    set('total', computed.total)
    set('balance_due', computed.balanceDue)
  }

  if (body.status !== undefined) {
    set('paid_at', body.status === 'paid' ? new Date().toISOString() : before.paid_at)
  }

  if (sets.length === 0 && !itemsForCompute) {
    return c.json({ success: true, invoice: before })
  }

  params.push(invoiceId, companyIds)
  const result = sets.length > 0
    ? await query(
        `UPDATE sales_invoices SET ${sets.join(', ')} WHERE id = $${p++} AND company_id = ANY($${p++}) RETURNING *`,
        params
      )
    : { rows: [before] }

  if (result.rows.length === 0) return notFound(c, 'Invoice')
  const after = result.rows[0]

  if (itemsForCompute && computed) {
    await transaction(async (client) => {
      await client.query(`DELETE FROM sales_invoice_items WHERE invoice_id = $1`, [invoiceId])
      await insertItems(client, invoiceId, computed!.items)
    })
  }

  await writeMutationAuditLog(c, {
    table: 'sales_invoices', op: 'update', id: invoiceId, before, after, companyId: before.company_id,
  })

  return c.json({ success: true, invoice: after })
})

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────

app.delete('/api/invoices/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const existing = await query(`SELECT * FROM sales_invoices WHERE id = $1 AND company_id = ANY($2)`, [invoiceId, companyIds])
  if (existing.rows.length === 0) return notFound(c, 'Invoice')
  const before = existing.rows[0]

  if (before.status === 'paid') {
    return c.json({ error: 'Cannot delete a paid invoice - it is a financial record. Void it via status change if it was recorded in error.' }, 409)
  }

  await query(`DELETE FROM sales_invoices WHERE id = $1`, [invoiceId])

  await writeMutationAuditLog(c, {
    table: 'sales_invoices', op: 'delete', id: invoiceId, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── POST /api/invoices/:id/convert-to-invoice ─────────────────────────────────
// Quotation → invoice: copies company/client/items/GST settings into a new
// invoice-doc-type row with its own invoice_no, leaving the source quotation
// untouched (its own status is managed separately, e.g. marking it accepted).

app.post('/api/invoices/:id/convert-to-invoice', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const quotationId = c.req.param('id')
  const companyIds  = c.get('companyIds') as string[]
  const body        = await c.req.json().catch(() => ({}))

  const quoResult = await query(`SELECT * FROM sales_invoices WHERE id = $1 AND company_id = ANY($2) AND doc_type = 'quotation'`, [quotationId, companyIds])
  if (quoResult.rows.length === 0) return notFound(c, 'Quotation')
  const quo = quoResult.rows[0]

  const itemsResult = await query(
    `SELECT description, hsn_code, quantity, unit_price, discount_type, discount_value, sort_order
     FROM sales_invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
    [quotationId]
  )

  const companyResult = await query(`SELECT invoice_prefix FROM companies WHERE id = $1`, [quo.company_id])
  const prefix = companyResult.rows[0].invoice_prefix as string

  const dueDate = body.due_date || (() => {
    const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10)
  })()

  const invoice = await transaction(async (client) => {
    const invoiceNo = await generateInvoiceNumber(client, quo.company_id, prefix)
    const result = await client.query(
      `INSERT INTO sales_invoices
         (company_id, client_id, deal_id, invoice_no, doc_type, source_quotation_id,
          invoice_date, supply_date, due_date,
          amount, gst_type, gst_mode, gst_rate, gst_amount, discount_amount, round_off,
          overall_discount_type, overall_discount_value, total, balance_due,
          payment_terms_label, terms_conditions, place_of_supply,
          show_company_gstin, client_gstin_override, po_number, status)
       VALUES ($1, $2, $3, $4, 'invoice', $5, CURRENT_DATE, CURRENT_DATE, $6,
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18, $19, $20, $21, $22, $23, 'draft')
       RETURNING *`,
      [
        quo.company_id, quo.client_id, quo.deal_id, invoiceNo, quotationId, dueDate,
        quo.amount, quo.gst_type, quo.gst_mode, quo.gst_rate, quo.gst_amount, quo.discount_amount, quo.round_off,
        quo.overall_discount_type, quo.overall_discount_value, quo.total, quo.total,
        quo.payment_terms_label, quo.terms_conditions, quo.place_of_supply,
        quo.show_company_gstin, quo.client_gstin_override, quo.po_number,
      ]
    )
    const row = result.rows[0]
    for (const item of itemsResult.rows) {
      await client.query(
        `INSERT INTO sales_invoice_items (invoice_id, sort_order, description, hsn_code, quantity, unit_price, discount_type, discount_value, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.id, item.sort_order, item.description, item.hsn_code, item.quantity, item.unit_price, item.discount_type, item.discount_value,
         round2(Number(item.quantity) * Number(item.unit_price) - (item.discount_type === 'percent' ? round2(Number(item.quantity) * Number(item.unit_price) * Number(item.discount_value) / 100) : Number(item.discount_value || 0)))]
      )
    }
    return row
  })

  await writeMutationAuditLog(c, {
    table: 'sales_invoices', op: 'create', id: invoice.id, after: invoice, companyId: quo.company_id,
  })

  return c.json({ invoice }, 201)
})

// ── GET /api/invoices/:id/pdf ─────────────────────────────────────────────────

app.get('/api/invoices/:id/pdf', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]

  const check = await query(
    `SELECT invoice_no FROM sales_invoices WHERE id = $1 AND company_id = ANY($2)`,
    [invoiceId, companyIds]
  )
  if (check.rows.length === 0) return c.json({ error: 'Invoice not found' }, 404)

  const invoiceNo = check.rows[0].invoice_no as string

  let pdf: Buffer
  try {
    pdf = await buildInvoicePdf(invoiceId)
  } catch (err) {
    console.error('PDF generation failed:', err)
    return c.json({ error: 'PDF generation failed' }, 500)
  }

  // Data export — a financial record leaving the platform is auditable.
  await writeAuditLogForRequest(c, {
    action:       AUDIT_ACTIONS.exportInvoicePdf,
    resourceType: 'sales_invoices',
    resourceId:   invoiceId,
    after:        { invoice_no: invoiceNo, bytes: pdf.length },
  })

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNo}.pdf"`,
      'Content-Length':      String(pdf.length),
    },
  })
})

// ── POST /api/invoices/:id/remind ─────────────────────────────────────────────

app.post('/api/invoices/:id/remind', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id') as string
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string

  const result = await query(
    `SELECT si.id, si.invoice_no, si.total, si.due_date, si.status, si.company_id,
            sc.name     AS client_name,
            sc.phone    AS client_phone,
            co.name     AS company_name
     FROM sales_invoices si
     LEFT JOIN sales_clients sc ON sc.id = si.client_id
     LEFT JOIN companies co     ON co.id = si.company_id
     WHERE si.id = $1 AND si.company_id = ANY($2)`,
    [invoiceId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Invoice not found' }, 404)

  const inv = result.rows[0]
  if (!inv.client_phone) return c.json({ error: 'Client has no phone number on record' }, 400)

  const dueFormatted = inv.due_date ? formatDate(new Date(inv.due_date as string)) : 'N/A'
  const message = `Dear ${inv.client_name}, this is a reminder that invoice ${inv.invoice_no} for ₹${parseFloat(String(inv.total)).toLocaleString('en-IN', { minimumFractionDigits: 2 })} from ${inv.company_name} was due on ${dueFormatted}. Please arrange payment at your earliest convenience. Thank you.`

  try {
    await sendViaOpenClaw({
      channel: 'whatsapp',
      to:      inv.client_phone as string,
      message,
    })

    await query(
      `INSERT INTO notifications_sent (user_id, channel, message)
       VALUES ($1, 'whatsapp', $2)`,
      [userId, message]
    )

    await query(
      `UPDATE sales_invoices
       SET machine_data = machine_data || jsonb_build_object(
         'reminder_count', COALESCE((machine_data->>'reminder_count')::int, 0) + 1,
         'last_reminder_at', NOW()::TEXT
       )
       WHERE id = $1 AND company_id = ANY($2)`,
      [invoiceId, companyIds]
    )

    await writeMutationAuditLog(c, {
      table: 'sales_invoices', op: 'update', id: invoiceId,
      after: { reminder_sent: true, invoice_no: inv.invoice_no },
      companyId: inv.company_id,
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Reminder send failed:', err)
    return c.json({ error: 'Failed to send reminder - OpenClaw unreachable' }, 502)
  }
})

export default app
