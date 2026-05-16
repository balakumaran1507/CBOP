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

      c.name        AS company_name,
      c.gstin       AS company_gstin,
      c.pan_number  AS company_pan,
      c.upi_id      AS company_upi,
      c.bank_details AS bank_details,
      c.logo_url    AS company_logo,
      c.invoice_terms AS invoice_terms,
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

  const initials = (inv.company_name as string)
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 3)
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
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');

  /* ── RESET ──────────────────────────────── */
  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* ── PAGE SETUP ──────────────────────────── */
  @page {
    size: A4;
    margin: 0;
    @bottom-left {
      content: "${esc(inv.invoice_no)} · ${esc(inv.company_name)}";
      font-family: 'IBM Plex Mono', monospace;
      font-size: 7pt;
      color: #888888;
    }
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-family: 'IBM Plex Mono', monospace;
      font-size: 7pt;
      color: #888888;
    }
    @bottom-right {
      content: "Computer-generated tax invoice";
      font-family: 'IBM Plex Mono', monospace;
      font-size: 7pt;
      color: #888888;
    }
  }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 10pt;
    color: #1A1A1A;
    background: #FFFFFF;
  }

  /* ── LAYOUT ──────────────────────────────── */
  .page-wrap { padding: 14mm 14mm 20mm 14mm; }

  /* ── HEADER BLOCK ────────────────────────── */
  .header {
    background: ${theme.primary};
    padding: 0;
    display: flex;
    align-items: stretch;
    height: 80px;
    margin: -14mm -14mm 0 -14mm;
    page-break-inside: avoid;
  }
  .header-logo {
    width: 90px;
    background: ${theme.accent};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .header-logo img {
    max-height: 56px;
    max-width: 72px;
    object-fit: contain;
  }
  .header-logo .initials {
    font-family: 'Inter', sans-serif;
    font-size: 22px;
    font-weight: 700;
    color: ${theme.onPrimary};
    letter-spacing: 0.05em;
  }
  .header-company {
    flex: 1;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .header-company .company-name {
    font-family: 'Inter', sans-serif;
    font-size: 15pt;
    font-weight: 700;
    color: ${theme.onPrimary};
    letter-spacing: 0.02em;
  }
  .header-company .company-sub {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7.5pt;
    color: ${theme.onPrimary};
    opacity: 0.8;
    margin-top: 2px;
    letter-spacing: 0.04em;
  }
  .header-title {
    width: 160px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    padding: 12px 18px;
    flex-shrink: 0;
  }
  .header-title .invoice-word {
    font-family: 'Inter', sans-serif;
    font-size: 22pt;
    font-weight: 700;
    color: ${theme.onPrimary};
    letter-spacing: 0.15em;
    line-height: 1;
  }
  ${isOverdue ? `.header-title::after {
    content: "OVERDUE";
    font-family: "IBM Plex Mono", monospace;
    font-size: 7pt;
    font-weight: 600;
    color: #FFCC00;
    letter-spacing: 0.2em;
    margin-top: 4px;
  }` : ''}

  /* ── META ROW ────────────────────────────── */
  .meta-row {
    display: flex;
    border-bottom: 2px solid ${theme.primary};
    margin-top: 0;
    background: #FAFAFA;
  }
  .meta-cell {
    flex: 1;
    padding: 8px 12px;
    border-right: 1px solid #E0E0E0;
  }
  .meta-cell:last-child { border-right: none; }
  .meta-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${theme.primary};
    font-weight: 600;
  }
  .meta-value {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5pt;
    font-weight: 600;
    color: #1A1A1A;
    margin-top: 2px;
  }

  /* ── PARTIES SECTION ─────────────────────── */
  .parties {
    display: flex;
    margin-top: 12px;
    gap: 16px;
    page-break-inside: avoid;
  }
  .party-box {
    flex: 1;
    border: 1px solid #D0D0D0;
    padding: 10px 12px;
  }
  .party-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${theme.primary};
    font-weight: 600;
    border-bottom: 1px solid #E0E0E0;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .party-name {
    font-size: 11pt;
    font-weight: 700;
    color: #1A1A1A;
  }
  .party-detail {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8pt;
    color: #444444;
    margin-top: 2px;
    line-height: 1.5;
  }
  .party-gstin {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8pt;
    font-weight: 600;
    color: #1A1A1A;
    margin-top: 4px;
    background: #F0F0F0;
    padding: 2px 6px;
    display: inline-block;
  }

  /* ── COMPLIANCE ROW ──────────────────────── */
  .compliance-row {
    background: #F5F5F5;
    border: 1px solid #D0D0D0;
    border-top: none;
    padding: 5px 12px;
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
  }
  .compliance-item {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7.5pt;
    color: #555555;
  }
  .compliance-item strong {
    color: #1A1A1A;
    font-weight: 600;
  }

  /* ── LINE ITEMS TABLE ────────────────────── */
  .items-section { margin-top: 14px; }
  .section-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${theme.primary};
    font-weight: 600;
    margin-bottom: 4px;
  }

  table.items {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }
  table.items thead {
    display: table-header-group;
  }
  table.items thead tr {
    background: ${theme.primary};
    color: ${theme.onPrimary};
    page-break-inside: avoid;
  }
  table.items thead th {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 7px 8px;
    border: 1px solid ${theme.accent};
    text-align: right;
  }
  table.items thead th:first-child,
  table.items thead th:nth-child(2) {
    text-align: left;
  }
  table.items tbody tr {
    page-break-inside: avoid;
  }
  table.items tbody tr:nth-child(even) {
    background: #FAFAFA;
  }
  table.items tbody tr:nth-child(odd) {
    background: #FFFFFF;
  }
  table.items tbody td {
    padding: 8px 8px;
    border: 1px solid #D0D0D0;
    vertical-align: top;
    line-height: 1.4;
  }
  table.items tbody td.num {
    font-family: 'IBM Plex Mono', monospace;
    text-align: right;
    font-size: 8.5pt;
  }
  table.items tbody td.desc {
    max-width: 200px;
    word-wrap: break-word;
  }
  table.items tbody td.hsn {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8pt;
    text-align: center;
    color: #555555;
  }

  /* ── TOTALS BLOCK ────────────────────────── */
  .totals-wrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 0;
    page-break-inside: avoid;
  }
  table.totals {
    width: 300px;
    border-collapse: collapse;
    font-size: 9pt;
    border: 1px solid #D0D0D0;
  }
  table.totals td {
    padding: 5px 10px;
    border: 1px solid #D0D0D0;
    font-family: 'IBM Plex Mono', monospace;
  }
  table.totals td.label { color: #444444; font-size: 8.5pt; }
  table.totals td.value { text-align: right; font-weight: 600; color: #1A1A1A; }
  table.totals tr.total-row {
    background: ${theme.primary};
    color: ${theme.onPrimary};
  }
  table.totals tr.total-row td {
    font-size: 11pt;
    font-weight: 700;
    border-color: ${theme.accent};
  }
  table.totals tr.total-row td.value { color: ${theme.onPrimary}; }

  /* ── AMOUNT IN WORDS ─────────────────────── */
  .words-box {
    border: 1px solid #D0D0D0;
    border-top: 3px solid ${theme.primary};
    padding: 8px 12px;
    margin-top: 10px;
    page-break-inside: avoid;
  }
  .words-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: ${theme.primary};
    font-weight: 600;
  }
  .words-value {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5pt;
    font-weight: 600;
    color: #1A1A1A;
    margin-top: 3px;
  }

  /* ── PAYMENT + QR ────────────────────────── */
  .payment-section {
    margin-top: 14px;
    display: flex;
    gap: 16px;
    page-break-inside: avoid;
  }
  .payment-box {
    flex: 1;
    border: 1px solid #D0D0D0;
    padding: 10px 12px;
  }
  .payment-box .section-title { margin-bottom: 6px; }
  .payment-line {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8.5pt;
    color: #333333;
    line-height: 1.7;
  }
  .payment-line strong { color: #1A1A1A; font-weight: 600; }
  .qr-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .qr-item { text-align: center; }
  .qr-item img { display: block; border: 1px solid #E0E0E0; }
  .qr-caption {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 6.5pt;
    color: #888888;
    text-align: center;
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* ── FOOTER SECTION ──────────────────────── */
  .footer-section {
    margin-top: 14px;
    display: flex;
    gap: 16px;
    page-break-inside: avoid;
  }
  .terms-box {
    flex: 1;
    border: 1px solid #D0D0D0;
    padding: 10px 12px;
  }
  .terms-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7.5pt;
    color: #555555;
    line-height: 1.8;
    white-space: pre-line;
  }
  .signature-box {
    width: 200px;
    border: 1px solid #D0D0D0;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .signature-for {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7.5pt;
    color: #555555;
  }
  .signature-for strong { color: #1A1A1A; font-size: 8.5pt; }
  .signature-line {
    border-bottom: 1.5px solid #1A1A1A;
    height: 50px;
    margin: 8px 0 4px 0;
  }
  .signature-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 7.5pt;
    color: #555555;
    text-align: center;
  }

  /* ── PAID WATERMARK ──────────────────────── */
  ${isPaid ? `
  .paid-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-family: 'Inter', sans-serif;
    font-size: 72pt;
    font-weight: 900;
    color: rgba(29, 129, 2, 0.10);
    letter-spacing: 0.1em;
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }` : ''}
</style>
</head>
<body>

${isPaid ? '<div class="paid-watermark">PAID</div>' : ''}

<div class="page-wrap">

  <!-- HEADER -->
  <div class="header">
    <div class="header-logo">
      ${logoBase64
        ? `<img src="${logoBase64}" alt="logo" />`
        : `<span class="initials">${initials}</span>`
      }
    </div>
    <div class="header-company">
      <div class="company-name">${esc(inv.company_name)}</div>
      <div class="company-sub">GSTIN: ${esc(inv.company_gstin) || 'N/A'} &nbsp;|&nbsp; PAN: ${esc(inv.company_pan) || 'N/A'}</div>
    </div>
    <div class="header-title">
      <div class="invoice-word">INVOICE</div>
    </div>
  </div>

  <!-- META ROW -->
  <div class="meta-row">
    <div class="meta-cell">
      <div class="meta-label">Invoice No</div>
      <div class="meta-value">${esc(inv.invoice_no)}</div>
    </div>
    <div class="meta-cell">
      <div class="meta-label">Invoice Date</div>
      <div class="meta-value">${fmtDate(inv.invoice_date)}</div>
    </div>
    <div class="meta-cell">
      <div class="meta-label">Supply Date</div>
      <div class="meta-value">${fmtDate(inv.supply_date)}</div>
    </div>
    <div class="meta-cell">
      <div class="meta-label">Due Date</div>
      <div class="meta-value">${fmtDate(inv.due_date)}</div>
    </div>
    <div class="meta-cell">
      <div class="meta-label">Status</div>
      <div class="meta-value">${esc((inv.status as string).toUpperCase())}</div>
    </div>
  </div>

  <!-- PARTIES -->
  <div class="parties">
    <div class="party-box">
      <div class="party-label">Bill From (Supplier)</div>
      <div class="party-name">${esc(inv.company_name)}</div>
      ${inv.company_pan ? `<div class="party-detail">PAN: ${esc(inv.company_pan)}</div>` : ''}
      ${inv.company_gstin ? `<span class="party-gstin">GSTIN: ${esc(inv.company_gstin)}</span>` : ''}
    </div>
    <div class="party-box">
      <div class="party-label">Bill To (Recipient)</div>
      <div class="party-name">${esc(inv.client_name)}</div>
      ${inv.client_org ? `<div class="party-detail">${esc(inv.client_org)}</div>` : ''}
      ${inv.client_address ? `<div class="party-detail">${esc(inv.client_address)}</div>` : ''}
      ${inv.client_gstin ? `<span class="party-gstin">GSTIN: ${esc(inv.client_gstin)}</span>` : ''}
      ${inv.client_email ? `<div class="party-detail">${esc(inv.client_email)}</div>` : ''}
    </div>
  </div>

  <!-- COMPLIANCE ROW -->
  <div class="compliance-row">
    <span class="compliance-item">Place of Supply: <strong>${placeOfSupply}</strong></span>
    <span class="compliance-item">Reverse Charge: <strong>${inv.reverse_charge ? 'Yes' : 'No'}</strong></span>
    <span class="compliance-item">Tax is payable on reverse charge: <strong>No</strong></span>
    ${inv.e_way_bill_no ? `<span class="compliance-item">E-Way Bill: <strong>${esc(inv.e_way_bill_no)}</strong></span>` : ''}
    <span class="compliance-item">GST Type: <strong>${isCGST ? 'CGST + SGST' : 'IGST'}</strong></span>
  </div>

  <!-- LINE ITEMS TABLE -->
  <div class="items-section">
    <div class="section-title">Items &amp; Services</div>
    <table class="items">
      <thead>
        <tr>
          <th style="text-align:center;width:28px">#</th>
          <th style="text-align:left;">Description</th>
          <th style="text-align:center;">HSN/SAC</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Taxable Amt</th>
          ${isCGST ? `
          <th>CGST%</th>
          <th>CGST Amt</th>
          <th>SGST%</th>
          <th>SGST Amt</th>
          ` : `
          <th>IGST%</th>
          <th>IGST Amt</th>
          `}
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="text-align:center;font-family:'IBM Plex Mono',monospace;font-size:8pt;">1</td>
          <td class="desc">
            <strong>${esc(inv.service_description) || 'Professional Services'}</strong>
          </td>
          <td class="hsn">${esc(inv.hsn_code) || '998314'}</td>
          <td class="num">${qty.toFixed(2)}</td>
          <td class="num">${fmt(rate)}</td>
          <td class="num">${fmt(taxableAmount)}</td>
          ${isCGST ? `
          <td class="num">9%</td>
          <td class="num">${fmt(cgst)}</td>
          <td class="num">9%</td>
          <td class="num">${fmt(sgst)}</td>
          ` : `
          <td class="num">18%</td>
          <td class="num">${fmt(igst)}</td>
          `}
          <td class="num"><strong>${fmt(taxableAmount)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div class="totals-wrap">
    <table class="totals">
      <tr>
        <td class="label">Subtotal</td>
        <td class="value">${fmt(taxableAmount)}</td>
      </tr>
      ${isCGST ? `
      <tr>
        <td class="label">CGST @ 9%</td>
        <td class="value">${fmt(cgst)}</td>
      </tr>
      <tr>
        <td class="label">SGST @ 9%</td>
        <td class="value">${fmt(sgst)}</td>
      </tr>
      ` : `
      <tr>
        <td class="label">IGST @ 18%</td>
        <td class="value">${fmt(igst)}</td>
      </tr>
      `}
      ${Math.abs(rounding) > 0.001 ? `
      <tr>
        <td class="label">Rounding</td>
        <td class="value">${rounding > 0 ? '+' : ''}${fmt(rounding)}</td>
      </tr>` : ''}
      <tr class="total-row">
        <td class="label" style="color:${theme.onPrimary};font-size:11pt;">TOTAL</td>
        <td class="value" style="font-size:13pt;">${fmt(total)}</td>
      </tr>
    </table>
  </div>

  <!-- AMOUNT IN WORDS -->
  <div class="words-box">
    <div class="words-label">Amount in Words</div>
    <div class="words-value">${amountInWords(total)}</div>
  </div>

  <!-- PAYMENT + QR -->
  <div class="payment-section">
    <div class="payment-box">
      <div class="section-title">Payment Details</div>
      ${bank ? `
      <div class="payment-line">Bank: <strong>${esc(bank.bank_name)}</strong></div>
      <div class="payment-line">A/C Name: <strong>${esc(bank.account_name)}</strong></div>
      <div class="payment-line">A/C No: <strong>${esc(bank.account_no)}</strong></div>
      <div class="payment-line">A/C Type: <strong>${esc(bank.account_type)}</strong></div>
      <div class="payment-line">IFSC: <strong>${esc(bank.ifsc_code)}</strong></div>
      ` : ''}
      ${inv.company_upi ? `<div class="payment-line">UPI: <strong>${esc(inv.company_upi)}</strong></div>` : ''}
      <div class="payment-line" style="margin-top:6px;color:#888888;font-style:italic;">
        Payment within 14 days of invoice date.
      </div>
    </div>
    <div class="qr-block">
      ${upiQR ? `
      <div class="qr-item">
        <img src="${upiQR}" width="100" height="100" />
        <div class="qr-caption">Scan to Pay</div>
      </div>` : ''}
      <div class="qr-item">
        <img src="${agentQR}" width="64" height="64" />
        <div class="qr-caption">Invoice Data</div>
      </div>
    </div>
  </div>

  <!-- NOTES -->
  ${inv.notes ? `
  <div style="margin-top:12px; border:1px solid #D0D0D0; padding:8px 12px; page-break-inside:avoid;">
    <div class="section-title">Notes</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:8.5pt;color:#444444;margin-top:4px;white-space:pre-line;">${esc(inv.notes)}</div>
  </div>` : ''}

  <!-- TERMS + SIGNATURE -->
  <div class="footer-section">
    <div class="terms-box">
      <div class="section-title">Terms &amp; Conditions</div>
      <div class="terms-text">${esc(terms)}</div>
    </div>
    <div class="signature-box">
      <div class="signature-for">For<br/><strong>${esc(inv.company_name)}</strong></div>
      <div class="signature-line"></div>
      <div class="signature-label">Authorized Signatory</div>
    </div>
  </div>

  <!-- AUDIT FOOTER -->
  <div style="margin-top:10px; border-top:1px solid #E0E0E0; padding-top:6px; display:flex; justify-content:space-between;">
    <span style="font-family:'IBM Plex Mono',monospace;font-size:6.5pt;color:#AAAAAA;">
      Generated: ${new Date().toISOString()} &middot; CBOP v2 &middot; cbop_control@etherence
    </span>
    <span style="font-family:'IBM Plex Mono',monospace;font-size:6.5pt;color:#AAAAAA;">
      ${esc(inv.invoice_no)} &middot; ${esc(inv.company_gstin) || 'N/A'}
    </span>
  </div>

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
