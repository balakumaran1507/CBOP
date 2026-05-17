import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'
import puppeteer from 'puppeteer'

const app = new Hono()

// ── GET /api/templates ────────────────────────────────────────────────────────

app.get('/api/templates', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT id, name, type, version, updated_at, created_at
     FROM templates
     WHERE company_id = ANY($1)
     ORDER BY updated_at DESC`,
    [companyIds]
  )

  return c.json({ templates: result.rows })
})

// ── GET /api/templates/:id ────────────────────────────────────────────────────

app.get('/api/templates/:id', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const result = await query(
    `SELECT t.*, c.name AS company_name
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [id, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const versions = await query(
    `SELECT id, version, content, saved_at
     FROM templates_versions
     WHERE template_id = $1
     ORDER BY version DESC`,
    [id]
  )

  return c.json({ template: result.rows[0], versions: versions.rows })
})

// ── POST /api/templates ───────────────────────────────────────────────────────

app.post('/api/templates', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, type, content, company_id } = body

  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!type)       return c.json({ error: 'type is required' }, 400)
  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!(companyIds as string[]).includes(company_id)) return c.json({ error: 'Company not in scope' }, 403)

  const variables = extractVariables(content || '')

  const result = await query(
    `INSERT INTO templates (company_id, name, type, content, variables, version)
     VALUES ($1, $2, $3, $4, $5, 1)
     RETURNING *`,
    [company_id, name, type, content || '', JSON.stringify(variables)]
  )

  return c.json({ template: result.rows[0] }, 201)
})

// ── PATCH /api/templates/:id ──────────────────────────────────────────────────

app.patch('/api/templates/:id', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()

  const existing = await query(
    `SELECT id, content, version FROM templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const current = existing.rows[0]

  // Save current version before update when content changes
  if (body.content !== undefined && body.content !== current.content) {
    await query(
      `INSERT INTO templates_versions (template_id, content, version)
       VALUES ($1, $2, $3)`,
      [id, current.content, current.version]
    )

    // Keep last 5 versions only
    await query(
      `DELETE FROM templates_versions
       WHERE template_id = $1
         AND id NOT IN (
           SELECT id FROM templates_versions
           WHERE template_id = $1
           ORDER BY saved_at DESC
           LIMIT 5
         )`,
      [id]
    )
  }

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(body.name) }
  if (body.type !== undefined) { fields.push(`type = $${idx++}`); values.push(body.type) }

  if (body.content !== undefined) {
    fields.push(`content = $${idx++}`)
    values.push(body.content)
    fields.push(`variables = $${idx++}`)
    values.push(JSON.stringify(extractVariables(body.content)))
    fields.push(`version = version + 1`)
  }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE templates SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx}
     RETURNING *`,
    values
  )

  return c.json({ template: result.rows[0] })
})

// ── GET /api/templates/:id/pdf ────────────────────────────────────────────────

