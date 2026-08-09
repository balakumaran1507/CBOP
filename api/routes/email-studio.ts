import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import '../lib/hono-vars'
import * as fs from 'fs'
import * as path from 'path'
import {
  renderDesignHtml, extractVariables, sendDesignEmail,
  type EmailDesignRow,
} from '../lib/email-designs'
import { buildTemplateEmail, SAMPLE_VARS } from './templates'

const app = new Hono()

const IMG_DIR = path.join(process.cwd(), 'uploads', 'template-images')

function rowToDesign(row: Record<string, unknown>): EmailDesignRow {
  return {
    id:           row.id as string,
    company_id:   (row.company_id as string) ?? null,
    name:         row.name as string,
    subject:      (row.subject as string) ?? '',
    design_json:  row.design_json ?? null,
    html:         (row.html as string) ?? null,
    text:         (row.text as string) ?? null,
    category:     (row.category as string) ?? null,
    content_mode: (row.content_mode as 'richtext' | 'html') ?? 'richtext',
    variables:    (row.variables as string[]) ?? [],
    is_global:    Boolean(row.is_global),
    slug:         (row.slug as string) ?? null,
  }
}

// ── GET /api/email-designs ────────────────────────────────────────────────────
app.get('/api/email-designs', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const category = c.req.query('category')
  const search   = c.req.query('search')

  const conditions: string[] = ['(company_id = ANY($1) OR is_global = true)']
  const params: unknown[] = [companyIds]
  if (category) { params.push(category); conditions.push(`category = $${params.length}`) }
  if (search)   { params.push(`%${search}%`); conditions.push(`name ILIKE $${params.length}`) }

  const { rows } = await query(
    `SELECT ed.*, c.name AS company_name
     FROM email_designs ed
     LEFT JOIN companies c ON c.id = ed.company_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ed.updated_at DESC`,
    params
  )
  return c.json({ designs: rows })
})

// ── GET /api/email-designs/attachable-pdfs ────────────────────────────────────
// Lists recently generated Document Studio PDFs (api/routes/documents.ts) that
// can be attached to a design send - optionally scoped to one batch.
app.get('/api/email-designs/attachable-pdfs', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const batchId = c.req.query('batch_id')

  const conditions = ['db.company_id = ANY($1)', 'dg.pdf_path IS NOT NULL']
  const params: unknown[] = [companyIds]
  if (batchId) { params.push(batchId); conditions.push(`dg.batch_id = $${params.length}`) }

  const { rows } = await query(
    `SELECT dg.id, dg.recipient_name, dg.recipient_email, dg.created_at,
            db.name AS batch_name, dt.name AS template_name
     FROM document_generated dg
     JOIN document_batches db ON db.id = dg.batch_id
     JOIN document_templates dt ON dt.id = dg.template_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY dg.created_at DESC LIMIT 200`,
    params
  )
  return c.json({ pdfs: rows })
})

// ── GET /api/email-send-log ────────────────────────────────────────────────────
app.get('/api/email-send-log', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const kind   = c.req.query('kind')
  const status = c.req.query('status')

  const conditions: string[] = ['(esl.company_id = ANY($1) OR esl.company_id IS NULL)']
  const params: unknown[] = [companyIds]
  if (kind)   { params.push(kind);   conditions.push(`esl.kind = $${params.length}`) }
  if (status) { params.push(status); conditions.push(`esl.status = $${params.length}`) }

  const { rows } = await query(
    `SELECT esl.id, esl.company_id, esl.kind, esl.to_email, esl.from_email, esl.subject,
            esl.status, esl.spam_score, esl.reason, esl.message_id, esl.created_at,
            esl.design_id, esl.attachment_refs, (esl.rendered_html IS NOT NULL) AS has_snapshot,
            esl.opened_at, esl.open_count, esl.clicked_at, esl.click_count,
            ed.name AS design_name
     FROM email_send_log esl
     LEFT JOIN email_designs ed ON ed.id = esl.design_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY esl.created_at DESC LIMIT 300`,
    params
  )
  return c.json({ log: rows })
})

