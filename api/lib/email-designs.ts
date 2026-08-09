import * as path from 'path'
import * as fsPromises from 'fs/promises'
import { type TiptapNode, collectFontFamilies, renderTiptapNode } from './tiptap-render'
import { buildGoogleFontsImportCss } from './fonts'
import { sendEmail, resolveFromForCompany, type SendEmailAttachment, type SendResult } from './mailer'
import { query } from './db'

// ═════════════════════════════════════════════════════════════════════════════
// Email Studio's render + send library. Every outbound email in CBOP that's
// authored as a reusable "design" (campaign, hiring, transactional, document,
// internal) goes through renderDesignHtml() → inlineImagesAsBase64() →
// sendEmail() (api/lib/mailer.ts), via sendDesignEmail() below.
// ═════════════════════════════════════════════════════════════════════════════

export interface EmailDesignRow {
  id: string
  company_id: string | null
  name: string
  subject: string | null
  design_json: unknown | null   // Tiptap doc JSON, content_mode='richtext'
  html: string | null           // raw HTML, content_mode='html'
  text: string | null
  category: string | null
  content_mode: 'richtext' | 'html'
  variables: string[]
  is_global: boolean
  slug?: string | null          // stable lookup key for transactional code paths (hiring, n8n)
}

// ── Variable substitution ─────────────────────────────────────────────────────
// Matches the fillTags()/applyMergeTags() convention used elsewhere (documents.ts,
// email-campaigns.ts): unresolved {{var}} is left visible rather than blanked,
// so a missing merge column is obvious instead of silently disappearing.
function fillVars(raw: string, vars: Record<string, string>): string {
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}

function wrapIfFragment(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body>${html}</body></html>`
}

function buildRichEmailHtml(bodyHtml: string, fontsUsed: string[]): string {
  const fontImport = buildGoogleFontsImportCss(fontsUsed, [{ name: 'Inter', weights: '300;400;500;600;700' }])
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  ${fontImport}
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:#F8F9FA; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif; font-size:15px; line-height:1.7; color:#1a1a1a; }
  .es-wrap { max-width:600px; margin:0 auto; padding:32px 24px; background:#ffffff; }
  p { margin:0 0 14px; }
  h1,h2,h3 { margin:0 0 12px; line-height:1.3; }
  ul, ol { padding-left:22px; margin:0 0 14px; }
  img { max-width:100%; height:auto; }
  a { color:#0073BB; }
  table { border-collapse: collapse; }
  .var-chip { background:#FEF3C7; color:#92400E; border-radius:3px; padding:0 4px; font-size:0.9em; }
</style>
</head>
<body><div class="es-wrap">${bodyHtml}</div></body>
</html>`
}

/** Renders a design (either authoring mode) into full, sendable email HTML with vars filled in. */
export function renderDesignHtml(design: EmailDesignRow, vars: Record<string, string> = {}): string {
  if (design.content_mode === 'html') {
    return wrapIfFragment(fillVars(design.html ?? '', vars))
  }
  const json = design.design_json as TiptapNode | null
  if (!json) return wrapIfFragment('')
  const bodyHtml  = renderTiptapNode(json, vars, 'email')
  const fontsUsed = collectFontFamilies(json)
  return buildRichEmailHtml(bodyHtml, fontsUsed)
}

/** Detects {{var}} placeholders in a design - from Tiptap `variable` nodes in richtext mode, or a regex scan in html mode. */
export function extractVariables(design: Pick<EmailDesignRow, 'content_mode' | 'design_json' | 'html'>): string[] {
  if (design.content_mode === 'html') {
    const found = new Set<string>()
    const re = /\{\{(\w+)\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(design.html ?? ''))) found.add(m[1])
    return [...found]
  }
  const found = new Set<string>()
  const walk = (node: TiptapNode) => {
    if (node.type === 'variable' && node.attrs?.variable) found.add(String(node.attrs.variable))
    for (const child of node.content ?? []) walk(child)
  }
  if (design.design_json) walk(design.design_json as TiptapNode)
  return [...found]
}

/**
 * Rewrites every /api/uploads/... <img src> into a base64 data: URI so the
 * email renders images with no dependency on CBOP being internet-reachable
 * or the recipient's client fetching remote images. Missing files are left
 * as-is (a broken image is recoverable; a thrown send is not).
 */
export async function inlineImagesAsBase64(html: string): Promise<string> {
  const re = /src="(\/api\/uploads\/[^"]+)"/g
  const seen = new Map<string, string>()
  for (const m of html.matchAll(re)) {
    const srcAttr = m[1]
    if (seen.has(srcAttr)) continue
    const rel = srcAttr.replace(/^\/api\/uploads\//, '')
    try {
      const buf = await fsPromises.readFile(path.join(process.cwd(), 'uploads', rel))
      const ext = rel.split('.').pop()?.toLowerCase() ?? 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
      seen.set(srcAttr, `data:${mime};base64,${buf.toString('base64')}`)
    } catch { /* file missing on disk - leave the original src */ }
  }
  let out = html
  for (const [srcAttr, dataUri] of seen) {
    out = out.split(`src="${srcAttr}"`).join(`src="${dataUri}"`)
  }
  return out
}

export interface SendDesignEmailOptions {
  design: EmailDesignRow
  to: string
  vars?: Record<string, string>
  attachments?: SendEmailAttachment[]
  attachmentRefs?: unknown[]
  companyId?: string | null
  kind?: string
}

/** The one function every integration point (Documents, Campaigns, Hiring, internal/n8n) should call to send a design. */
export async function sendDesignEmail(opts: SendDesignEmailOptions): Promise<SendResult> {
  const vars = opts.vars ?? {}
  const rawHtml = renderDesignHtml(opts.design, vars)
  const html    = await inlineImagesAsBase64(rawHtml)
  const subject = fillVars(opts.design.subject ?? '', vars)
  const companyId = opts.companyId ?? opts.design.company_id ?? null

  // Route by company - without this, every design send falls back to the
  // generic transactional sender regardless of which company it's for (this
  // shipped broken: a 156-recipient Ouantum batch sent all its certificates
  // from the default CBOP address instead of founders@ouantum.com).
  let from: string | undefined
  if (companyId) {
    const { rows: [company] } = await query(`SELECT name FROM companies WHERE id = $1`, [companyId])
    from = (await resolveFromForCompany(companyId, company?.name as string | undefined)) ?? undefined
  }

  return sendEmail({
    to: opts.to,
    subject,
    html,
    from,
    attachments: opts.attachments,
    companyId,
    kind: opts.kind ?? opts.design.category ?? 'transactional',
    designId: opts.design.id,
    attachmentRefs: opts.attachmentRefs ?? (opts.attachments ?? []).map(a => ({ filename: a.filename })),
    respectSuppression: true,
  })
}
