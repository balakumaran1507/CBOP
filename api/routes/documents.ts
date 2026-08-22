import { Hono }         from 'hono'
import { requireAuth }  from '../middleware/require-auth'
import { query }        from '../lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest, writeMutationAuditLog } from '../lib/audit-log'
import { getCampaignTransporter } from '../lib/mailer'
import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync }   from 'fs'
import path             from 'path'
import '../lib/hono-vars'
import { buildGoogleFontsImportCss } from '../lib/fonts'
import { sendDesignEmail, renderDesignHtml, inlineImagesAsBase64, type EmailDesignRow } from '../lib/email-designs'
import { resolveFromForCompany, dailyCapFor, todaySentCount, type SendEmailAttachment } from '../lib/mailer'
import { sendViaOpenClaw } from '../lib/openclaw'
import { getOpsAlertTelegramId } from '../lib/ops-alerts'

const app = new Hono()

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'document-backgrounds')
const PDF_DIR    = path.join(process.cwd(), 'uploads', 'document-pdfs')

mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {})
mkdir(PDF_DIR,    { recursive: true }).catch(() => {})

// ── Upload background image (or PDF - page 1 is converted to PNG) ────────────
app.post('/api/documents/upload-bg', requireAuth, async (c) => {
  const formData = await c.req.parseBody()
  const file = formData['file'] as File | undefined
  if (!file || typeof file === 'string') return c.json({ error: 'No file provided' }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext))
    return c.json({ error: 'Only jpg/png/webp/pdf allowed' }, 400)
  if (file.size > 20 * 1024 * 1024)
    return c.json({ error: 'Max 20 MB' }, 400)

  const uuid = crypto.randomUUID()

  if (ext === 'pdf') {
    const tmpPdf    = path.join(UPLOAD_DIR, `tmp-${uuid}.pdf`)
    const outPrefix = path.join(UPLOAD_DIR, `tmp-${uuid}`)
    await writeFile(tmpPdf, Buffer.from(await file.arrayBuffer()))
    try {
      const { execFile }    = await import('child_process')
      const { promisify }   = await import('util')
      const execFileAsync   = promisify(execFile)
      // -png: PNG output | -r 150: 150dpi | -f 1 -l 1: first page only
      await execFileAsync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', tmpPdf, outPrefix], { timeout: 15000 })
      // pdftoppm names output <prefix>-1.png or <prefix>-01.png depending on page count
      const found = [`${outPrefix}-1.png`, `${outPrefix}-01.png`, `${outPrefix}-001.png`].find(f => existsSync(f))
      if (!found) throw new Error('pdftoppm produced no output - check PDF is not encrypted')
      const { rename } = await import('fs/promises')
      const pngFilename = `${uuid}.png`
      await rename(found, path.join(UPLOAD_DIR, pngFilename))
      return c.json({ path: pngFilename })
    } catch (err) {
      return c.json({ error: (err as Error).message || 'PDF conversion failed' }, 500)
    } finally {
      await unlink(tmpPdf).catch(() => {})
    }
  }

  const filename = `${uuid}.${ext}`
  await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()))
  return c.json({ path: filename })
})

// ── Serve background image ────────────────────────────────────────────────────
app.get('/api/documents/backgrounds/:filename', requireAuth, async (c) => {
  const filename = c.req.param('filename') as string
  if (filename.includes('..') || filename.includes('/'))
    return c.json({ error: 'Invalid filename' }, 400)

  const filepath = path.join(UPLOAD_DIR, filename)
  if (!existsSync(filepath)) return c.json({ error: 'Not found' }, 404)

  const buffer = await readFile(filepath)
  const ext    = filename.split('.').pop()?.toLowerCase()
  const mime   = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

  return new Response(buffer as unknown as BodyInit, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' },
  })
})

// ── List templates ────────────────────────────────────────────────────────────
app.get('/api/documents/templates', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT dt.*, u.name AS created_by_name,
       (SELECT COUNT(*)::int FROM document_batches db WHERE db.template_id = dt.id) AS batch_count
     FROM document_templates dt
     LEFT JOIN users u ON u.id = dt.created_by
     WHERE dt.company_id = ANY($1)
     ORDER BY dt.updated_at DESC`,
    [companyIds]
  )
  return c.json(rows)
})

// ── Get single template ───────────────────────────────────────────────────────
app.get('/api/documents/templates/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows } = await query(
    `SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!rows.length) return c.json({ error: 'Not found' }, 404)
  return c.json(rows[0])
})

