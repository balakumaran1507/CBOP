import puppeteer from 'puppeteer'
import QRCode from 'qrcode'
import path from 'path'
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

/**
 * Escapes an address for display and makes it read as multiple lines: a
 * stored newline is respected (white-space: pre-line on the containing
 * element handles that), and a single-line address with no newline is
 * soft-wrapped on ", " so long addresses don't run into an unreadable blob.
 */
function formatAddressHtml(addr: string | null | undefined): string {
  if (!addr) return ''
  const escaped = esc(addr)
  if (escaped.includes('\n')) return escaped
  return escaped.split(/,\s*/).join(',<br/>')
}

// ── Main export ───────────────────────────────────────────────────────────────

interface InvoiceItemRow {
  description: string
  hsn_code: string | null
  quantity: string | number
  unit_price: string | number
  discount_type: 'flat' | 'percent' | null
  discount_value: string | number
  amount: string | number
}

export async function buildInvoicePdf(invoiceId: string): Promise<Buffer> {
  const result = await query(`
    SELECT
      i.id,
      i.invoice_no,
      i.doc_type,
      i.invoice_date,
      i.supply_date,
      i.due_date,
      i.valid_until,
      i.paid_at,
      i.status,
      i.amount,
      i.gst_type,
      i.gst_mode,
      i.gst_rate,
      i.gst_amount,
      i.total,
      i.hsn_code,
      i.reverse_charge,
      i.e_way_bill_no,
      i.po_number,
      i.discount_amount,
      i.round_off,
      i.balance_due,
      i.payment_terms_label,
      i.terms_conditions,
      i.place_of_supply,
      i.show_company_gstin,
      i.client_gstin_override,

      c.name            AS company_name,
      c.gstin           AS company_gstin,
      c.pan_number      AS company_pan,
      c.upi_id          AS company_upi,
      c.bank_details    AS bank_details,
      c.logo_url        AS company_logo,
      c.invoice_terms   AS company_invoice_terms,
      c.address         AS company_address,
      c.company_seal    AS company_seal,
      c.logo_initials   AS logo_initials,
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

  const itemsResult = await query<InvoiceItemRow>(
    `SELECT description, hsn_code, quantity, unit_price, discount_type, discount_value, amount
     FROM sales_invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
    [invoiceId]
  )
  const items = itemsResult.rows

  const theme = typeof inv.theme === 'string' ? JSON.parse(inv.theme) : inv.theme
  const bank  = typeof inv.bank_details === 'string' ? JSON.parse(inv.bank_details) : inv.bank_details

  // theme.primary is DB-sourced (companies.invoice_theme, admin-editable) and is
  // interpolated directly into <style> block CSS below - escape it so a crafted
  // value can't break out of the style tag (e.g. "...} </style><script>...").
  const themePrimary = esc(String(theme?.primary || '#2B6EF5'))

  const isQuotation = inv.doc_type === 'quotation'
  const showTax     = inv.gst_mode !== 'none'

  // -- Computed values
  const subtotal      = items.reduce((sum, it) => sum + parseFloat(String(it.amount)), 0)
  const discount       = parseFloat(String(inv.discount_amount || 0))
  const taxableAmount  = parseFloat(String(inv.amount))
  const gstAmount      = parseFloat(String(inv.gst_amount || 0))
  const total          = parseFloat(String(inv.total))
  const rounding       = parseFloat((total - (taxableAmount + gstAmount)).toFixed(2))
  const isCGST         = inv.gst_type === 'cgst_sgst'
  const cgst           = showTax && isCGST  ? gstAmount / 2 : 0
  const sgst           = showTax && isCGST  ? gstAmount / 2 : 0
  const igst           = showTax && !isCGST ? gstAmount     : 0
  const gstRate        = parseFloat(String(inv.gst_rate || 18))
  const isPaid         = inv.status === 'paid'
  const balanceDue     = parseFloat(String(inv.balance_due || total))

  const fmt     = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
  const hasItemDiscounts = items.some((it) => parseFloat(String(it.discount_value || 0)) > 0)

  // Logo / seal: resolve to a safe path inside uploads/ - never use raw DB value as fs path
  const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
  function safeUploadsPath(urlOrPath: string | null | undefined): string | null {
    if (!urlOrPath) return null
    // Strip /api/uploads/ prefix if present, then resolve inside UPLOADS_DIR
    const rel = urlOrPath.replace(/^\/api\/uploads\//, '').replace(/^\//, '')
    const resolved = path.resolve(UPLOADS_DIR, rel)
    if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) return null
    return resolved
  }

  let logoBase64 = ''
  const logoPath = safeUploadsPath(inv.company_logo as string | null)
  if (logoPath) {
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(logoPath)
      const ext = logoPath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
      logoBase64 = `data:${mime};base64,${buf.toString('base64')}`
    } catch { logoBase64 = '' }
  }

  let sealBase64 = ''
  const sealPath = safeUploadsPath(inv.company_seal as string | null)
  if (sealPath) {
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(sealPath)
      const ext = sealPath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
      sealBase64 = `data:${mime};base64,${buf.toString('base64')}`
    } catch { sealBase64 = '' }
  }

  const initials = (inv.logo_initials as string | null) ||
    (inv.company_name as string)
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()

  // Payment QR - quotations have nothing to pay yet, so this is invoice-only.
  // Generated at a larger module size / stronger error correction than before
  // so it actually scans reliably at print size (previously width:100 →
  // rendered at 88px, too fine-grained to read on most phone cameras).
  let upiQR = ''
  if (!isQuotation && inv.company_upi) {
    const upiString = `upi://pay?pa=${inv.company_upi}&pn=${encodeURIComponent(inv.company_name)}&am=${total}&cu=INR&tn=${inv.invoice_no}`
    upiQR = await QRCode.toDataURL(upiString, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
  }

  const terms = (inv.terms_conditions as string | null) ||
    (inv.company_invoice_terms as string | null) ||
    `1. Payment due within 14 days of invoice date.\n2. Late payments subject to 1.5% monthly interest.\n3. Disputes subject to Chennai jurisdiction.\n4. This is a system-generated tax invoice.`

  const showCompanyGstin = inv.show_company_gstin !== false && !!inv.company_gstin
  const clientGstin       = (inv.client_gstin_override as string | null) || (inv.client_gstin as string | null)
  const placeOfSupply     = (inv.place_of_supply as string | null) || ''
  const paymentTermsLabel = (inv.payment_terms_label as string | null) || 'Net 14'

  // -- HTML template (inline CSS only - Puppeteer does not load external stylesheets)
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src https://fonts.googleapis.com https://fonts.gstatic.com; img-src data:;">
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
    padding: 42px 46px 52px 46px;
  }

  /* ── HEADER ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 38px;
    page-break-inside: avoid;
  }

  .company-block {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  .logo-circle {
    width: 54px;
    height: 54px;
    border-radius: 14px;
    background: ${themePrimary};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .logo-circle img {
    width: 54px;
    height: 54px;
    object-fit: contain;
    border-radius: 14px;
    background: #FFFFFF;
  }

  .logo-circle .initials {
    color: #FFFFFF;
    font-size: 17pt;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .company-info .company-name {
    font-size: 13.5pt;
    font-weight: 700;
    color: #1A1A1A;
    line-height: 1.2;
  }

  .company-info .company-detail {
    font-size: 9.5pt;
    color: #666666;
    margin-top: 4px;
    line-height: 1.65;
  }

  .company-info .company-compliance {
    font-size: 8pt;
    color: #999999;
    margin-top: 4px;
  }

  .invoice-title-block {
    text-align: right;
  }

  .invoice-title-block .invoice-word {
    font-size: 21pt;
    font-weight: 700;
    color: #1A1A1A;
    letter-spacing: 0.08em;
    line-height: 1;
  }

  .invoice-title-block .invoice-number {
    font-size: 9.5pt;
    color: #777777;
    margin-top: 6px;
    font-family: 'Inter', monospace;
  }

  .invoice-title-block .balance-due-label {
    font-size: 8pt;
    color: #999999;
    margin-top: 14px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .invoice-title-block .balance-due-amount {
    font-size: 19pt;
    font-weight: 700;
    color: ${themePrimary};
    margin-top: 2px;
  }

  /* ── DIVIDER ── */
  .divider {
    border: none;
    border-top: 1.5px solid #EBEBEB;
    margin: 0 0 26px 0;
  }

  /* ── BILL TO + INVOICE DETAILS ── */
  .meta-section {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 18px;
    page-break-inside: avoid;
  }

  .bill-to-block {
    flex: 1;
  }

  .block-label {
    font-size: 7.5pt;
    font-weight: 700;
    color: #AAAAAA;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 9px;
  }

  .bill-to-name {
    font-size: 11.5pt;
    font-weight: 700;
    color: #1A1A1A;
    margin-bottom: 4px;
  }

  .bill-to-detail {
    font-size: 9.5pt;
    color: #555555;
    line-height: 1.7;
  }

  .bill-to-gstin {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 600;
    color: #444444;
    background: #F5F5F5;
    border-radius: 4px;
    padding: 3px 9px;
    margin-top: 7px;
  }

  .invoice-details-block {
    width: 230px;
    flex-shrink: 0;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 8.75pt;
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

  /* ── PLACE OF SUPPLY / COMPLIANCE ── */
  .compliance-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    background: #F8F8F8;
    border-radius: 6px;
    padding: 8px 14px;
    margin-bottom: 22px;
    font-size: 7.75pt;
    color: #888888;
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
    border-bottom: 2px solid ${themePrimary};
    color: #1A1A1A;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0 12px 8px 12px;
    text-align: right;
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
    border-bottom: 1.5px solid ${themePrimary};
  }

  table.items tbody td {
    padding: 12px 12px;
    vertical-align: top;
    font-size: 9pt;
  }

  table.items tbody td.item-num {
    color: #BBBBBB;
    font-size: 8.5pt;
    text-align: center;
    width: 26px;
  }

  table.items tbody td.item-desc {
    min-width: 200px;
  }

  table.items tbody td.item-desc .item-title {
    font-weight: 600;
    color: #1A1A1A;
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

  table.items tbody td.discount-cell {
    text-align: right;
    font-size: 8.5pt;
    color: #C2680E;
  }

  /* ── TOTALS ── */
  .totals-section {
    display: flex;
    justify-content: flex-end;
    margin-top: 18px;
    page-break-inside: avoid;
  }

  .totals-block {
    width: 280px;
    border: 1px solid #EEEEEE;
    border-radius: 10px;
    padding: 6px 0;
    overflow: hidden;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 16px;
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
    color: #C2680E;
  }

  .total-row.grand-total {
    background: #1A1A1A;
    margin-top: 4px;
    padding: 11px 16px;
  }

  .total-row.grand-total .t-label {
    color: #FFFFFF;
    font-weight: 700;
    font-size: 10pt;
  }

  .total-row.grand-total .t-value {
    color: #FFFFFF;
    font-weight: 700;
    font-size: 12pt;
  }

  .total-row.balance-due-row {
    background: ${themePrimary}14;
    padding: 9px 16px;
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
    margin-top: 28px;
    page-break-inside: avoid;
  }

  .words-row {
    font-size: 8.75pt;
    color: #555555;
    margin-bottom: 22px;
    padding: 10px 14px;
    background: #F8F8F8;
    border-radius: 6px;
    border-left: 3px solid ${themePrimary};
  }

  .words-row strong {
    display: block;
    margin-bottom: 3px;
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #AAAAAA;
    font-weight: 700;
  }

  .payment-row {
    display: flex;
    gap: 28px;
    margin-bottom: 22px;
    align-items: flex-start;
  }

  .payment-details {
    flex: 1;
  }

  .payment-details .block-label {
    margin-bottom: 7px;
  }

  .payment-line {
    font-size: 8.75pt;
    color: #555555;
    line-height: 1.85;
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
    border-radius: 6px;
  }

  .qr-caption {
    font-size: 6.5pt;
    color: #AAAAAA;
    text-align: center;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── NOTES + TERMS + SIGNATURE ── */
  .footer-row {
    display: flex;
    gap: 24px;
    margin-top: 6px;
    page-break-inside: avoid;
  }

  .notes-block {
    flex: 1;
  }

  .notes-text {
    font-size: 8.75pt;
    color: #555555;
    line-height: 1.7;
    margin-top: 5px;
  }

  .terms-block {
    flex: 1;
  }

  .terms-text {
    font-size: 8pt;
    color: #777777;
    line-height: 1.75;
    margin-top: 5px;
    white-space: pre-line;
  }

  .signature-block {
    width: 190px;
    flex-shrink: 0;
    text-align: center;
    border: 1px solid #EEEEEE;
    border-radius: 8px;
    padding: 12px 10px 10px 10px;
  }

  .signature-space {
    height: 52px;
    margin-bottom: 6px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .signature-space img {
    max-height: 50px;
    max-width: 120px;
    object-fit: contain;
    opacity: 0.85;
  }

  .signature-line {
    border-bottom: 1.5px solid #2D2D2D;
    margin-bottom: 6px;
  }

  .signature-label {
    font-size: 7.75pt;
    font-weight: 600;
    color: #555555;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .for-company {
    font-size: 8pt;
    font-weight: 600;
    color: #1A1A1A;
    margin-bottom: 10px;
  }

  /* ── AUDIT FOOTER ── */
  .audit-footer {
    margin-top: 22px;
    padding-top: 9px;
    border-top: 1px solid #F0F0F0;
    display: flex;
    justify-content: space-between;
    font-size: 6.5pt;
    color: #CCCCCC;
  }

  /* ── PAID / QUOTATION WATERMARK ── */
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
        : `<span class="initials">${esc(initials)}</span>`
      }
    </div>
    <div class="company-info">
      <div class="company-name">${esc(inv.company_name)}</div>
      ${inv.company_address ? `<div class="company-detail" style="white-space:pre-line;">${formatAddressHtml(inv.company_address as string)}</div>` : ''}
      ${(showCompanyGstin || inv.company_pan) ? `<div class="company-compliance">
        ${showCompanyGstin ? `GSTIN: ${esc(inv.company_gstin)}` : ''}
        ${showCompanyGstin && inv.company_pan ? ' &nbsp;·&nbsp; ' : ''}
        ${inv.company_pan ? `PAN: ${esc(inv.company_pan)}` : ''}
      </div>` : ''}
    </div>
  </div>
  <div class="invoice-title-block">
    <div class="invoice-word">${isQuotation ? 'QUOTATION' : 'TAX INVOICE'}</div>
    <div class="invoice-number"># ${esc(inv.invoice_no)}</div>
    ${!isQuotation ? `
    <div class="balance-due-label">Balance Due</div>
    <div class="balance-due-amount">${fmt(balanceDue)}</div>
    ` : ''}
  </div>
</div>

<hr class="divider" />

<!-- ═══ BILL TO + INVOICE DETAILS ═══ -->
<div class="meta-section">
  <div class="bill-to-block">
    <div class="block-label">${isQuotation ? 'Quoted To' : 'Bill To'}</div>
    <div class="bill-to-name">${esc(inv.client_name)}</div>
    ${inv.client_org ? `<div class="bill-to-detail">${esc(inv.client_org)}</div>` : ''}
    ${inv.client_address ? `<div class="bill-to-detail" style="white-space:pre-line;">${formatAddressHtml(inv.client_address as string)}</div>` : ''}
    ${inv.client_email ? `<div class="bill-to-detail">${esc(inv.client_email)}</div>` : ''}
    ${inv.client_phone ? `<div class="bill-to-detail">${esc(inv.client_phone)}</div>` : ''}
    ${clientGstin ? `<div class="bill-to-gstin">GSTIN: ${esc(clientGstin)}</div>` : ''}
  </div>
  <div class="invoice-details-block">
    <div class="detail-row">
      <span class="detail-label">${isQuotation ? 'Quotation Date' : 'Invoice Date'}</span>
      <span class="detail-value">${fmtDate(inv.invoice_date)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Supply Date</span>
      <span class="detail-value">${fmtDate(inv.supply_date)}</span>
    </div>
    ${!isQuotation ? `
    <div class="detail-row">
      <span class="detail-label">Terms</span>
      <span class="detail-value">${esc(paymentTermsLabel)}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Due Date</span>
      <span class="detail-value">${fmtDate(inv.due_date)}</span>
    </div>
    ` : `
    <div class="detail-row">
      <span class="detail-label">Valid Until</span>
      <span class="detail-value">${fmtDate(inv.valid_until)}</span>
    </div>
    `}
    ${inv.po_number ? `
    <div class="detail-row">
      <span class="detail-label">P.O. #</span>
      <span class="detail-value">${esc(inv.po_number)}</span>
    </div>` : ''}
  </div>
</div>

<!-- ═══ PLACE OF SUPPLY + COMPLIANCE ═══ -->
${(placeOfSupply || !isQuotation) ? `
<div class="compliance-strip">
  ${placeOfSupply ? `<span>Place of Supply: <strong>${esc(placeOfSupply)}</strong></span>` : ''}
  <span>GST: <strong>${showTax ? (isCGST ? 'CGST + SGST' : 'IGST') + ` (${gstRate}%)` : 'Not Applicable'}</strong></span>
  ${!isQuotation ? `<span>Reverse Charge: <strong>${inv.reverse_charge ? 'Yes' : 'No'}</strong></span>` : ''}
  ${inv.e_way_bill_no ? `<span>E-Way Bill: <strong>${esc(inv.e_way_bill_no)}</strong></span>` : ''}
</div>` : ''}

<!-- ═══ LINE ITEMS ═══ -->
<table class="items">
  <thead>
    <tr>
      <th style="text-align:center;width:28px">#</th>
      <th style="text-align:left;">Item &amp; Description</th>
      <th style="width:64px">HSN/SAC</th>
      <th style="width:50px">Qty</th>
      <th style="width:85px">Rate</th>
      ${hasItemDiscounts ? `<th style="width:75px">Discount</th>` : ''}
      <th style="width:95px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, idx) => {
      const qty  = parseFloat(String(item.quantity))
      const rate = parseFloat(String(item.unit_price))
      const amt  = parseFloat(String(item.amount))
      const disc = parseFloat(String(item.discount_value || 0))
      const discLabel = item.discount_type === 'percent' ? `${disc}%` : fmt(disc)
      return `
    <tr>
      <td class="item-num">${idx + 1}</td>
      <td class="item-desc"><div class="item-title">${esc(item.description)}</div></td>
      <td class="item-num-right" style="text-align:center;color:#999999;font-size:8pt;">${esc(item.hsn_code) || '-'}</td>
      <td class="item-num-right">${qty.toFixed(2)}</td>
      <td class="item-num-right">${fmt(rate)}</td>
      ${hasItemDiscounts ? `<td class="discount-cell">${disc > 0 ? discLabel : '-'}</td>` : ''}
      <td class="item-amount">${fmt(amt)}</td>
    </tr>`
    }).join('')}
  </tbody>
