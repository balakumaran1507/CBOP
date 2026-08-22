import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'
import puppeteer from 'puppeteer'
import * as fs from 'fs'
import * as path from 'path'
import * as fsPromises from 'fs/promises'
import { buildGoogleFontsImportCss } from '../lib/fonts'
import { type TiptapNode, esc, collectFontFamilies, renderTiptapNode } from '../lib/tiptap-render'
import { defaultOpsAlertEmail, getOpsAlertEmail } from '../lib/ops-alerts'
import { writeMutationAuditLog } from '../lib/audit-log'

const app = new Hono()

// ── Types ─────────────────────────────────────────────────────────────────────

interface PageConfig {
  margins: { top: number; right: number; bottom: number; left: number }
  pageSize: 'A4' | 'A3' | 'Letter'
  headerHtml: string
  footerHtml: string
}

interface CompanyCtx {
  name: string
  address: string | null
  gstin: string | null
  logoBase64: string   // empty string if no logo
}

const BASE_FONTS = [
  { name: 'Inter', weights: '300;400;500;600;700' },
  { name: 'IBM Plex Mono', weights: '400;500' },
]

// ── Placeholder HTML blocks (Document Studio's company-letterhead nodes) ─────

function renderHeaderBannerHtml(ctx: CompanyCtx): string {
  const logoHtml = ctx.logoBase64
    ? `<img src="${ctx.logoBase64}" alt="logo" style="height:56px;max-width:150px;object-fit:contain;display:block;">`
    : `<div style="width:56px;height:56px;background:#0073BB;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:22px;font-family:sans-serif;">${esc(ctx.name?.[0]?.toUpperCase() ?? 'C')}</div>`

  const rightHtml = [ctx.address, ctx.gstin ? `GSTIN: ${ctx.gstin}` : null]
    .filter(Boolean).map(l => `<div>${esc(l!)}</div>`).join('')

  return `<div style="border-top:4px solid #0073BB;padding-top:18px;padding-bottom:16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;">
  <div style="display:flex;align-items:center;gap:14px;">
    ${logoHtml}
    <div style="font-family:sans-serif;font-weight:700;font-size:19px;color:#111827;letter-spacing:-0.01em;">${esc(ctx.name)}</div>
  </div>
  <div style="text-align:right;font-size:10.5px;color:#6B7280;font-family:sans-serif;line-height:1.7;">${rightHtml}</div>
</div>`
}

function renderFooterStripHtml(ctx: CompanyCtx): string {
  const parts: string[] = [ctx.name]
  if (ctx.address) parts.push(ctx.address)
  if (ctx.gstin)   parts.push(`GSTIN: ${ctx.gstin}`)

  return `<div style="border-top:1.5px solid #E5E7EB;margin-top:32px;padding-top:10px;font-family:sans-serif;font-size:10px;color:#9CA3AF;display:flex;justify-content:space-between;align-items:center;">
  ${parts.map(p => `<span>${esc(p)}</span>`).join('')}
</div>`
}

// ── Tiptap JSON → HTML renderer ───────────────────────────────────────────────

function renderNode(
  node: TiptapNode,
  vars: Record<string, string>,
  ctx: CompanyCtx,
  mode: 'pdf' | 'email',
): string {
  // Everything generic (paragraphs, headings, lists, tables, images, text
  // marks, {{variable}} chips) is handled by the shared renderer. Only
  // Document Studio's company-letterhead node types are special-cased here.
  return renderTiptapNode(node, vars, mode, n => {
    switch (n.type) {
      case 'imagePlaceholder': {
        const placeholder = String(n.attrs?.placeholder ?? '')
        switch (placeholder) {
          case 'company_logo':
            if (ctx.logoBase64) return `<img src="${ctx.logoBase64}" alt="Company Logo" style="max-height:80px;max-width:200px;object-fit:contain;display:block;">`
            return `<div style="width:160px;height:60px;background:#F3F4F6;border:1.5px dashed #D1D5DB;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#9CA3AF;">[Company Logo]</div>`
          case 'header_banner':
            return renderHeaderBannerHtml(ctx)
          case 'footer_strip':
            return renderFooterStripHtml(ctx)
          case 'signature':
            return `<div style="margin-top:24px;"><div style="width:180px;height:56px;border-bottom:1.5px solid #374151;margin-bottom:4px;"></div><div style="font-size:11px;color:#374151;font-family:sans-serif;">${esc(ctx.name)}</div></div>`
          default:
            return `<div style="background:#F9FAFB;border:1.5px dashed #D1D5DB;border-radius:6px;padding:16px;text-align:center;color:#9CA3AF;font-size:12px;">[${esc(String(n.attrs?.label ?? placeholder))}]</div>`
        }
      }
      case 'pageBreak':
        return mode === 'email' ? '' : `<div style="page-break-after:always;height:0;"></div>`
      default:
        return (n.content ?? []).map(c => renderNode(c, vars, ctx, mode)).join('')
    }
  })
}