// ── Create template ───────────────────────────────────────────────────────────
app.post('/api/documents/templates', requireAuth, async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()

  const { company_id, name, doc_type, background_path, canvas_width, canvas_height, elements } = body
  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!name || !doc_type) return c.json({ error: 'name and doc_type required' }, 400)

  const tags = extractTags(elements ?? [])
  const { rows } = await query(
    `INSERT INTO document_templates
       (company_id, name, doc_type, background_path, canvas_width, canvas_height, elements, tags, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [company_id, name, doc_type, background_path ?? null,
     canvas_width ?? 794, canvas_height ?? 1123,
     JSON.stringify(elements ?? []), tags, userId]
  )
  const template = rows[0]

  await writeMutationAuditLog(c, {
    table: 'document_templates', op: 'create', id: template.id, after: template, companyId: company_id,
  })

  return c.json(template, 201)
})

// ── Update template ───────────────────────────────────────────────────────────
app.patch('/api/documents/templates/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id   = c.req.param('id') as string
  const body = await c.req.json()

  const { rows: [existing] } = await query(
    `SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const { name, doc_type, background_path, canvas_width, canvas_height, elements } = body
  const tags = extractTags(elements ?? [])

  const { rows } = await query(
    `UPDATE document_templates SET
       name             = COALESCE($1, name),
       doc_type         = COALESCE($2, doc_type),
       background_path  = COALESCE($3, background_path),
       canvas_width     = COALESCE($4, canvas_width),
       canvas_height    = COALESCE($5, canvas_height),
       elements         = COALESCE($6::jsonb, elements),
       tags             = $7,
       updated_at       = NOW()
     WHERE id = $8 RETURNING *`,
    [name ?? null, doc_type ?? null, background_path ?? null,
     canvas_width ?? null, canvas_height ?? null,
     elements != null ? JSON.stringify(elements) : null,
     tags, id]
  )
  const template = rows[0]

  await writeMutationAuditLog(c, {
    table: 'document_templates', op: 'update', id, before: existing, after: template, companyId: existing.company_id,
  })

  return c.json(template)
})

// ── Delete template ───────────────────────────────────────────────────────────
app.delete('/api/documents/templates/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string

  const { rows: [existing] } = await query(
    `SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await query('DELETE FROM document_templates WHERE id = $1', [id])

  await writeMutationAuditLog(c, {
    table: 'document_templates', op: 'delete', id, before: existing, companyId: existing.company_id,
  })

  if (existing.background_path) {
    const bgPath = path.join(UPLOAD_DIR, existing.background_path as string)
    unlink(bgPath).catch(() => {})
  }
  return c.json({ ok: true })
})

// ── Start batch generation ────────────────────────────────────────────────────
app.post('/api/documents/templates/:id/generate', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const id     = c.req.param('id') as string

  const { rows: [template] } = await query(
    `SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const body = await c.req.json()
  const { batch_name, recipients, send_email, email_subject, email_message, email_design_id, extra_attachment_ids } = body as {
    batch_name?:      string
    recipients:       Record<string, string>[]
    send_email?:      boolean
    email_subject?:   string
    email_message?:   string
    email_design_id?: string
    extra_attachment_ids?: string[]
  }

  if (!recipients?.length) return c.json({ error: 'No recipients provided' }, 400)
  if (recipients.length > 1000) return c.json({ error: 'Max 1000 per batch' }, 400)

  const { rows: [batch] } = await query(
    `INSERT INTO document_batches
       (template_id, company_id, name, status, total_count, send_email, created_by, extra_attachment_ids)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7) RETURNING *`,
    [id, template.company_id,
     batch_name || `${template.name as string} - Batch`,
     recipients.length, !!send_email, userId, extra_attachment_ids ?? []]
  )

  await writeMutationAuditLog(c, {
    table: 'document_batches', op: 'create', id: batch.id, after: batch, companyId: template.company_id,
  })

  runBatch(batch.id as string, template, recipients, !!send_email, email_subject, email_message, email_design_id).catch((err: Error) => {
    console.error('[documents] batch failed:', err)
    query(
      `UPDATE document_batches SET status='failed', error_message=$1 WHERE id=$2`,
      [err.message, batch.id]
    ).catch(() => {})
  })

  return c.json({ batch_id: batch.id }, 201)
})

function rowToEmailDesign(d: Record<string, unknown>): EmailDesignRow {
  return {
    id: d.id as string, company_id: d.company_id as string | null, name: d.name as string,
    subject: d.subject as string | null, design_json: d.design_json, html: d.html as string | null,
    text: d.text as string | null, category: d.category as string | null,
    content_mode: d.content_mode as 'richtext' | 'html', variables: d.variables as string[],
    is_global: Boolean(d.is_global), slug: d.slug as string | null,
  }
}