// Full detail including the rendered HTML snapshot - kept out of the list
// query above so a 300-row Activity page doesn't pull hundreds of full email
// bodies over the wire; fetched on demand when you actually want to see one.
app.get('/api/email-send-log/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rows: [row] } = await query(
    `SELECT esl.*, ed.name AS design_name
     FROM email_send_log esl
     LEFT JOIN email_designs ed ON ed.id = esl.design_id
     WHERE esl.id = $1 AND (esl.company_id = ANY($2) OR esl.company_id IS NULL)`,
    [id, companyIds]
  )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ entry: row })
})

// ── GET /api/email-designs/:id ────────────────────────────────────────────────
app.get('/api/email-designs/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const { rows } = await query(
    `SELECT * FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (rows.length === 0) return c.json({ error: 'Design not found' }, 404)

  const { rows: assets } = await query(
    `SELECT * FROM email_design_assets WHERE design_id = $1 ORDER BY created_at DESC`,
    [id]
  )
  return c.json({ design: rows[0], assets })
})

// ── GET /api/email-designs/:id/render ─────────────────────────────────────────
// Compiled HTML for a design with merge tags left literal ({{var}}) - used by
// callers (e.g. Campaigns) that want to load a design as an editable starting
// point rather than sending it as-is.
app.get('/api/email-designs/:id/render', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rows } = await query(
    `SELECT * FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (rows.length === 0) return c.json({ error: 'Design not found' }, 404)
  const design = rowToDesign(rows[0])
  const html = renderDesignHtml(design, {})
  return c.json({ html, subject: design.subject })
})