function tiptapToHtml(
  json: TiptapNode,
  vars: Record<string, string> = {},
  ctx: CompanyCtx = { name: '', address: null, gstin: null, logoBase64: '' },
  mode: 'pdf' | 'email' = 'pdf',
): string {
  return renderNode(json, vars, ctx, mode)
}

// ── Extract variables from Tiptap JSON ───────────────────────────────────────

function extractVarsFromJson(node: TiptapNode, found: Set<string> = new Set()): string[] {
  if (node.type === 'variable' && node.attrs?.variable) {
    found.add(String(node.attrs.variable))
  }
  for (const child of node.content ?? []) extractVarsFromJson(child, found)
  return [...found]
}

// ── Sample values for preview ─────────────────────────────────────────────────

const SAMPLE_VARS: Record<string, string> = {
  client_name:         'Cyberdyne Systems Pvt. Ltd.',
  client_org:          'Cyberdyne Systems',
  client_email:        'contact@cyberdyne.com',
  client_address:      '42, Skynet Road, Chennai – 600001',
  applicant_name:      'Aravind Kumar',
  role_title:          'Cybersecurity Intern',
  amount:              '₹1,50,000',
  date:                new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  company_name:        'Etherence IT Private Limited',
  service_description: 'Cybersecurity Penetration Testing Services',
  service_desc:        'Cybersecurity Penetration Testing Services',
  scope_note:          'Full internal + external network assessment',
  due_date:            new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
  gstin:               '33AABCE1234F1Z5',
  gst_type:            'CGST + SGST',
  cgst:                '₹13,500',
  sgst:                '₹13,500',
  igst:                '₹27,000',
  amount_in_words:     'Rupees One Lakh Fifty Thousand Only',
  upi_id:              'etherence@hdfcbank',
  interview_date:      'Monday, 23 June 2026',
  interview_time:      '11:00 AM',
  meet_link:           'https://meet.google.com/abc-defg-hij',
  interviewer_name:    'Balakumaran D',
  start_date:          '01 July 2026',
  team_lead_name:      'Nabeelah S',
  team_lead_email:     defaultOpsAlertEmail(),
}

/**
 * SAMPLE_VARS with the company-specific placeholders resolved. team_lead_email
 * used to be a hardcoded personal address (scale-up plan IF-9); it now comes
 * from companies.ops_alert_email, falling back to the platform default that
 * SAMPLE_VARS carries. Everything else in a preview is intentionally generic.
 */
async function sampleVarsFor(companyId: string | null | undefined): Promise<Record<string, string>> {
  return { ...SAMPLE_VARS, team_lead_email: await getOpsAlertEmail(companyId) }
}

// ── Build company context for placeholder rendering ───────────────────────────

