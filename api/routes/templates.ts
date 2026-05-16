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
    `SELECT t.*, c.name AS company_name
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}

async function buildTemplatePdf(template: Record<string, unknown>): Promise<Buffer> {
  const name        = template.name as string
  const type        = template.type as string
  const content     = (template.content as string) || ''
  const companyName = template.company_name as string
  const version     = template.version as number
  const rendered    = renderVariables(content)

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Syne:wght@700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10.5pt; color: #1A1A1A; background: #fff; }
  .page { padding: 20mm; }
  .header { border-bottom: 3px solid #E8820C; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  .doc-type { font-family: 'IBM Plex Mono', monospace; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.15em; color: #E8820C; font-weight: 600; margin-bottom: 4px; text-transform: capitalize; }
  .doc-name { font-family: 'Syne', sans-serif; font-size: 20pt; font-weight: 700; color: #16191F; line-height: 1; }
  .header-right { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #687078; text-align: right; line-height: 1.7; }
  .content { font-size: 10.5pt; line-height: 1.9; color: #232F3E; }
  .preview-note { font-family: 'IBM Plex Mono', monospace; font-size: 7pt; color: #AAB5BB; margin-top: 24px; padding: 8px 12px; border: 1px dashed #D5DBDB; background: #F9FAFB; }
  .footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #D5DBDB; display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', monospace; font-size: 6.5pt; color: #AAB5BB; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="doc-type">${esc(type)} Template</div>
      <div class="doc-name">${esc(name)}</div>
    </div>
    <div class="header-right">
      <div>${esc(companyName)}</div>
      <div>Version ${version}</div>
      <div>${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      <div>Preview — sample variables</div>
    </div>
  </div>
  <div class="content">${escContent(rendered)}</div>
  <div class="preview-note">
    Preview PDF · Variables shown are samples · {{variable_name}} placeholders replaced with live data in production
  </div>
  <div class="footer">
    <span>CBOP v2 · ${esc(companyName)}</span>
    <span>${esc(name)} · v${version}</span>
  </div>
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
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  })
  await browser.close()
  return Buffer.from(buffer)
}

export default app
