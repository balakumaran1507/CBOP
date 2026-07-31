import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query, transaction } from '../lib/db'
import { sendViaOpenClaw } from '../lib/openclaw'
import { buildInvoicePdf } from '../lib/pdf-generator'
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
  // plain race with no locking.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice_seq:${companyId}:${year}`])
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

// ── GET /api/invoices ─────────────────────────────────────────────────────────

app.get('/api/invoices', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const showAll    = c.req.query('all') === 'true'

  const baseQuery = `
    SELECT si.id, si.invoice_no, si.amount, si.gst_type, si.gst_amount, si.total,
           si.due_date, si.paid_at, si.status, si.created_at,
           si.service_description, si.notes, si.deal_id, si.client_id,
           sc.name       AS client_name,
           sc.org_name   AS client_org,
           sc.email      AS client_email,
           sc.phone      AS client_phone,
           co.name       AS company_name,
           co.invoice_prefix,
           sd.name       AS deal_name
    FROM sales_invoices si
    LEFT JOIN sales_clients sc ON sc.id = si.client_id
    LEFT JOIN companies co     ON co.id = si.company_id
    LEFT JOIN sales_deals sd   ON sd.id = si.deal_id
    WHERE si.company_id = ANY($1)
    ${showAll ? '' : `AND (
      si.status = 'overdue'
      OR (si.status IN ('draft','sent') AND si.due_date <= CURRENT_DATE + INTERVAL '7 days')
    )`}
    ORDER BY si.due_date ASC NULLS LAST, si.created_at DESC
  `

  const result = await query(baseQuery, [companyIds])
  return c.json({ invoices: result.rows })
})

// ── POST /api/invoices ────────────────────────────────────────────────────────

app.post('/api/invoices', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { company_id, client_id, deal_id, amount, gst_type, due_date, service_description, notes } = body

  if (!company_id)        return c.json({ error: 'company_id is required' }, 400)
  if (!client_id)         return c.json({ error: 'client_id is required' }, 400)
  if (!amount)            return c.json({ error: 'amount is required' }, 400)
  if (!gst_type)          return c.json({ error: 'gst_type is required' }, 400)
  if (!due_date)          return c.json({ error: 'due_date is required' }, 400)

  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden: company not in scope' }, 403)

  const amt = parseFloat(String(amount))
  if (isNaN(amt) || amt <= 0) return c.json({ error: 'amount must be a positive number' }, 400)

  const gstAmount = Math.round(amt * 0.18 * 100) / 100
  const total     = Math.round((amt + gstAmount) * 100) / 100

  const companyResult = await query(
    `SELECT invoice_prefix FROM companies WHERE id = $1`,
    [company_id]
  )
  if (companyResult.rows.length === 0) return c.json({ error: 'Company not found' }, 404)

  const prefix = companyResult.rows[0].invoice_prefix as string

  try {
    const invoice = await transaction(async (client) => {
      const invoiceNo = await generateInvoiceNumber(client, company_id, prefix)
      const result = await client.query(
        `INSERT INTO sales_invoices
           (company_id, client_id, deal_id, invoice_no, amount, gst_type, gst_amount, total,
            due_date, supply_date, rate, status, service_description, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, $5, 'draft', $10, $11)
         RETURNING id, invoice_no, amount, gst_type, gst_amount, total, due_date, status, created_at`,
        [company_id, client_id, deal_id || null, invoiceNo, amt, gst_type, gstAmount, total, due_date, service_description || null, notes || null]
      )
      return result.rows[0]
    })
    return c.json({ invoice }, 201)
  } catch (err) {
    // Defense in depth - the advisory lock in generateInvoiceNumber should make this
    // unreachable, but a unique-constraint hit on invoice_no is a clean 409, not a 500.
    if ((err as { code?: string })?.code === '23505') {
      return c.json({ error: 'Invoice number collision - please retry.' }, 409)
    }
    throw err
  }
})

// ── PATCH /api/invoices/:id ───────────────────────────────────────────────────

app.patch('/api/invoices/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const invoiceId  = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { status, service_description, notes } = body

  const validStatuses = ['draft', 'sent', 'paid', 'overdue']
  if (status && !validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  const result = await query(
    `UPDATE sales_invoices
     SET status               = COALESCE($1, status),
         service_description  = COALESCE($2, service_description),
         notes                = COALESCE($3, notes),
         paid_at              = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
         machine_data         = CASE
                                  WHEN $1 IS NOT NULL
                                  THEN machine_data || jsonb_build_object(
                                    'status', $1::TEXT,
                                    'paid_at', CASE WHEN $1 = 'paid' THEN NOW()::TEXT ELSE null END
                                  )
                                  ELSE machine_data
                                END
     WHERE id = $4 AND company_id = ANY($5)
     RETURNING id, status`,
    [status || null, service_description || null, notes || null, invoiceId, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Invoice not found' }, 404)
  return c.json({ success: true, status: result.rows[0].status })
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
  const invoiceId  = c.req.param('id')
  const companyIds = c.get('companyIds') as string[]
  const userId     = c.get('userId') as string

  const result = await query(
    `SELECT si.id, si.invoice_no, si.total, si.due_date, si.status,
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

    return c.json({ success: true })
  } catch (err) {
    console.error('Reminder send failed:', err)
    return c.json({ error: 'Failed to send reminder - OpenClaw unreachable' }, 502)
  }
})

export default app
