import puppeteer from 'puppeteer'
import QRCode from 'qrcode'
import { query } from './db'

// ── Amount in words (Indian numbering system) ─────────────────────────────────

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)]
  const o = ONES[n % 10]
  return o ? `${t} ${o}` : t
}

function belowThousand(n: number): string {
  if (n === 0) return ''
  if (n < 100) return belowHundred(n)
  const h = ONES[Math.floor(n / 100)]
  const r = n % 100
  return r ? `${h} Hundred ${belowHundred(r)}` : `${h} Hundred`
}

function numberToIndianWords(n: number): string {
  if (n === 0) return 'Zero'
  const crore    = Math.floor(n / 10000000)
  const lakh     = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const remainder = n % 1000

  let result = ''
  if (crore)    result += belowThousand(crore) + ' Crore '
  if (lakh)     result += belowHundred(lakh) + ' Lakh '
  if (thousand) result += belowThousand(thousand) + ' Thousand '
  if (remainder) result += belowThousand(remainder)

  return result.trim()
}

function amountInWords(amount: number): string {
  const rupees = Math.floor(amount)
  const paise  = Math.round((amount - rupees) * 100)
  let result = 'Rupees ' + numberToIndianWords(rupees)
  if (paise > 0) result += ` and ${paise}/100`
  return result + ' Only'
}