async function buildCompanyCtx(companyId: string): Promise<CompanyCtx> {
  const res = await query(
    `SELECT name, address, gstin, logo_url FROM companies WHERE id = $1`,
    [companyId],
  )
  const row = res.rows[0]
  const logoUrl = row?.logo_url as string | null

  let logoBase64 = ''
  if (logoUrl) {
    try {
      // logo_url is /api/uploads/logos/file.png - strip prefix to get real fs path
      const rel = logoUrl.replace(/^\/api\/uploads\//, 'uploads/')
      const buf = await fsPromises.readFile(path.join(process.cwd(), rel))
      const ext = logoUrl.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
      logoBase64 = `data:${mime};base64,${buf.toString('base64')}`
    } catch { /* no logo on disk */ }
  }

  return {
    name:       row?.name       ?? '',
    address:    row?.address    ?? null,
    gstin:      row?.gstin      ?? null,
    logoBase64,
  }
}

// ── PDF builder ───────────────────────────────────────────────────────────────

async function buildTemplatePdf(
  template: Record<string, unknown>,
  varsIn?: Record<string, string>,
): Promise<Buffer> {
  const companyId = template.company_id as string
  const ctx       = await buildCompanyCtx(companyId)

  // A preview is "no vars supplied" or "the sample set" - in both cases the
  // sample values are resolved per-company (team_lead_email comes from
  // companies.ops_alert_email) instead of being a hardcoded personal address.
  const isPreview = varsIn === undefined || varsIn === SAMPLE_VARS || Object.keys(varsIn).length === 0
  const vars      = isPreview ? await sampleVarsFor(companyId) : varsIn

  const contentJson = template.content_json as TiptapNode | null
  let bodyHtml = ''

  let fontsUsed: string[] = []
  if (contentJson) {
    bodyHtml = tiptapToHtml(contentJson, vars, ctx, 'pdf')
    fontsUsed = collectFontFamilies(contentJson)
  } else {
    // Fallback: old plain-text content
    const content = (template.content as string) || ''
    bodyHtml = `<div class="legacy-content">${content.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] ?? `[${k}]`))}</div>`
  }

  const pc = (() => {
    const raw = template.page_config
    if (!raw) return { margins: { top: 72, right: 72, bottom: 72, left: 72 }, pageSize: 'A4', headerHtml: '', footerHtml: '' }
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return { margins: { top: 72, right: 72, bottom: 72, left: 72 }, pageSize: 'A4', headerHtml: '', footerHtml: '' } }
  })() as PageConfig

  const companyName = (template.company_name as string) || ''
  const name        = (template.name as string) || ''
  const version     = (template.version as number) || 1

  const mTop    = pc.margins?.top    ?? 72
  const mRight  = pc.margins?.right  ?? 72
  const mBottom = pc.margins?.bottom ?? 72
  const mLeft   = pc.margins?.left   ?? 72

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  ${buildGoogleFontsImportCss(fontsUsed, BASE_FONTS)}
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:${pc.pageSize || 'A4'}; margin:0; }
  body {
    font-family:'Inter',Arial,sans-serif;
    font-size:10pt;
    color:#1a1a1a;
    background:#fff;
    padding:${mTop}px ${mRight}px ${mBottom}px ${mLeft}px;
  }
  h1 { font-size:20pt; font-weight:700; color:#111; margin-bottom:16px; line-height:1.2; }
  h2 { font-size:15pt; font-weight:600; color:#1a1a1a; margin:20px 0 10px; }
  h3 { font-size:12pt; font-weight:600; color:#1a1a1a; margin:16px 0 8px; }
  p  { font-size:10pt; line-height:1.8; color:#2d2d2d; margin-bottom:12px; }
  ul, ol { padding-left:22px; margin-bottom:12px; }
  li { font-size:10pt; line-height:1.8; color:#2d2d2d; margin-bottom:4px; }
  blockquote { border-left:3px solid #D5DBDB; padding-left:16px; margin:12px 0; color:#555; }
  pre { background:#f4f4f4; padding:12px; border-radius:4px; font-family:'IBM Plex Mono',monospace; font-size:8.5pt; margin-bottom:12px; overflow:auto; }
  code { font-family:'IBM Plex Mono',monospace; font-size:8.5pt; background:#f4f4f4; padding:0 3px; border-radius:2px; }
  table { width:100%; border-collapse:collapse; margin-bottom:16px; }
  th { background:#f8f9fa; font-weight:600; text-align:left; padding:8px 10px; border:1px solid #D5DBDB; font-size:9pt; }
  td { padding:7px 10px; border:1px solid #D5DBDB; font-size:9.5pt; }
  hr { border:none; border-top:1px solid #E5E7EB; margin:20px 0; }
  img { max-width:100%; height:auto; }
  .var-chip { background:#FEF3C7; color:#92400E; border-radius:3px; padding:0 4px; font-size:0.9em; }
  .img-placeholder { background:#f4f4f4; border:1px dashed #D5DBDB; border-radius:4px; padding:20px; text-align:center; color:#9CA3AF; font-size:9pt; margin-bottom:12px; }
  .legacy-content { white-space:pre-wrap; line-height:1.8; }
  ${isPreview ? '.preview-watermark { position:fixed; bottom:10mm; right:10mm; font-size:7pt; color:#ccc; }' : ''}
</style>
</head>
<body>
${pc.headerHtml ? `<div class="doc-header">${pc.headerHtml}</div>` : ''}
${bodyHtml}
${pc.footerHtml ? `<div class="doc-footer">${pc.footerHtml}</div>` : ''}
${isPreview ? `<div class="preview-watermark">${esc(companyName)} · ${esc(name)} v${version} · Preview</div>` : ''}
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
    format: (pc.pageSize || 'A4') as 'A4' | 'A3' | 'Letter',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
    displayHeaderFooter: false,
  })
  await browser.close()
  return Buffer.from(buffer)
}

// ── Email HTML builder ────────────────────────────────────────────────────────

async function buildTemplateEmail(
  template: Record<string, unknown>,
  vars: Record<string, string>,
): Promise<string> {
  const companyId   = template.company_id as string
  const companyName = (template.company_name as string) || ''
  const ctx         = await buildCompanyCtx(companyId)
  const contentJson = template.content_json as TiptapNode | null

  let bodyHtml = ''
  let fontsUsed: string[] = []
  if (contentJson) {
    bodyHtml = tiptapToHtml(contentJson, vars, ctx, 'email')
    fontsUsed = collectFontFamilies(contentJson)
  } else {
    const content = (template.content as string) || ''
    bodyHtml = content.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
      .split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">${p.replace(/\n/g, '<br>')}</p>`).join('')
  }

  // Best-effort webfont support for email clients that honor <style> (Gmail, Apple Mail).
  // Every font-styled span already carries a sans-serif fallback, so clients that
  // strip this block (Outlook et al.) still render legibly.
  const fontStyleTag = fontsUsed.length
    ? `<style>${buildGoogleFontsImportCss(fontsUsed)}</style>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">${fontStyleTag}</head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E5E7EB;border-radius:4px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:16px;font-weight:700;color:#0F1117;">${esc(companyName)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 28px;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #E5E7EB;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">
              This is an automated message from ${esc(companyName)}.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── GET /api/templates ────────────────────────────────────────────────────────

app.get('/api/templates', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT t.id, t.name, t.type, t.output_type, t.slug, t.version, t.updated_at, t.created_at,
            c.name AS company_name, c.id AS company_id
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.company_id = ANY($1)
     ORDER BY t.updated_at DESC`,
    [companyIds]
  )

  return c.json({ templates: result.rows })
})

// ── GET /api/templates/images ─────────────────────────────────────────────────

app.get('/api/templates/images', requireAuth, async (c) => {
  const dir = path.join(process.cwd(), 'uploads', 'template-images')
  if (!fs.existsSync(dir)) return c.json({ images: [] })
  const images = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(f))
    .map(f => ({ name: f, url: `/api/uploads/template-images/${f}` }))
  return c.json({ images })
})

// ── GET /api/templates/:id ────────────────────────────────────────────────────

app.get('/api/templates/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const result = await query(
    `SELECT t.*, c.name AS company_name, c.logo_url AS company_logo_url
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (result.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const versions = await query(
    `SELECT id, version, content, content_json, saved_at
     FROM templates_versions
     WHERE template_id = $1
     ORDER BY version DESC
     LIMIT 5`,
    [id]
  )

  return c.json({ template: result.rows[0], versions: versions.rows })
})

// ── POST /api/templates ───────────────────────────────────────────────────────

app.post('/api/templates', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const { name, type, content_json, output_type, page_config, slug, company_id } = body

  if (!name)       return c.json({ error: 'name is required' }, 400)
  if (!type)       return c.json({ error: 'type is required' }, 400)
  if (!company_id) return c.json({ error: 'company_id is required' }, 400)
  if (!(companyIds as string[]).includes(company_id)) return c.json({ error: 'Company not in scope' }, 403)

  const variables = content_json ? extractVarsFromJson(content_json as TiptapNode) : []

  const result = await query(
    `INSERT INTO templates (company_id, name, type, content_json, output_type, page_config, slug, variables, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     RETURNING *`,
    [
      company_id, name, type,
      content_json ? JSON.stringify(content_json) : null,
      output_type || 'pdf',
      page_config ? JSON.stringify(page_config) : null,
      slug || null,
      JSON.stringify(variables),
    ]
  )
  const template = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'templates', op: 'create', id: template.id, after: template, companyId: company_id,
  })

  return c.json({ template }, 201)
})

// ── PATCH /api/templates/:id ──────────────────────────────────────────────────

app.patch('/api/templates/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()

  const existing = await query(
    `SELECT id, company_id, content, content_json, version FROM templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const current = existing.rows[0]
  const contentChanged = body.content_json !== undefined

  if (contentChanged) {
    await query(
      `INSERT INTO templates_versions (template_id, content, content_json, version) VALUES ($1, $2, $3, $4)`,
      [id, current.content, current.content_json ? JSON.stringify(current.content_json) : null, current.version]
    )
    await query(
      `DELETE FROM templates_versions WHERE template_id = $1
       AND id NOT IN (SELECT id FROM templates_versions WHERE template_id = $1 ORDER BY saved_at DESC LIMIT 5)`,
      [id]
    )
  }

  const fields: string[]  = []
  const values: unknown[] = []
  let idx = 1

  if (body.name        !== undefined) { fields.push(`name = $${idx++}`);        values.push(body.name) }
  if (body.type        !== undefined) { fields.push(`type = $${idx++}`);        values.push(body.type) }
  if (body.output_type !== undefined) { fields.push(`output_type = $${idx++}`); values.push(body.output_type) }
  if (body.page_config !== undefined) { fields.push(`page_config = $${idx++}`); values.push(JSON.stringify(body.page_config)) }
  if (body.slug        !== undefined) { fields.push(`slug = $${idx++}`);        values.push(body.slug || null) }

  if (contentChanged) {
    const vars = extractVarsFromJson(body.content_json as TiptapNode)
    fields.push(`content_json = $${idx++}`);  values.push(JSON.stringify(body.content_json))
    fields.push(`variables = $${idx++}`);     values.push(JSON.stringify(vars))
    fields.push(`version = version + 1`)
  }

  if (fields.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  values.push(id)
  const result = await query(
    `UPDATE templates SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    values
  )
  const template = result.rows[0]

  await writeMutationAuditLog(c, {
    table: 'templates', op: 'update', id, before: current, after: template, companyId: current.company_id,
  })

  return c.json({ template })
})

// ── DELETE /api/templates/:id ─────────────────────────────────────────────────

app.delete('/api/templates/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const existing = await query(
    `SELECT * FROM templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (existing.rows.length === 0) return c.json({ error: 'Template not found' }, 404)
  const before = existing.rows[0]

  await query(`DELETE FROM templates WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'templates', op: 'delete', id, before, companyId: before.company_id,
  })

  return c.json({ ok: true })
})

// ── POST /api/templates/:id/render ────────────────────────────────────────────
// AI and automation endpoint - render a template with specific variable values

app.post('/api/templates/:id/render', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')
  const body       = await c.req.json()
  const vars       = (body.variables ?? {}) as Record<string, string>
  const mode       = (body.mode ?? 'pdf') as 'pdf' | 'email'

  const result = await query(
    `SELECT t.*, c.name AS company_name, c.logo_url AS company_logo_url
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (result.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const template = result.rows[0]

  if (mode === 'email') {
    const html = await buildTemplateEmail(template, vars)
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  const pdf = await buildTemplatePdf(template, vars)
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${(template.name as string).replace(/[^a-z0-9]/gi, '_')}.pdf"`,
    },
  })
})

// ── GET /api/templates/:id/pdf ────────────────────────────────────────────────
// Preview PDF with sample variables

app.get('/api/templates/:id/pdf', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id         = c.req.param('id')

  const result = await query(
    `SELECT t.*, c.name AS company_name, c.logo_url AS company_logo_url
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (result.rows.length === 0) return c.json({ error: 'Template not found' }, 404)

  const template = result.rows[0]
  const pdf = await buildTemplatePdf(template, SAMPLE_VARS)
  const filename = (template.name as string).replace(/[^a-z0-9]/gi, '_')

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
    },
  })
})

// ── POST /api/templates/upload-image ──────────────────────────────────────────

app.post('/api/templates/upload-image', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const formData = await c.req.formData()
  const file     = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file provided' }, 400)

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
  if (!allowed.includes(file.type)) return c.json({ error: 'Only JPEG, PNG, WebP, GIF, SVG allowed' }, 400)

  const ext     = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const fname   = `${crypto.randomUUID()}.${ext}`
  const dir     = path.join(process.cwd(), 'uploads', 'template-images')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fname), buf)

  return c.json({ url: `/api/uploads/template-images/${fname}` })
})

// ── GET /api/templates/by-slug/:slug ─────────────────────────────────────────
// Used by hiring.ts to look up email templates by stable slug

app.get('/api/templates/by-slug/:slug', requireAuth, async (c) => {
  const slug = c.req.param('slug')
  const result = await query(
    `SELECT t.*, c.name AS company_name, c.logo_url AS company_logo_url
     FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.slug = $1`,
    [slug]
  )
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ template: result.rows[0] })
})

export { tiptapToHtml, buildTemplateEmail, SAMPLE_VARS, extractVarsFromJson }
export type { TiptapNode, PageConfig }
export default app