app.get('/api/templates/:id/pdf', requireAuth, requireRole('ceo', 'coo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const result = await query(
    `SELECT t.*,
            c.name           AS company_name,
            c.address        AS company_address,
            c.gstin          AS company_gstin,
            c.logo_url       AS company_logo,
            c.company_seal   AS company_seal,
            c.logo_initials  AS logo_initials,
            COALESCE(c.invoice_theme, '{"primary":"#2B6EF5","accent":"#1A56DB","onPrimary":"#FFFFFF"}') AS theme
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [id, companyIds]
  )

  if (result.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const template = result.rows[0]
  const pdf = await buildTemplatePdf(template)

  const filename = (template.name as string).replace(/[^a-z0-9]/gi, '_')
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
    },
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g) || []
  return [...new Set(matches.map((m) => m.slice(2, -2)))]
}

const SAMPLE_VARS: Record<string, string> = {
  client_name:         'Cyberdyne Systems Pvt. Ltd.',
  amount:              '₹1,50,000',
  date:                new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  company_name:        'Etherence IT Private Limited',
  service_description: 'Cybersecurity Penetration Testing Services',
  due_date:            new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  gstin:               '33AABCE1234F1Z5',
  gst_type:            'CGST + SGST',
  cgst:                '₹13,500',
  sgst:                '₹13,500',
  igst:                '₹27,000',
  amount_in_words:     'Rupees One Lakh Fifty Thousand Only',
  upi_id:              'etherence@hdfcbank',
}

function renderVariables(content: string): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => SAMPLE_VARS[key] || `[${key}]`)
}

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escContent(str: string): string {
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  // highlight {{variable}} placeholders as grey pills
  return escaped.replace(/\[\w+\]/g, (m) => `<span class="var-pill">${m}</span>`)
}

async function buildTemplatePdf(template: Record<string, unknown>): Promise<Buffer> {
  const name        = template.name as string
  const type        = template.type as string
  const content     = (template.content as string) || ''
  const companyName = template.company_name as string
  const version     = template.version as number
  const rendered    = renderVariables(content)

  const theme = (() => {
    const t = template.theme
    if (!t) return { primary: '#2B6EF5' }
    try { return typeof t === 'string' ? JSON.parse(t) : t }
    catch { return { primary: '#2B6EF5' } }
  })()

  const initials = (template.logo_initials as string | null) ||
    companyName
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()

  let logoBase64 = ''
  if (template.company_logo) {
    try {
      const fs = await import('fs/promises')
      const buf = await fs.readFile(template.company_logo as string)
      const ext = (template.company_logo as string).split('.').pop()?.toLowerCase() || 'png'
      logoBase64 = `data:image/${ext};base64,${buf.toString('base64')}`
    } catch { logoBase64 = '' }
  }

  const docType = (type || 'document').toUpperCase()
  const today   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page { size: A4; margin: 0; }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 9.5pt;
    color: #2D2D2D;
    background: #FFFFFF;
    padding: 36px 40px 48px 40px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
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

  .doc-title-block {
    text-align: right;
  }

  .doc-type-word {
    font-size: 22pt;
    font-weight: 700;
    color: #1A1A1A;
    letter-spacing: 0.06em;
    line-height: 1;
  }

  .doc-name-line {
    font-size: 9pt;
    color: #777777;
    margin-top: 4px;
  }

  .doc-date-line {
    font-size: 8pt;
    color: #AAAAAA;
    margin-top: 4px;
  }

  .doc-version {
    font-size: 8pt;
    color: #AAAAAA;
    margin-top: 2px;
  }

  .divider {
    border: none;
    border-top: 1.5px solid #E8E8E8;
    margin: 0 0 24px 0;
  }

  .content {
    font-size: 9.5pt;
    line-height: 1.85;
    color: #2D2D2D;
    white-space: pre-wrap;
  }

  .var-pill {
    display: inline;
    background: #F0F0F0;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 8.5pt;
    color: #555555;
  }

  .preview-note {
    margin-top: 24px;
    padding: 8px 12px;
    border: 1px dashed #D5DBDB;
    background: #F9FAFB;
    font-size: 7pt;
    color: #AAAAAA;
  }

  .audit-footer {
    margin-top: 20px;
    padding-top: 8px;
    border-top: 1px solid #F0F0F0;
    display: flex;
    justify-content: space-between;
    font-size: 6.5pt;
    color: #CCCCCC;
  }
</style>
</head>
<body>

<div class="header">
  <div class="company-block">
    <div class="logo-circle">
      ${logoBase64
        ? `<img src="${logoBase64}" alt="logo" />`
        : `<span class="initials">${initials}</span>`
      }
    </div>
    <div class="company-info">
      <div class="company-name">${esc(companyName)}</div>
      ${template.company_address ? `<div class="company-detail">${esc(template.company_address as string)}</div>` : ''}
      ${template.company_gstin ? `<div class="company-detail">GSTIN: ${esc(template.company_gstin as string)}</div>` : ''}
    </div>
  </div>
  <div class="doc-title-block">
    <div class="doc-type-word">${docType}</div>
    <div class="doc-name-line">${esc(name)}</div>
    <div class="doc-date-line">${today}</div>
    <div class="doc-version">Version ${version} · Preview</div>
  </div>
</div>

<hr class="divider" />

<div class="content">${escContent(rendered)}</div>

<div class="preview-note">
  Preview PDF &middot; Variables shown are samples &middot; {{variable_name}} placeholders replaced with live data in production
</div>

<div class="audit-footer">
  <span>Generated: ${new Date().toISOString()} · CBOP v2</span>
  <span>${esc(companyName)} · ${esc(name)} · v${version}</span>
</div>

</body>
</html>`

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

export default app