// ── POST /api/email-designs ───────────────────────────────────────────────────
app.post('/api/email-designs', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json() as Partial<EmailDesignRow> & { company_id?: string | null }

  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (body.company_id && !companyIds.includes(body.company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!body.company_id && !body.is_global) return c.json({ error: 'company_id is required unless is_global' }, 400)

  const contentMode = body.content_mode === 'html' ? 'html' : 'richtext'
  const vars = extractVariables({ content_mode: contentMode, design_json: body.design_json ?? null, html: body.html ?? null })

  const { rows: [design] } = await query(
    `INSERT INTO email_designs
       (company_id, name, subject, design_json, html, text, category, content_mode, variables, is_global, slug)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      body.company_id ?? null, body.name.trim(), body.subject ?? '',
      body.design_json ? JSON.stringify(body.design_json) : null, body.html ?? null, body.text ?? null,
      body.category ?? 'transactional', contentMode, vars, Boolean(body.is_global), body.slug ?? null,
    ]
  )
  await query(`UPDATE email_designs SET updated_by = $1 WHERE id = $2`, [userId, design.id])
  return c.json({ design }, 201)
})

// ── PATCH /api/email-designs/:id ──────────────────────────────────────────────
app.patch('/api/email-designs/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const { rows: existingRows } = await query(
    `SELECT * FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (existingRows.length === 0) return c.json({ error: 'Design not found' }, 404)

  const body = await c.req.json() as Partial<EmailDesignRow>
  const merged: EmailDesignRow = { ...rowToDesign(existingRows[0]), ...body }
  const vars = extractVariables({ content_mode: merged.content_mode, design_json: merged.design_json ?? null, html: merged.html ?? null })

  const { rows: [design] } = await query(
    `UPDATE email_designs SET
       name = $1, subject = $2, design_json = $3, html = $4, text = $5,
       category = $6, content_mode = $7, variables = $8, thumbnail_url = $9,
       is_global = $10, slug = $11, updated_by = $12, updated_at = NOW()
     WHERE id = $13 RETURNING *`,
    [
      merged.name, merged.subject ?? '', merged.design_json ? JSON.stringify(merged.design_json) : null,
      merged.html ?? null, merged.text ?? null, merged.category ?? 'transactional',
      merged.content_mode, vars, (body as { thumbnail_url?: string }).thumbnail_url ?? null,
      merged.is_global, merged.slug ?? null, userId, id,
    ]
  )
  return c.json({ design })
})

// ── DELETE /api/email-designs/:id ─────────────────────────────────────────────
app.delete('/api/email-designs/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rowCount } = await query(
    `DELETE FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (rowCount === 0) return c.json({ error: 'Design not found' }, 404)
  return c.json({ ok: true })
})

// ── POST /api/email-designs/import-from-template/:templateId ─────────────────
// One-time bridge: snapshots a Document Studio email template (api/routes/templates.ts,
// output_type='email') into a new Email Studio design.
app.post('/api/email-designs/import-from-template/:templateId', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const templateId = c.req.param('templateId')

  const { rows } = await query(
    `SELECT t.*, c.name AS company_name FROM templates t
     JOIN companies c ON c.id = t.company_id
     WHERE t.id = $1 AND t.company_id = ANY($2)`,
    [templateId, companyIds]
  )
  if (rows.length === 0) return c.json({ error: 'Template not found' }, 404)
  const template = rows[0]
  if (template.output_type !== 'email' && template.output_type !== 'both') {
    return c.json({ error: 'Template is not an email-output template' }, 400)
  }

  const html = await buildTemplateEmail(template, SAMPLE_VARS)
  const vars = extractVariables({ content_mode: 'html', design_json: null, html })

  const { rows: [design] } = await query(
    `INSERT INTO email_designs
       (company_id, name, subject, html, category, content_mode, variables, source_template_id, updated_by)
     VALUES ($1,$2,$3,$4,'transactional','html',$5,$6,$7)
     RETURNING *`,
    [template.company_id, `${template.name as string} (imported)`, template.name as string, html, vars, templateId, userId]
  )
  return c.json({ design }, 201)
})

// ── POST /api/email-studio/upload-html ────────────────────────────────────────
// Multipart: `html` text field (raw HTML, pasted or from an uploaded .html file)
// + zero or more `images` files. Rewrites any relative/unresolved <img src="...">
// reference that matches an uploaded file's name to a hosted /api/uploads/ URL.
// Anything that doesn't match comes back in `missingRefs` for the client to resolve.
// Not tied to a design id - a design may not exist yet when composing in HTML
// mode (the editor calls this before the first Save), and image asset rows
// don't need a design_id to be useful (they're addressed by URL, not owner).
app.post('/api/email-studio/upload-html', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const formData = await c.req.formData()
  const rawHtml = formData.get('html')
  if (typeof rawHtml !== 'string' || !rawHtml.trim()) return c.json({ error: 'html field is required' }, 400)

  // Optional - set when re-uploading assets into an already-saved design, so
  // email_design_assets can track "what's attached to this design".
  const designId = formData.get('design_id')

  const imageFiles = formData.getAll('images').filter((f): f is File => f instanceof File)
  const byBasename = new Map<string, File>()
  for (const f of imageFiles) byBasename.set(path.basename(f.name).toLowerCase(), f)

  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true })

  const refRe = /(?:src|href)="([^"]+)"/g
  const missingRefs = new Set<string>()
  const seen = new Set<string>()
  let html = rawHtml

  for (const m of rawHtml.matchAll(refRe)) {
    const ref = m[1]
    if (seen.has(ref)) continue
    if (/^(https?:|data:|\/api\/uploads\/|cid:)/i.test(ref)) continue
    seen.add(ref)
    const base = path.basename(ref).toLowerCase()
    const file = byBasename.get(base)
    if (!file) { missingRefs.add(ref); continue }

    const ext   = base.split('.').pop() ?? 'png'
    const fname = `${crypto.randomUUID()}.${ext}`
    const buf   = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(path.join(IMG_DIR, fname), buf)
    const url = `/api/uploads/template-images/${fname}`
    html = html.split(`"${ref}"`).join(`"${url}"`)
    if (typeof designId === 'string' && designId) {
      await query(
        `INSERT INTO email_design_assets (design_id, kind, original_name, url) VALUES ($1,'image',$2,$3)`,
        [designId, file.name, url]
      )
    }
  }

  return c.json({ html, missingRefs: [...missingRefs] })
})

// ── POST /api/email-designs/:id/test-send ─────────────────────────────────────
app.post('/api/email-designs/:id/test-send', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  const { rows } = await query(
    `SELECT * FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (rows.length === 0) return c.json({ error: 'Design not found' }, 404)
  const design = rowToDesign(rows[0])

  const { rows: [user] } = await query(`SELECT email FROM users WHERE id = $1`, [userId])
  const to = user?.email as string
  if (!to) return c.json({ error: 'Could not resolve your account email' }, 500)

  const result = await sendDesignEmail({ design, to, vars: SAMPLE_VARS, kind: 'transactional' })
  if (!result.ok) return c.json({ error: result.reason ?? 'Send failed' }, 502)
  return c.json({ ok: true, messageId: result.messageId })
})