</table>

<!-- ═══ TOTALS ═══ -->
<div class="totals-section">
  <div class="totals-block">
    <div class="total-row">
      <span class="t-label">Sub Total</span>
      <span class="t-value">${fmt(subtotal)}</span>
    </div>
    ${discount > 0 ? `
    <div class="total-row discount">
      <span class="t-label">Discount</span>
      <span class="t-value">(-) ${fmt(discount)}</span>
    </div>` : ''}
    ${showTax ? (isCGST ? `
    <div class="total-row">
      <span class="t-label">CGST (${(gstRate / 2).toFixed(1)}%)</span>
      <span class="t-value">${fmt(cgst)}</span>
    </div>
    <div class="total-row">
      <span class="t-label">SGST (${(gstRate / 2).toFixed(1)}%)</span>
      <span class="t-value">${fmt(sgst)}</span>
    </div>
    ` : `
    <div class="total-row">
      <span class="t-label">IGST (${gstRate}%)</span>
      <span class="t-value">${fmt(igst)}</span>
    </div>
    `) : ''}
    ${Math.abs(rounding) > 0.001 ? `
    <div class="total-row">
      <span class="t-label">${inv.round_off ? 'Round Off' : 'Rounding'}</span>
      <span class="t-value">${rounding > 0 ? '+' : ''}${fmt(rounding)}</span>
    </div>` : ''}
    <div class="total-row grand-total">
      <span class="t-label">${isQuotation ? 'Quotation Total' : 'Total'}</span>
      <span class="t-value">${fmt(total)}</span>
    </div>
    ${!isQuotation ? `
    <div class="total-row balance-due-row">
      <span class="t-label">Balance Due</span>
      <span class="t-value">${fmt(balanceDue)}</span>
    </div>` : ''}
  </div>