// ── HTML escape ───────────────────────────────────────────────────────────────

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildInvoicePdf(invoiceId: string): Promise<Buffer> {
  const result = await query(`
    SELECT
      i.id,
      i.invoice_no,
      i.created_at::DATE AS invoice_date,
      i.supply_date,
      i.due_date,
      i.paid_at,
      i.status,
      i.amount,
      i.rate,
      i.quantity,
      i.gst_type,
      i.gst_amount,
      i.total,
      i.service_description,
      i.notes,
      i.hsn_code,
      i.reverse_charge,
      i.e_way_bill_no,
      i.machine_data,
      i.po_number,
      i.discount_amount,
      i.balance_due,

      c.name          AS company_name,
      c.gstin         AS company_gstin,
      c.pan_number    AS company_pan,
      c.upi_id        AS company_upi,
      c.bank_details  AS bank_details,
      c.logo_url      AS company_logo,
      c.invoice_terms AS invoice_terms,
      c.address       AS company_address,
      c.company_seal  AS company_seal,
      COALESCE(c.invoice_theme, '{"primary":"#2B6EF5","accent":"#1A56DB","onPrimary":"#FFFFFF"}') AS theme,

      cl.name       AS client_name,
      cl.org_name   AS client_org,
      cl.address    AS client_address,
      cl.gstin      AS client_gstin,
      cl.email      AS client_email,
      cl.phone      AS client_phone

    FROM sales_invoices i
    JOIN companies c ON c.id = i.company_id
    JOIN sales_clients cl ON cl.id = i.client_id
    WHERE i.id = $1
  `, [invoiceId])

  const inv = result.rows[0]
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`)

  const theme = typeof inv.theme === 'string' ? JSON.parse(inv.theme) : inv.theme
  const bank  = typeof inv.bank_details === 'string' ? JSON.parse(inv.bank_details) : inv.bank_details

  // -- Computed values
  const taxableAmount = parseFloat(String(inv.amount))
  const gstAmount     = parseFloat(String(inv.gst_amount))
  const total         = parseFloat(String(inv.total))
  const rounding      = parseFloat((total - (taxableAmount + gstAmount)).toFixed(2))
  const isCGST        = inv.gst_type === 'cgst_sgst'
  const cgst          = isCGST ? gstAmount / 2 : 0
  const sgst          = isCGST ? gstAmount / 2 : 0
  const igst          = !isCGST ? gstAmount : 0
  const rate          = parseFloat(String(inv.rate || inv.amount))
  const qty           = parseFloat(String(inv.quantity || 1))
  const isPaid        = inv.status === 'paid'
  const isOverdue     = inv.status === 'overdue'
  const discount      = parseFloat(String(inv.discount_amount || 0))
  const balanceDue    = parseFloat(String(inv.balance_due || total))

  const fmt     = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const placeOfSupply = 'Tamil Nadu (33)'

  // Logo: convert local path to base64 data URL
  let logoBase64 = ''
  if (inv.company_logo) {
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(inv.company_logo)
      const ext = (inv.company_logo as string).split('.').pop()?.toLowerCase() || 'png'
      logoBase64 = `data:image/${ext};base64,${buf.toString('base64')}`
    } catch { logoBase64 = '' }
  }

  let sealBase64 = ''
  if (inv.company_seal) {
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(inv.company_seal)
      const ext = (inv.company_seal as string).split('.').pop()?.toLowerCase() || 'png'
      sealBase64 = `data:image/${ext};base64,${buf.toString('base64')}`
    } catch { sealBase64 = '' }
  }

  const initials = (inv.company_name as string)
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  // QR codes
  let upiQR = ''
  if (inv.company_upi) {
    const upiString = `upi://pay?pa=${inv.company_upi}&pn=${encodeURIComponent(inv.company_name)}&am=${total}&cu=INR&tn=${inv.invoice_no}`
    upiQR = await QRCode.toDataURL(upiString, { width: 100, margin: 1 })
  }
  const agentData = JSON.stringify({ inv: inv.invoice_no, amt: total, due: inv.due_date, status: inv.status, gstin: inv.company_gstin })
  const agentQR   = await QRCode.toDataURL(agentData, { width: 64, margin: 1, color: { dark: theme.primary, light: '#FFFFFF' } })

  const terms = (inv.invoice_terms as string | null) ||
    `1. Payment due within 14 days of invoice date.\n2. Late payments subject to 1.5% monthly interest.\n3. Disputes subject to Chennai jurisdiction.\n4. This is a system-generated tax invoice.`

  // -- HTML template (inline CSS only — Puppeteer does not load external stylesheets)
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page {
    size: A4;
    margin: 0;
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-family: 'Inter', sans-serif;
      font-size: 7pt;
      color: #AAAAAA;
    }
  }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 9.5pt;
    color: #2D2D2D;
    background: #FFFFFF;
    padding: 36px 40px 48px 40px;
  }

  /* ── HEADER ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
    page-break-inside: avoid;
  }

  .company-block {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .logo-circle {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: ${theme.primary};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .logo-circle img {
    width: 36px;
    height: 36px;
    object-fit: contain;
    border-radius: 50%;
  }

  .logo-circle .initials {
    color: #FFFFFF;
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .company-info .company-name {
    font-size: 13pt;
    font-weight: 700;
    color: #1A1A1A;
    line-height: 1.2;
  }

  .company-info .company-detail {
    font-size: 8pt;
    color: #777777;
    margin-top: 3px;
    line-height: 1.6;
  }

  .invoice-title-block {
    text-align: right;
  }

  .invoice-title-block .invoice-word {
    font-size: 22pt;
    font-weight: 700;
    color: #1A1A1A;
    letter-spacing: 0.06em;
    line-height: 1;
  }

  .invoice-title-block .invoice-number {
    font-size: 9pt;
    color: #777777;
    margin-top: 4px;
  }

  .invoice-title-block .balance-due-label {
    font-size: 8pt;
    color: #777777;
    margin-top: 10px;
  }

  .invoice-title-block .balance-due-amount {
    font-size: 18pt;
    font-weight: 700;
    color: #1A1A1A;
    margin-top: 2px;
  }

  /* ── DIVIDER ── */
  .divider {
    border: none;
    border-top: 1.5px solid #E8E8E8;
    margin: 0 0 24px 0;
  }

  /* ── BILL TO + INVOICE DETAILS ── */
  .meta-section {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
    page-break-inside: avoid;
  }

  .bill-to-block {
    flex: 1;
  }

  .block-label {
    font-size: 7.5pt;
    font-weight: 600;
    color: #AAAAAA;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
  }

  .bill-to-name {
    font-size: 11pt;
    font-weight: 700;
    color: #1A1A1A;
    margin-bottom: 3px;
  }

  .bill-to-detail {
    font-size: 8.5pt;
    color: #555555;
    line-height: 1.65;
  }

  .bill-to-gstin {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 600;
    color: #444444;
    background: #F5F5F5;
    padding: 2px 8px;
    margin-top: 5px;
  }

  .invoice-details-block {
    width: 220px;
    flex-shrink: 0;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    font-size: 8.5pt;
  }

  .detail-label {
    color: #999999;
    font-weight: 400;
  }

  .detail-value {
    color: #2D2D2D;
    font-weight: 500;
    text-align: right;
  }

  /* ── PLACE OF SUPPLY ── */
  .place-of-supply {
    font-size: 8.5pt;
    color: #555555;
    margin-bottom: 20px;
  }

  /* ── COMPLIANCE STRIP ── */
  .compliance-strip {
    display: flex;
    gap: 20px;
    background: #F8F8F8;
    padding: 6px 12px;
    margin-bottom: 20px;
    font-size: 7.5pt;
    color: #777777;
  }

  .compliance-strip span strong {
    color: #2D2D2D;
    font-weight: 600;
  }

  /* ── ITEMS TABLE ── */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
  }

  table.items thead {
    display: table-header-group;
  }

  table.items thead th {
    background: ${theme.primary};
    color: #FFFFFF;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 9px 12px;
    text-align: right;
    border: none;
  }

  table.items thead th:first-child,
  table.items thead th:nth-child(2) {
    text-align: left;
  }

  table.items tbody tr {
    page-break-inside: avoid;
    border-bottom: 1px solid #F0F0F0;
  }

  table.items tbody tr:last-child {
    border-bottom: 1.5px solid #E8E8E8;
  }

  table.items tbody td {
    padding: 11px 12px;
    vertical-align: top;
    font-size: 9pt;
  }

  table.items tbody td.item-num {
    color: #AAAAAA;
    font-size: 8.5pt;
    text-align: center;
    width: 28px;
  }

  table.items tbody td.item-desc {
    min-width: 200px;
  }

  table.items tbody td.item-desc .item-title {
    font-weight: 600;
    color: #1A1A1A;
  }

  table.items tbody td.item-desc .item-sub {
    font-size: 8pt;
    color: #888888;
    margin-top: 2px;
    font-style: italic;
  }

  table.items tbody td.item-num-right {
    text-align: right;
    font-size: 9pt;
    color: #2D2D2D;
  }

  table.items tbody td.item-amount {
    text-align: right;
    font-weight: 600;
    color: #1A1A1A;
    font-size: 9pt;
  }

  table.items tbody td.tax-cell {
    text-align: right;
    font-size: 8.5pt;
    color: #666666;
  }

  /* ── TOTALS ── */
  .totals-section {
    display: flex;
    justify-content: flex-end;
    margin-top: 0;
    page-break-inside: avoid;
  }

  .totals-block {
    width: 260px;
    margin-top: 4px;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 12px;
    font-size: 9pt;
  }

  .total-row .t-label {
    color: #777777;
  }

  .total-row .t-value {
    font-weight: 500;
    color: #2D2D2D;
  }

  .total-row.discount .t-label,
  .total-row.discount .t-value {
    color: #E05C2A;
  }

  .total-row.grand-total {
    background: #1A1A1A;
    margin-top: 4px;
  }

  .total-row.grand-total .t-label {
    color: #FFFFFF;
    font-weight: 700;
    font-size: 10pt;
  }

  .total-row.grand-total .t-value {
    color: #FFFFFF;
    font-weight: 700;
    font-size: 11pt;
  }

  .total-row.balance-due-row {
    background: #F5F5F5;
    margin-top: 2px;
  }

  .total-row.balance-due-row .t-label {
    color: #1A1A1A;
    font-weight: 700;
  }

  .total-row.balance-due-row .t-value {
    color: #1A1A1A;
    font-weight: 700;
  }

  /* ── WORDS + PAYMENT ── */
  .bottom-section {
    margin-top: 24px;
    page-break-inside: avoid;
  }

  .words-row {
    font-size: 8.5pt;
    color: #555555;
    margin-bottom: 20px;
    padding: 8px 12px;
    background: #F8F8F8;
    border-left: 3px solid ${theme.primary};
  }

  .words-row strong {
    color: #1A1A1A;
    display: block;
    margin-bottom: 2px;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #AAAAAA;
    font-weight: 600;
  }

  .payment-row {
    display: flex;
    gap: 24px;
    margin-bottom: 20px;
    align-items: flex-start;
  }

  .payment-details {
    flex: 1;
  }

  .payment-details .block-label {
    margin-bottom: 6px;
  }

  .payment-line {
    font-size: 8.5pt;
    color: #555555;
    line-height: 1.8;
  }

  .payment-line strong {
    color: #1A1A1A;
    font-weight: 600;
  }

  .qr-group {
    display: flex;
    gap: 16px;
    align-items: flex-end;
  }

  .qr-item {
    text-align: center;
  }

  .qr-item img {
    display: block;
    border: 1px solid #EEEEEE;
  }

  .qr-caption {
    font-size: 6.5pt;
    color: #AAAAAA;
    text-align: center;
    margin-top: 3px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── NOTES + TERMS + SIGNATURE ── */
  .footer-row {
    display: flex;
    gap: 24px;
    margin-top: 4px;
    page-break-inside: avoid;
  }

  .notes-block {
    flex: 1;
  }

  .notes-text {
    font-size: 8.5pt;
    color: #555555;
    line-height: 1.65;
    margin-top: 4px;
  }

  .terms-block {
    flex: 1;
  }

  .terms-text {
    font-size: 8pt;
    color: #777777;
    line-height: 1.7;
    margin-top: 4px;
    white-space: pre-line;
  }

  .signature-block {
    width: 180px;
    flex-shrink: 0;
    text-align: center;
  }

  .signature-space {
    height: 56px;
    margin-bottom: 6px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .signature-space img {
    max-height: 52px;
    max-width: 120px;
    object-fit: contain;
    opacity: 0.82;
  }

  .signature-line {
    border-bottom: 1.5px solid #2D2D2D;
    margin-bottom: 5px;
  }

  .signature-label {
    font-size: 7.5pt;
    color: #777777;
    text-align: center;
  }

  .for-company {
    font-size: 7.5pt;
    color: #AAAAAA;
    margin-bottom: 8px;
  }

  /* ── AUDIT FOOTER ── */
  .audit-footer {
    margin-top: 20px;
    padding-top: 8px;
    border-top: 1px solid #F0F0F0;
    display: flex;
    justify-content: space-between;
    font-size: 6.5pt;
    color: #CCCCCC;
  }

  /* ── PAID WATERMARK ── */
  ${isPaid ? `
  .paid-stamp {
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-28deg);
    font-size: 64pt;
    font-weight: 900;
    color: rgba(29, 129, 2, 0.08);
    letter-spacing: 0.12em;
    pointer-events: none;
    white-space: nowrap;
  }` : ''}
</style>
</head>
<body>

${isPaid ? '<div class="paid-stamp">PAID</div>' : ''}

<!-- ═══ HEADER ═══ -->
<div class="header">
  <div class="company-block">
    <div class="logo-circle">
      ${logoBase64
        ? `<img src="${logoBase64}" alt="logo" />`
        : `<span class="initials">${initials}</span>`
      }
    </div>
    <div class="company-info">
      <div class="company-name">${inv.company_name}</div>
      ${inv.company_address ? `<div class="company-detail">${inv.company_address}</div>` : ''}
      <div class="company-detail">
        ${inv.company_gstin ? `GSTIN: ${inv.company_gstin}` : ''}
        ${inv.company_pan ? ` &nbsp;·&nbsp; PAN: ${inv.company_pan}` : ''}
      </div>
    </div>
  </div>
  <div class="invoice-title-block">
    <div class="invoice-word">TAX INVOICE</div>
    <div class="invoice-number"># ${inv.invoice_no}</div>
    <div class="balance-due-label">Balance Due</div>
    <div class="balance-due-amount">${fmt(balanceDue)}</div>
  </div>
</div>

<hr class="divider" />

<!-- ═══ BILL TO + INVOICE DETAILS ═══ -->
<div class="meta-section">
  <div class="bill-to-block">
    <div class="block-label">Bill To</div>
    <div class="bill-to-name">${inv.client_name}</div>
    ${inv.client_org ? `<div class="bill-to-detail">${inv.client_org}</div>` : ''}
    ${inv.client_address ? `<div class="bill-to-detail">${inv.client_address}</div>` : ''}
    ${inv.client_email ? `<div class="bill-to-detail">${inv.client_email}</div>` : ''}
    ${inv.client_phone ? `<div class="bill-to-detail">${inv.client_phone}</div>` : ''}
    ${inv.client_gstin ? `<div class="bill-to-gstin">GSTIN: ${inv.client_gstin}</div>` : ''}
  </div>
  <div class="invoice-details-block">
    <div class="detail-row">
      <span class="detail-label">Invoice Date</span>
      <span class="detail-value">${fmtDate(inv.invoice_date)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Supply Date</span>
      <span class="detail-value">${fmtDate(inv.supply_date)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Terms</span>
      <span class="detail-value">Net 14</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Due Date</span>
      <span class="detail-value">${fmtDate(inv.due_date)}</span>
    </div>
    ${inv.po_number ? `
    <div class="detail-row">
      <span class="detail-label">P.O. #</span>
      <span class="detail-value">${inv.po_number}</span>
    </div>` : ''}
  </div>
</div>

<!-- ═══ PLACE OF SUPPLY + COMPLIANCE ═══ -->
<div class="place-of-supply">Place of Supply: <strong>Tamil Nadu (33)</strong></div>

<div class="compliance-strip">
  <span>GST Type: <strong>${isCGST ? 'CGST + SGST' : 'IGST'}</strong></span>
  <span>Reverse Charge: <strong>${inv.reverse_charge ? 'Yes' : 'No'}</strong></span>
  ${inv.e_way_bill_no ? `<span>E-Way Bill: <strong>${inv.e_way_bill_no}</strong></span>` : ''}
</div>

<!-- ═══ LINE ITEMS ═══ -->
<table class="items">
  <thead>
    <tr>
      <th style="text-align:center;width:32px">#</th>
      <th style="text-align:left;">Item &amp; Description</th>
      <th style="width:60px">HSN/SAC</th>
      <th style="width:50px">Qty</th>
      <th style="width:80px">Rate</th>
      ${isCGST ? `
      <th style="width:70px">CGST</th>
      <th style="width:70px">SGST</th>
      ` : `
      <th style="width:70px">IGST</th>
      `}
      ${discount > 0 ? `<th style="width:70px">Discount</th>` : ''}
      <th style="width:90px">Amount</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="item-num">1</td>
      <td class="item-desc">
        <div class="item-title">${inv.service_description || 'Professional Services'}</div>
      </td>
      <td class="item-num-right" style="text-align:center;color:#888888;font-size:8pt;">${inv.hsn_code || '998314'}</td>
      <td class="item-num-right">${qty.toFixed(2)}</td>
      <td class="item-num-right">${fmt(rate)}</td>
      ${isCGST ? `
      <td class="tax-cell">9%<br/><span style="font-weight:600;color:#2D2D2D;">${fmt(cgst)}</span></td>
      <td class="tax-cell">9%<br/><span style="font-weight:600;color:#2D2D2D;">${fmt(sgst)}</span></td>
      ` : `
      <td class="tax-cell">18%<br/><span style="font-weight:600;color:#2D2D2D;">${fmt(igst)}</span></td>
      `}
      ${discount > 0 ? `<td class="tax-cell" style="color:#E05C2A;">0.00</td>` : ''}
      <td class="item-amount">${fmt(taxableAmount)}</td>
    </tr>
  </tbody>
</table>

<!-- ═══ TOTALS ═══ -->
<div class="totals-section">
  <div class="totals-block">
    <div class="total-row">
      <span class="t-label">Sub Total</span>
      <span class="t-value">${fmt(taxableAmount)}</span>
    </div>
    ${isCGST ? `
    <div class="total-row">
      <span class="t-label">CGST (9%)</span>
      <span class="t-value">${fmt(cgst)}</span>
    </div>
    <div class="total-row">
      <span class="t-label">SGST (9%)</span>
      <span class="t-value">${fmt(sgst)}</span>
    </div>
    ` : `
    <div class="total-row">
      <span class="t-label">IGST (18%)</span>
      <span class="t-value">${fmt(igst)}</span>
    </div>
    `}
    ${discount > 0 ? `
    <div class="total-row discount">
      <span class="t-label">Discount</span>
      <span class="t-value">(-) ${fmt(discount)}</span>
    </div>` : ''}
    ${Math.abs(rounding) > 0.001 ? `
    <div class="total-row">
      <span class="t-label">Rounding</span>
      <span class="t-value">${rounding > 0 ? '+' : ''}${fmt(rounding)}</span>
    </div>` : ''}
    <div class="total-row grand-total">
      <span class="t-label">Total</span>
      <span class="t-value">${fmt(total)}</span>
    </div>
    <div class="total-row balance-due-row">
      <span class="t-label">Balance Due</span>
      <span class="t-value">${fmt(balanceDue)}</span>
    </div>
  </div>
</div>

<!-- ═══ BOTTOM SECTION ═══ -->
<div class="bottom-section">

  <!-- Amount in words -->
  <div class="words-row">
    <strong>Amount in Words</strong>
    ${amountInWords(total)}
  </div>

  <!-- Payment + QR -->
  <div class="payment-row">
    <div class="payment-details">
      <div class="block-label">Payment Options</div>
      ${bank ? `
      <div class="payment-line">Bank: <strong>${bank.bank_name}</strong></div>
      <div class="payment-line">A/C Name: <strong>${bank.account_name}</strong></div>
      <div class="payment-line">A/C No: <strong>${bank.account_no}</strong> &nbsp;|&nbsp; IFSC: <strong>${bank.ifsc_code}</strong></div>
      ` : ''}
      ${inv.company_upi ? `<div class="payment-line">UPI: <strong>${inv.company_upi}</strong></div>` : ''}
      <div class="payment-line" style="margin-top:4px;color:#AAAAAA;font-size:7.5pt;">
        Payment due within 14 days of invoice date.
      </div>
    </div>
    <div class="qr-group">
      ${inv.company_upi ? `
      <div class="qr-item">
        <img src="${upiQR}" width="88" height="88" />
        <div class="qr-caption">Scan to Pay</div>
      </div>` : ''}
      <div class="qr-item">
        <img src="${agentQR}" width="56" height="56" />
        <div class="qr-caption">Invoice Data</div>
      </div>
    </div>
  </div>

  <hr class="divider" />

  <!-- Notes + Terms + Signature -->
  <div class="footer-row">
    ${inv.notes ? `
    <div class="notes-block">
      <div class="block-label">Notes</div>
      <div class="notes-text">${inv.notes}</div>
    </div>` : '<div class="notes-block"></div>'}

    <div class="terms-block">
      <div class="block-label">Terms &amp; Conditions</div>
      <div class="terms-text">${terms}</div>
    </div>

    <div class="signature-block">
      <div class="for-company">For ${inv.company_name}</div>
      <div class="signature-space">
        ${sealBase64 ? `<img src="${sealBase64}" alt="seal" />` : ''}
      </div>
      <div class="signature-line"></div>
      <div class="signature-label">Authorized Signatory</div>
    </div>
  </div>

</div>

<!-- ═══ AUDIT FOOTER ═══ -->
<div class="audit-footer">
  <span>Generated: ${new Date().toISOString()} · CBOP v2</span>
  <span>${inv.invoice_no} · ${inv.company_gstin || 'GSTIN Applied For'}</span>
</div>

</body>
</html>`

  // -- Puppeteer render
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  await page.emulateMediaType('print')
  const buffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '14mm', bottom: '18mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: false,
  })
  await browser.close()
  return Buffer.from(buffer)
}