// ── POST /api/email-designs/:id/send ──────────────────────────────────────────
// Direct small-batch send (not the bulk campaign pipeline - see api/routes/email-campaigns.ts
// for list-based bulk sends, which Campaigns wires up to designs in Phase C).
app.post('/api/email-designs/:id/send', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')

  const { rows } = await query(
    `SELECT * FROM email_designs WHERE id = $1 AND (company_id = ANY($2) OR is_global = true)`,
    [id, companyIds]
  )
  if (rows.length === 0) return c.json({ error: 'Design not found' }, 404)
  const design = rowToDesign(rows[0])

  const body = await c.req.json() as {
    recipients: {
      to: string; vars?: Record<string, string>
      /** any number of already-generated PDFs to attach - the multi-PDF-attach feature */
      document_generated_ids?: string[]
      /** any number of reusable library attachments (email_attachments) to attach */
      attachment_ids?: string[]
    }[]
  }
  if (!body.recipients?.length) return c.json({ error: 'recipients is required' }, 400)
  if (body.recipients.length > 25) return c.json({ error: 'Direct send is capped at 25 recipients - use Campaigns for larger lists' }, 400)

  const pdfDir = path.join(process.cwd(), 'uploads', 'document-pdfs')
  const attachmentDir = path.join(process.cwd(), 'uploads', 'email-attachments')

  const results = []
  for (const r of body.recipients) {
    const attachments: { filename: string; content: Buffer; contentType?: string }[] = []
    const attachmentRefs: unknown[] = []

    for (const docId of r.document_generated_ids ?? []) {
      const { rows: [doc] } = await query(
        `SELECT dg.pdf_path, dg.recipient_name FROM document_generated dg
         JOIN document_batches db ON db.id = dg.batch_id
         WHERE dg.id = $1 AND db.company_id = ANY($2)`,
        [docId, companyIds]
      )
      if (doc?.pdf_path) {
        const buf = fs.readFileSync(path.join(pdfDir, doc.pdf_path as string))
        attachments.push({ filename: `${(doc.recipient_name as string) || 'document'}.pdf`, content: buf, contentType: 'application/pdf' })
        attachmentRefs.push({ type: 'document_generated', id: docId })
      }
    }

    for (const attId of r.attachment_ids ?? []) {
      const { rows: [att] } = await query(
        `SELECT name, file_path, mime_type FROM email_attachments WHERE id = $1 AND (company_id = ANY($2) OR company_id IS NULL)`,
        [attId, companyIds]
      )
      if (att) {
        try {
          const buf = fs.readFileSync(path.join(attachmentDir, att.file_path as string))
          attachments.push({ filename: att.name as string, content: buf, contentType: (att.mime_type as string) || undefined })
          attachmentRefs.push({ type: 'email_attachment', id: attId })
        } catch { /* file missing on disk - skip rather than fail the whole send */ }
      }
    }

    const result = await sendDesignEmail({
      design, to: r.to, vars: r.vars ?? {},
      attachments: attachments.length ? attachments : undefined,
      attachmentRefs,
      companyId: design.company_id,
    })
    results.push({ to: r.to, ok: result.ok, status: result.status, reason: result.reason })
  }

  return c.json({ results })
})

// ── Signatures ─────────────────────────────────────────────────────────────────
// Reusable rich-HTML blocks (company-scoped, or global) - inserted at the
// cursor or auto-appended when composing a design.