</div>

<!-- ═══ BOTTOM SECTION ═══ -->
<div class="bottom-section">

  <!-- Amount in words -->
  <div class="words-row">
    <strong>Amount in Words</strong>
    ${amountInWords(total)}
  </div>

  ${!isQuotation ? `
  <!-- Payment + QR -->
  <div class="payment-row">
    <div class="payment-details">
      <div class="block-label">Payment Options</div>
      ${bank ? `
      <div class="payment-line">Bank: <strong>${esc(bank.bank_name)}</strong></div>
      <div class="payment-line">A/C Name: <strong>${esc(bank.account_name)}</strong></div>
      <div class="payment-line">A/C No: <strong>${esc(bank.account_no)}</strong> &nbsp;|&nbsp; IFSC: <strong>${esc(bank.ifsc_code)}</strong></div>
      ` : ''}
      ${inv.company_upi ? `<div class="payment-line">UPI: <strong>${esc(inv.company_upi)}</strong></div>` : ''}
      <div class="payment-line" style="margin-top:5px;color:#AAAAAA;font-size:7.75pt;">
        Payment due by ${fmtDate(inv.due_date)} (${esc(paymentTermsLabel)}).
      </div>
    </div>
    ${upiQR ? `
    <div class="qr-group">
      <div class="qr-item">
        <img src="${upiQR}" width="108" height="108" />
        <div class="qr-caption">Scan to Pay</div>
      </div>
    </div>` : ''}
  </div>

  <hr class="divider" />
  ` : ''}

  <!-- Notes + Terms + Signature -->
  <div class="footer-row">
    ${inv.notes ? `
    <div class="notes-block">
      <div class="block-label">Notes</div>
      <div class="notes-text">${esc(inv.notes)}</div>
    </div>` : '<div class="notes-block"></div>'}

    <div class="terms-block">
      <div class="block-label">Terms &amp; Conditions</div>
      <div class="terms-text">${esc(terms)}</div>
    </div>

    <div class="signature-block">
      <div class="for-company">For ${esc(inv.company_name)}</div>
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
  <span>${esc(inv.invoice_no)}${showCompanyGstin ? ` · ${esc(inv.company_gstin)}` : ''}</span>
</div>

</body>
</html>`

  // -- Puppeteer render
  // --no-sandbox is required here: Chromium's sandbox needs user-namespace syscalls
  // that this container's seccomp profile blocks even under the non-root `nextjs`
  // user (see Dockerfile). Removing it makes Puppeteer fail to launch rather than
  // run sandboxed. The actual backstop is that every DB-sourced string reaching this
  // template goes through esc() (see the client_name/notes/po_number/item description/
  // terms_conditions/place_of_supply/payment_terms_label interpolations above) —
  // verified during the 2026-07-27 audit fix pass and re-verified when this template
  // was rebuilt for line items/quotations/GST modes.
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