// ── Preview: render one recipient's PDF + email without persisting anything ──
// "1 of 156" preview before committing to a full batch - same render functions
// the real generate/send paths use, just not saved to document_generated/sent.
app.post('/api/documents/templates/:id/preview', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows: [template] } = await query(`SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const body = await c.req.json() as { recipient: Record<string, string>; email_design_id?: string }
  if (!body.recipient) return c.json({ error: 'recipient is required' }, 400)

  const bgDataUrl = await loadBackgroundDataUrl(template)
  const html = buildDocumentHtml(template, body.recipient, bgDataUrl)
  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  let pdfBase64 = ''
  try {
    const pdf = await renderToPdf(browser, html, (template.canvas_width as number) || 794, (template.canvas_height as number) || 1123)
    pdfBase64 = pdf.toString('base64')
  } finally {
    await browser.close()
  }

  let emailSubject = ''
  let emailHtml = ''
  if (body.email_design_id) {
    const { rows: [d] } = await query(`SELECT * FROM email_designs WHERE id = $1`, [body.email_design_id])
    if (d) {
      const design = rowToEmailDesign(d)
      emailSubject = (design.subject ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => body.recipient[k] ?? `{{${k}}}`)
      emailHtml = await inlineImagesAsBase64(renderDesignHtml(design, body.recipient))
    }
  }

  return c.json({ pdf_base64: pdfBase64, email_subject: emailSubject, email_html: emailHtml })
})

// ── Preview-send: actually email ONE recipient's real rendering to yourself ──
// The extra safety net when a visual preview alone isn't enough - exercises the
// real send pipeline (company sender routing, attachment, template rendering)
// with this recipient's actual data, but delivered only to the requesting user.
app.post('/api/documents/templates/:id/preview-send', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const id = c.req.param('id') as string
  const { rows: [template] } = await query(`SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const body = await c.req.json() as { recipient: Record<string, string>; email_design_id?: string }
  if (!body.recipient) return c.json({ error: 'recipient is required' }, 400)
  if (!body.email_design_id) return c.json({ error: 'email_design_id is required' }, 400)

  const { rows: [user] } = await query(`SELECT email FROM users WHERE id = $1`, [userId])
  if (!user?.email) return c.json({ error: 'Could not resolve your account email' }, 500)

  const { rows: [d] } = await query(`SELECT * FROM email_designs WHERE id = $1`, [body.email_design_id])
  if (!d) return c.json({ error: 'Email design not found' }, 404)
  const design = rowToEmailDesign(d)

  const bgDataUrl = await loadBackgroundDataUrl(template)
  const html = buildDocumentHtml(template, body.recipient, bgDataUrl)
  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  let pdf: Buffer
  try {
    pdf = await renderToPdf(browser, html, (template.canvas_width as number) || 794, (template.canvas_height as number) || 1123)
  } finally {
    await browser.close()
  }

  const result = await sendDesignEmail({
    design, to: user.email, vars: body.recipient,
    attachments: [{ filename: `PREVIEW-${(template.name as string).replace(/[^a-z0-9 _-]/gi, '_')}.pdf`, content: pdf, contentType: 'application/pdf' }],
    companyId: template.company_id as string,
    kind: 'transactional',
  })
  if (!result.ok) return c.json({ error: result.reason ?? 'Send failed' }, 502)
  return c.json({ ok: true, messageId: result.messageId, sentTo: user.email })
})

// ── Daily send-cap visibility ─────────────────────────────────────────────────
// Surfaces what's otherwise only enforced silently server-side (mailer.ts) so
// a big batch isn't started blind to "you're already at 690/700 sent today".
app.get('/api/documents/templates/:id/send-cap', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows: [template] } = await query(`SELECT company_id FROM document_templates WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const { rows: [company] } = await query(`SELECT name FROM companies WHERE id = $1`, [template.company_id])
  const from = await resolveFromForCompany(template.company_id as string, company?.name as string | undefined)
  if (!from) return c.json({ from: null, sentToday: 0, cap: 0 })

  const [sentToday, cap] = await Promise.all([todaySentCount(from), dailyCapFor(from)])
  return c.json({ from, sentToday, cap })
})

// ── List batches ──────────────────────────────────────────────────────────────
app.get('/api/documents/batches', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT db.*, dt.name AS template_name, u.name AS created_by_name
     FROM document_batches db
     JOIN document_templates dt ON dt.id = db.template_id
     LEFT JOIN users u ON u.id = db.created_by
     WHERE db.company_id = ANY($1)
     ORDER BY db.created_at DESC LIMIT 100`,
    [companyIds]
  )
  return c.json(rows)
})