app.get('/api/email-signatures', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT * FROM email_signatures WHERE company_id = ANY($1) OR company_id IS NULL ORDER BY is_default DESC, name ASC`,
    [companyIds]
  )
  return c.json({ signatures: rows })
})

app.post('/api/email-signatures', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json() as { name?: string; html?: string; company_id?: string | null; is_default?: boolean }
  if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400)
  if (body.company_id && !companyIds.includes(body.company_id)) return c.json({ error: 'Forbidden' }, 403)

  if (body.is_default && body.company_id) {
    await query(`UPDATE email_signatures SET is_default = false WHERE company_id = $1`, [body.company_id])
  }
  const { rows: [sig] } = await query(
    `INSERT INTO email_signatures (company_id, name, html, is_default, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [body.company_id ?? null, body.name.trim(), body.html ?? '', Boolean(body.is_default), userId]
  )
  return c.json({ signature: sig }, 201)
})

app.patch('/api/email-signatures/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rows: existing } = await query(
    `SELECT * FROM email_signatures WHERE id = $1 AND (company_id = ANY($2) OR company_id IS NULL)`,
    [id, companyIds]
  )
  if (existing.length === 0) return c.json({ error: 'Signature not found' }, 404)
  const merged = { ...existing[0], ...await c.req.json() }

  if (merged.is_default && merged.company_id) {
    await query(`UPDATE email_signatures SET is_default = false WHERE company_id = $1 AND id != $2`, [merged.company_id, id])
  }
  const { rows: [sig] } = await query(
    `UPDATE email_signatures SET name = $1, html = $2, is_default = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
    [merged.name, merged.html ?? '', Boolean(merged.is_default), id]
  )
  return c.json({ signature: sig })
})

app.delete('/api/email-signatures/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rowCount } = await query(
    `DELETE FROM email_signatures WHERE id = $1 AND (company_id = ANY($2) OR company_id IS NULL)`,
    [id, companyIds]
  )
  if (rowCount === 0) return c.json({ error: 'Signature not found' }, 404)
  return c.json({ ok: true })
})

// ── Attachment library ────────────────────────────────────────────────────────
// Upload once, reuse across many sends - a company brochure, T&Cs, price list -
// without re-uploading per batch. See also document_batches.extra_attachment_ids
// (api/routes/documents.ts) for "attach these to every email in this batch".

const ATTACHMENT_DIR = path.join(process.cwd(), 'uploads', 'email-attachments')

app.get('/api/email-attachments', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const { rows } = await query(
    `SELECT ea.*, c.name AS company_name FROM email_attachments ea
     LEFT JOIN companies c ON c.id = ea.company_id
     WHERE ea.company_id = ANY($1) OR ea.company_id IS NULL
     ORDER BY ea.created_at DESC`,
    [companyIds]
  )
  return c.json({ attachments: rows })
})

app.post('/api/email-attachments', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]
  const formData = await c.req.formData()
  const file = formData.get('file')
  const name = formData.get('name')
  const companyId = formData.get('company_id')
  if (!(file instanceof File)) return c.json({ error: 'file is required' }, 400)
  if (companyId && typeof companyId === 'string' && !companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)
  if (file.size > 20 * 1024 * 1024) return c.json({ error: 'Max 20 MB' }, 400)

  if (!fs.existsSync(ATTACHMENT_DIR)) fs.mkdirSync(ATTACHMENT_DIR, { recursive: true })
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const fname = `${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(ATTACHMENT_DIR, fname), buf)

  const { rows: [attachment] } = await query(
    `INSERT INTO email_attachments (company_id, name, file_path, mime_type, size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [typeof companyId === 'string' && companyId ? companyId : null, (typeof name === 'string' && name.trim()) || file.name, fname, file.type || null, file.size, userId]
  )
  return c.json({ attachment }, 201)
})

app.delete('/api/email-attachments/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const { rows: [existing] } = await query(
    `SELECT file_path FROM email_attachments WHERE id = $1 AND (company_id = ANY($2) OR company_id IS NULL)`,
    [id, companyIds]
  )
  if (!existing) return c.json({ error: 'Attachment not found' }, 404)
  const { rowCount } = await query(`DELETE FROM email_attachments WHERE id = $1`, [id])
  if (rowCount === 0) return c.json({ error: 'Attachment not found' }, 404)
  fs.unlink(path.join(ATTACHMENT_DIR, existing.file_path as string), () => {})
  return c.json({ ok: true })
})

export default app