// ── Batch status + items ──────────────────────────────────────────────────────
app.get('/api/documents/batches/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string

  const { rows: [batch] } = await query(
    `SELECT db.*, dt.name AS template_name
     FROM document_batches db
     JOIN document_templates dt ON dt.id = db.template_id
     WHERE db.id = $1 AND db.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!batch) return c.json({ error: 'Not found' }, 404)

  const { rows: docs } = await query(
    `SELECT id, recipient_name, recipient_email, email_sent, email_sent_at, created_at,
       status, viewed_at, acknowledged_at,
       (pdf_path IS NOT NULL) AS has_pdf
     FROM document_generated WHERE batch_id = $1 ORDER BY created_at ASC`,
    [id]
  )
  return c.json({ ...batch, documents: docs })
})

// ── Download generated PDF ────────────────────────────────────────────────────
app.get('/api/documents/generated/:id/pdf', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string

  const { rows: [doc] } = await query(
    `SELECT dg.*, db.company_id
     FROM document_generated dg
     JOIN document_batches db ON db.id = dg.batch_id
     WHERE dg.id = $1 AND db.company_id = ANY($2)`,
    [id, companyIds]
  )
  if (!doc)            return c.json({ error: 'Not found' }, 404)
  if (!doc.pdf_path)   return c.json({ error: 'PDF not ready' }, 404)

  const filepath = path.join(PDF_DIR, doc.pdf_path as string)
  if (!existsSync(filepath)) return c.json({ error: 'PDF file missing' }, 404)

  const buffer   = await readFile(filepath)
  const safeName = ((doc.recipient_name as string) || 'document')
    .replace(/[^a-z0-9 _-]/gi, '_')

  // Data export — this PDF carries a named recipient's personal data.
  await writeAuditLogForRequest(c, {
    action:       AUDIT_ACTIONS.exportDocumentPdf,
    resourceType: 'document_generated',
    resourceId:   id,
    companyId:    (doc.company_id as string) ?? null,
    after:        { batch_id: doc.batch_id ?? null, recipient_name: doc.recipient_name ?? null, bytes: buffer.length },
  })

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
    },
  })
})

// ── Public tracked view link ─────────────────────────────────────────────────
// No auth - this is meant to be handed to the recipient directly (in addition
// to or instead of a raw attachment) so CBOP actually knows if they opened it,
// same idea as email open tracking. Not yet wired into the automatic send flow -
// that pipeline is deliberately left alone (see docs/HANDOFF.md's note on the
// prior Email Studio safety/audit hardening pass); this is available to link to
// manually until a considered decision is made to route sends through it.

app.get('/api/documents/public/:id/view', async (c) => {
  const id = c.req.param('id') as string

  const { rows: [doc] } = await query(`SELECT pdf_path, status FROM document_generated WHERE id = $1`, [id])
  if (!doc || !doc.pdf_path) return c.text('Not found', 404)

  await query(
    `UPDATE document_generated SET viewed_at = COALESCE(viewed_at, NOW()),
       status = CASE WHEN status = 'generated' OR status = 'sent' THEN 'viewed' ELSE status END
     WHERE id = $1`,
    [id]
  ).catch(() => {})

  const filepath = path.join(PDF_DIR, doc.pdf_path as string)
  if (!existsSync(filepath)) return c.text('PDF file missing', 404)

  const buffer = await readFile(filepath)
  return new Response(buffer as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf' } })
})

// ── Manually mark a document acknowledged ─────────────────────────────────────
// For the common case where confirmation comes out-of-band (a reply email, a call).

app.patch('/api/documents/generated/:id/acknowledge', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string

  const { rows: [doc] } = await query(
    `SELECT db.company_id FROM document_generated dg JOIN document_batches db ON db.id = dg.batch_id WHERE dg.id = $1`,
    [id]
  )
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (!companyIds.includes(doc.company_id)) return c.json({ error: 'Forbidden' }, 403)

  await query(`UPDATE document_generated SET status = 'acknowledged', acknowledged_at = NOW() WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'document_generated', op: 'update', id, after: { status: 'acknowledged' }, companyId: doc.company_id,
  })

  return c.json({ ok: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractTags(elements: { tag?: string }[]): string[] {
  return [...new Set(elements.map(el => el.tag).filter(Boolean) as string[])]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function loadBackgroundDataUrl(template: Record<string, unknown>): Promise<string> {
  if (!template.background_path) return ''
  const bgFile = path.join(UPLOAD_DIR, template.background_path as string)
  if (!existsSync(bgFile)) return ''
  const buf = await readFile(bgFile)
  const ext = (template.background_path as string).split('.').pop()?.toLowerCase()
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

function buildDocumentHtml(
  template: Record<string, unknown>,
  data: Record<string, string>,
  bgDataUrl: string
): string {
  const elements = (template.elements as any[]) ?? []
  const W = (template.canvas_width as number) || 794
  const H = (template.canvas_height as number) || 1123

  const fontsUsed = [...new Set(elements.map(el => el.fontFamily).filter(Boolean))] as string[]
  const fontImport = buildGoogleFontsImportCss(fontsUsed)

  const elementHtml = elements.map(el => {
    const rawVal  = data[el.tag as string] ?? ''
    const escaped = esc(rawVal)
    return `<div style="
      position:absolute;
      left:${el.x ?? 0}px;top:${el.y ?? 0}px;
      width:${el.width ? el.width + 'px' : 'auto'};
      font-family:${esc(el.fontFamily ?? 'Arial')},sans-serif;
      font-size:${el.fontSize ?? 16}px;
      font-weight:${el.fontWeight ?? 'normal'};
      font-style:${el.fontStyle ?? 'normal'};
      color:${esc(el.fill ?? '#000000')};
      text-align:${el.textAlign ?? 'left'};
      white-space:nowrap;line-height:1.35;
    ">${escaped}</div>`
  }).join('')

  const bgStyle = bgDataUrl
    ? `background-image:url('${bgDataUrl}');background-size:100% 100%;`
    : 'background-color:#fff;'

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  ${fontImport}
  @page{size:${W}px ${H}px;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;position:relative;${bgStyle}}
</style>
</head><body>${elementHtml}</body></html>`
}

async function renderToPdf(
  browser: import('puppeteer').Browser,
  html: string,
  width: number,
  height: number
): Promise<Buffer> {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      width:           `${width}px`,
      height:          `${height}px`,
      printBackground: true,
      margin:          { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges:      '1',
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

function fillTags(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, tag) => data[tag] ?? `{{${tag}}}`)
}

async function sendDocumentEmail(
  template:     Record<string, unknown>,
  data:         Record<string, string>,
  pdfBuf:       Buffer,
  companyName:  string,
  emailSubject?: string,
  emailMessage?: string,
): Promise<void> {
  const { transporter, from } = await getCampaignTransporter(template.company_id as string | undefined, companyName)

  const subject = fillTags(
    emailSubject?.trim() || `Your ${template.name as string}`,
    data
  )

  const rawMessage = emailMessage?.trim()
    || `Dear {{name}},\n\nPlease find your ${template.name as string} attached.\n\nBest regards,`
  const filledMessage = fillTags(rawMessage, data)

  const htmlMessage = filledMessage
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">${p.replace(/\n/g, '<br>')}</p>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E5E7EB;">
        <tr><td style="background:#0073BB;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:16px;font-weight:700;color:#0F1117;letter-spacing:-0.3px;">${companyName}</div>
          </td>
        </tr>
        <tr><td style="padding:32px 32px 28px;">${htmlMessage}</td></tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #E5E7EB;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">Please find your document attached. Do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await transporter.sendMail({
    from,
    to:      data.email,
    subject,
    text:    filledMessage,
    html,
    attachments: [{
      filename:    `${(template.name as string).replace(/[^a-z0-9 _-]/gi, '_')}.pdf`,
      content:     pdfBuf,
      contentType: 'application/pdf',
    }],
  })
}

// Looks up an Email Studio design and sends it with this recipient's own
// generated PDF attached - the "attach PDFs generated in the batch" path.
const ATTACHMENT_DIR = path.join(process.cwd(), 'uploads', 'email-attachments')

// Resolves document_batches.extra_attachment_ids into actual attachment
// buffers - the "always attach these to every email in this batch" library
// (uploaded once via POST /api/email-attachments, api/routes/email-studio.ts).
async function loadExtraAttachments(attachmentIds: string[]): Promise<SendEmailAttachment[]> {
  if (!attachmentIds?.length) return []
  const { rows } = await query(
    `SELECT name, file_path, mime_type FROM email_attachments WHERE id = ANY($1)`,
    [attachmentIds]
  )
  const out: SendEmailAttachment[] = []
  for (const row of rows) {
    try {
      const content = await readFile(path.join(ATTACHMENT_DIR, row.file_path as string))
      out.push({ filename: row.name as string, content, contentType: (row.mime_type as string) || undefined })
    } catch { /* file missing on disk - skip rather than fail the whole send */ }
  }
  return out
}

async function sendDocumentEmailViaDesign(
  design:      EmailDesignRow,
  data:        Record<string, string>,
  pdfBuf:      Buffer,
  docName:     string,
  companyId:   string | null,
  extraAttachments: SendEmailAttachment[] = [],
): Promise<void> {
  await sendDesignEmail({
    design,
    to: data.email,
    vars: data,
    attachments: [
      {
        filename:    `${docName.replace(/[^a-z0-9 _-]/gi, '_')}.pdf`,
        content:     pdfBuf,
        contentType: 'application/pdf',
      },
      ...extraAttachments,
    ],
    attachmentRefs: [
      { type: 'document_generated', name: docName },
      ...extraAttachments.map(a => ({ type: 'email_attachment', name: a.filename })),
    ],
    companyId,
    kind: 'document',
  })
}

// ── Resumable batch processing ────────────────────────────────────────────────
// Every recipient is persisted as a `document_batch_items` row *before*
// processing starts (see the /generate route and legacy runBatch() below).
// runPendingItems() only ever asks "what's still pending for this batch?" -
// so it's naturally resumable across a server restart, a pause/resume click,
// or a retry: calling it again just picks up wherever the last run stopped.
// Safe to call concurrently-idempotent-ish (each item claim is a single
// UPDATE ... WHERE status='pending' so two overlapping calls can't double-send
// the same item), and cheap to call when there's nothing left to do.
async function runPendingItems(batchId: string): Promise<void> {
  const { rows: [batch] } = await query(`SELECT * FROM document_batches WHERE id = $1`, [batchId])
  if (!batch) return
  const { rows: [template] } = await query(`SELECT * FROM document_templates WHERE id = $1`, [batch.template_id])
  if (!template) return

  await query(`UPDATE document_batches SET status = 'generating' WHERE id = $1 AND status != 'done'`, [batchId])

  const { rows: [company] } = await query(`SELECT name FROM companies WHERE id = $1`, [template.company_id])
  const companyName = (company?.name as string) || 'CBOP'

  let emailDesign: EmailDesignRow | null = null
  if (batch.email_design_id) {
    const { rows: [d] } = await query(`SELECT * FROM email_designs WHERE id = $1`, [batch.email_design_id])
    if (d) {
      emailDesign = rowToEmailDesign(d)
    }
  }

  const bgDataUrl = await loadBackgroundDataUrl(template)
  const extraAttachments = await loadExtraAttachments((batch.extra_attachment_ids as string[]) ?? [])

  // Any item stuck in 'processing' belongs to a run that never got to mark it
  // done/failed (a crash, a kill -9 mid-item) - only one runPendingItems() loop
  // is ever active per batch, so on (re)start it's always safe to reclaim them.
  await query(`UPDATE document_batch_items SET status = 'pending', updated_at = NOW() WHERE batch_id = $1 AND status = 'processing'`, [batchId])

  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })

  try {
    for (;;) {
      const { rows: [fresh] } = await query(`SELECT paused FROM document_batches WHERE id = $1`, [batchId])
      if (fresh?.paused) break

      // Claim exactly one pending item by moving it to 'processing' - held for
      // the full duration of PDF-gen + email-send, not just an instant, so a
      // second concurrent loop (e.g. a double-clicked Resume) can't grab it too.
      const { rows: [item] } = await query(
        `UPDATE document_batch_items SET status = 'processing', updated_at = NOW()
         WHERE id = (
           SELECT id FROM document_batch_items
           WHERE batch_id = $1 AND status = 'pending'
           ORDER BY seq ASC LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [batchId]
      )
      if (!item) break

      const data = item.recipient_data as Record<string, string>
      try {
        // A previous attempt at this item may have gotten as far as creating a
        // document_generated row before the process died mid-item (exactly what
        // the crash-recovery reclaim above produces). Clear it out first so a
        // retry never leaves an orphaned, half-finished row behind.
        if (item.document_generated_id) {
          const { rows: [old] } = await query(`SELECT pdf_path FROM document_generated WHERE id = $1`, [item.document_generated_id])
          if (old?.pdf_path) await unlink(path.join(PDF_DIR, old.pdf_path as string)).catch(() => {})
          await query(`DELETE FROM document_generated WHERE id = $1`, [item.document_generated_id])
        }

        const { rows: [doc] } = await query(
          `INSERT INTO document_generated (batch_id, template_id, recipient_name, recipient_email, recipient_data)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [batchId, template.id, data.name ?? data.candidate_name ?? '', data.email ?? '', JSON.stringify(data)]
        )
        // Record the (possibly still-incomplete) doc against the item immediately -
        // if we crash again before finishing, the next reclaim can find and clean it up.
        await query(`UPDATE document_batch_items SET document_generated_id = $1 WHERE id = $2`, [doc.id, item.id])

        const html = buildDocumentHtml(template, data, bgDataUrl)
        const pdf  = await renderToPdf(
          browser, html,
          (template.canvas_width as number) || 794,
          (template.canvas_height as number) || 1123
        )
        const pdfFile = `${doc.id as string}.pdf`
        await writeFile(path.join(PDF_DIR, pdfFile), pdf)
        await query(`UPDATE document_generated SET pdf_path = $1 WHERE id = $2`, [pdfFile, doc.id])

        if (batch.send_email && data.email) {
          if (emailDesign) {
            await sendDocumentEmailViaDesign(emailDesign, data, pdf, template.name as string, template.company_id as string, extraAttachments)
          } else {
            await sendDocumentEmail(template, data, pdf, companyName, batch.email_subject, batch.email_message)
          }
          await query(`UPDATE document_generated SET email_sent = true, email_sent_at = NOW() WHERE id = $1`, [doc.id])
        }

        await query(
          `UPDATE document_batch_items SET status = 'done', document_generated_id = $1, updated_at = NOW() WHERE id = $2`,
          [doc.id, item.id]
        )
      } catch (err) {
        console.error(`[documents] batch item ${item.id} failed:`, err)
        await query(
          `UPDATE document_batch_items SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [err instanceof Error ? err.message : String(err), item.id]
        )
      }

      const { rows: [cnt] } = await query(
        `SELECT count(*)::int AS n FROM document_batch_items WHERE batch_id = $1 AND status IN ('done','failed')`,
        [batchId]
      )
      await query(`UPDATE document_batches SET done_count = $1 WHERE id = $2`, [cnt.n, batchId])
    }

    const { rows: [remaining] } = await query(
      `SELECT count(*)::int AS n FROM document_batch_items WHERE batch_id = $1 AND status = 'pending'`,
      [batchId]
    )
    // batch.status here is the value fetched at the top of this call, i.e. before
    // this run touched anything - guards against re-notifying when resume/duplicate
    // is called again on a batch that was already finished (nothing left to claim,
    // loop exits immediately, remaining.n is still 0).
    if (remaining.n === 0) {
      await query(`UPDATE document_batches SET status = 'done' WHERE id = $1`, [batchId])
      if (batch.status !== 'done') {
        const { rows: [counts] } = await query(
          `SELECT count(*) FILTER (WHERE status = 'done') AS done, count(*) FILTER (WHERE status = 'failed') AS failed
           FROM document_batch_items WHERE batch_id = $1`,
          [batchId]
        )
        const failedN = Number(counts.failed) || 0
        const doneN = Number(counts.done) || 0
        const icon = failedN > 0 ? '⚠️' : '✅'
        const failedLine = failedN > 0 ? `, ${failedN} failed` : ''
        // Alert goes to whoever this company nominated (companies.ops_alert_telegram_id),
        // not to one hardcoded person - see api/lib/ops-alerts.ts
        const alertTelegramId = await getOpsAlertTelegramId(batch.company_id as string | null)
        await sendViaOpenClaw({
          channel: 'telegram', to: alertTelegramId,
          message: `${icon} Batch "${batch.name}" finished - ${doneN} sent${failedLine}.`,
        }).catch((err) => console.error('[documents] batch-complete telegram notify failed:', err))
      }
    }
    // else: stopped early (paused) - status stays 'generating', paused=true distinguishes
    // "intentionally paused" from "process died"; both are resumed the same way.
  } finally {
    await browser.close()
  }
}

// Legacy entry point - kept so existing callers (api/routes/mcp.ts,
// api/routes/hiring.ts, api/routes/hiring-batches.ts) don't need to change.
// Persists `recipients` into document_batch_items up front (same durability
// as the main /generate route below) then delegates to the resumable core loop.
export async function runBatch(
  batchId:      string,
  template:     Record<string, unknown>,
  recipients:   Record<string, string>[],
  sendEmail:    boolean,
  emailSubject?: string,
  emailMessage?: string,
  emailDesignId?: string,
): Promise<string[]> {
  await query(
    `UPDATE document_batches SET send_email = $1, email_subject = $2, email_message = $3, email_design_id = $4 WHERE id = $5`,
    [sendEmail, emailSubject ?? null, emailMessage ?? null, emailDesignId ?? null, batchId]
  )
  if (recipients.length) {
    const placeholders = recipients.map((_, i) => `($1,$${i * 2 + 2},$${i * 2 + 3})`).join(',')
    const values = recipients.flatMap((r, i) => [i, JSON.stringify(r)])
    await query(
      `INSERT INTO document_batch_items (batch_id, seq, recipient_data) VALUES ${placeholders}`,
      [batchId, ...values]
    )
  }
  await runPendingItems(batchId)
  const { rows } = await query(`SELECT document_generated_id FROM document_batch_items WHERE batch_id = $1 AND document_generated_id IS NOT NULL`, [batchId])
  return rows.map(r => r.document_generated_id as string)
}

// ── Resume / pause / items / duplicate ────────────────────────────────────────

app.post('/api/documents/batches/:id/resume', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows: [batch] } = await query(`SELECT * FROM document_batches WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  await query(`UPDATE document_batches SET paused = false, error_message = NULL WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'document_batches', op: 'update', id, before: { paused: batch.paused }, after: { paused: false }, companyId: batch.company_id,
  })

  runPendingItems(id).catch((err: Error) => console.error('[documents] resume failed:', err))
  return c.json({ ok: true })
})

app.post('/api/documents/batches/:id/pause', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows: [existing] } = await query(`SELECT company_id, paused FROM document_batches WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!existing) return c.json({ error: 'Batch not found' }, 404)

  await query(`UPDATE document_batches SET paused = true WHERE id = $1`, [id])

  await writeMutationAuditLog(c, {
    table: 'document_batches', op: 'update', id, before: { paused: existing.paused }, after: { paused: true }, companyId: existing.company_id,
  })

  return c.json({ ok: true })
})

app.get('/api/documents/batches/:id/items', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') as string
  const { rows: [batch] } = await query(`SELECT id FROM document_batches WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  const { rows } = await query(
    `SELECT bi.id, bi.seq, bi.recipient_data, bi.status, bi.error_message, bi.document_generated_id,
            dg.email_sent, (dg.pdf_path IS NOT NULL) AS has_pdf,
            dg.status AS lifecycle_status, dg.viewed_at, dg.acknowledged_at
     FROM document_batch_items bi
     LEFT JOIN document_generated dg ON dg.id = bi.document_generated_id
     WHERE bi.batch_id = $1 ORDER BY bi.seq ASC`,
    [id]
  )
  return c.json({ items: rows })
})

// Starts a new batch from the recipients of an old one - defaults to only
// those NOT already 'done' (the actual "retry the stragglers" use case after
// an interruption); pass ?all=true to duplicate everyone.
app.post('/api/documents/batches/:id/duplicate', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const id = c.req.param('id') as string
  const includeAll = c.req.query('all') === 'true'

  const { rows: [source] } = await query(`SELECT * FROM document_batches WHERE id = $1 AND company_id = ANY($2)`, [id, companyIds])
  if (!source) return c.json({ error: 'Batch not found' }, 404)

  const { rows: items } = await query(
    `SELECT recipient_data FROM document_batch_items WHERE batch_id = $1 ${includeAll ? '' : "AND status != 'done'"} ORDER BY seq ASC`,
    [id]
  )
  if (items.length === 0) return c.json({ error: includeAll ? 'No recipients to copy' : 'Nothing pending - everyone already received this batch' }, 400)

  const { rows: [batch] } = await query(
    `INSERT INTO document_batches
       (template_id, company_id, name, status, total_count, send_email, email_subject, email_message, email_design_id, extra_attachment_ids, created_by)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [source.template_id, source.company_id, `${source.name as string} (retry)`,
     items.length, source.send_email, source.email_subject, source.email_message, source.email_design_id, source.extra_attachment_ids ?? [], userId]
  )

  const placeholders = items.map((_, i) => `($1,$${i * 2 + 2},$${i * 2 + 3})`).join(',')
  const values = items.flatMap((r, i) => [i, JSON.stringify(r.recipient_data)])
  await query(`INSERT INTO document_batch_items (batch_id, seq, recipient_data) VALUES ${placeholders}`, [batch.id, ...values])

  await writeMutationAuditLog(c, {
    table: 'document_batches', op: 'create', id: batch.id, after: batch, companyId: batch.company_id,
  })

  runPendingItems(batch.id as string).catch((err: Error) => console.error('[documents] duplicate-batch run failed:', err))
  return c.json({ batch_id: batch.id }, 201)
})

export default app
