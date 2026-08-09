import { Hono } from 'hono'
import { sendEmail, companyIdForDomain } from '../lib/mailer'
import { query } from '../lib/db'
import { renderDesignHtml, inlineImagesAsBase64, type EmailDesignRow } from '../lib/email-designs'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PostalMime = require('postal-mime') as { new(): { parse(raw: Buffer | string): Promise<{ text?: string; html?: string; attachments: Array<{ filename?: string; mimeType: string; content: Buffer }> }> } }

const app = new Hono()

const HIRING_KEYWORDS = /internship|apply|application|intern|hiring|resume|cv/i

// Domains and patterns that are never human applicants
const SENDER_BLOCKLIST = /noreply|no-reply|donotreply|notifications?@|@google\.com$|@linkedin\.com$|@slackhq\.com$|@youtube\.com$|@calendly\.com$|@mailchimp\.com$|@sendgrid\.net$/i

// Inbox email domain → company_id is resolved from the email_domains table via
// companyIdForDomain() (api/lib/mailer.ts) - single shared source, same table
// that drives outbound From-address resolution. Register new domains there
// (or via a future email_domains admin UI), not as a literal here.

// All configured hiring inboxes. Entries with PLACEHOLDER passwords are skipped.
function getHiringInboxes() {
  const entries = [
    { user: process.env.SMTP_USER_CYBERCOM,   pass: process.env.SMTP_PASS_CYBERCOM   },
    { user: process.env.SMTP_OUANTUM_USER,    pass: process.env.SMTP_OUANTUM_PASS    },
    { user: process.env.SMTP_USER_ETHERENCE,  pass: process.env.SMTP_PASS_ETHERENCE  },
    { user: process.env.SMTP_USER_ATTACKOS,   pass: process.env.SMTP_PASS_ATTACKOS   },
    { user: process.env.SMTP_ZAPSTERS_USER,   pass: process.env.SMTP_ZAPSTERS_PASS   },
  ]
  return entries.filter(
    e => e.user && e.pass && !e.pass.startsWith('PLACEHOLDER'),
  ) as { user: string; pass: string }[]
}

// Extract a Google Drive / Dropbox / OneDrive file share URL from email text/HTML.
// These appear when candidates use "Insert from Drive" instead of attaching a file.
// Handles multiple Drive URL formats:
//   drive.google.com/file/d/ID/view   (standard share link)
//   drive.google.com/open?id=ID       (older "open" format - common in Gmail chips)
//   docs.google.com/document/d/ID     (Google Docs resume)
function extractDriveUrl(text: string, html?: string): string | null {
  const combined = (html ?? '') + '\n' + text
  const m = combined.match(/https:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)[^\s"'<>]+|docs\.google\.com\/(?:document|presentation)\/d\/[^\s"'<>]+|www\.dropbox\.com\/[^\s"'<>]+|1drv\.ms\/[^\s"'<>]+|onedrive\.live\.com\/[^\s"'<>]+)/)
  if (!m) return null
  return m[0].replace(/[)>\]'".,;]+$/, '')
}

// Parse a raw MIME email buffer/string using postal-mime.
// Returns plain text body, HTML body, Drive URL (if no binary attachment), and binary attachments.
async function parseMime(raw: Buffer | string): Promise<{
  text: string
  driveUrl: string | null
  attachments: Array<{ filename: string; ext: string; data: Buffer }>
}> {
  const parser = new PostalMime()
  const parsed = await parser.parse(raw)
  const text = parsed.text ?? parsed.html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
  const attachments = parsed.attachments
    .filter(a => /pdf|word|msword|openxmlformats|octet-stream/i.test(a.mimeType) || /\.(pdf|doc|docx)$/i.test(a.filename ?? ''))
    .filter(a => {
      if (!a.content) return false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = a.content as any
      const size = typeof c.byteLength === 'number' ? c.byteLength : (c.length ?? 0)
      return size > 500
    })
    .map(a => {
      const ext = /\.pdf$/i.test(a.filename ?? '') ? '.pdf'
               : /\.docx$/i.test(a.filename ?? '') ? '.docx'
               : /\.doc$/i.test(a.filename ?? '') ? '.doc'
               : a.mimeType.includes('pdf') ? '.pdf' : '.docx'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { filename: a.filename ?? 'resume', ext, data: Buffer.from(a.content as any) }
    })
  // Only extract Drive URL if no binary attachment found
  const driveUrl = attachments.length === 0 ? extractDriveUrl(text, parsed.html ?? '') : null
  return { text, driveUrl, attachments }
}

// ── GET /api/internal/hiring-emails ─────────────────────────────────────────
// Checks all configured hiring inboxes (skips any with PLACEHOLDER passwords).
// Returns unread hiring emails with their IMAP UIDs and company_id derived from
// the inbox domain. Does NOT mark emails as read - n8n calls /mark-email-read
// after each successful ingest so a failed ingest doesn't silently drop the email.
app.get('/api/internal/hiring-emails', async (c) => {
  const secret = c.req.header('x-n8n-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: unknown) => any }

  const inboxes = getHiringInboxes()
  const emails: Array<{ uid: number; inbox: string; mailbox: string; company_id: string | null; from: string; subject: string; text: string; date: string }> = []

  for (const inbox of inboxes) {
    const client = new ImapFlow({
      host:              'imap.gmail.com',
      port:              993,
      secure:            true,
      auth:              { user: inbox.user, pass: inbox.pass.replace(/\s/g, '') },
      logger:            false,
      tls:               { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     20000,
    })

    try {
      await client.connect()

      // Scan both INBOX and Spam - legitimate resumes often land in spam
      for (const mailbox of ['INBOX', '[Gmail]/Spam']) {
        let lock: { release: () => void } | null = null
        try {
          lock = await client.getMailboxLock(mailbox)
          const since = new Date(Date.now() - 48 * 60 * 60 * 1000)
          const uids: number[] = await client.search({ seen: false, since }, { uid: true }) ?? []

          for (const uid of uids) {
            const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
            if (!msg) continue
            const subject: string = msg.envelope?.subject ?? ''

            const fromAddr = msg.envelope?.from?.[0]
            const fromStr: string = fromAddr?.address
              ? `${fromAddr.name ?? ''} <${fromAddr.address}>`.trim()
              : fromAddr?.name ?? ''

            const rawBuf = msg.source ?? Buffer.alloc(0)
            const { text } = await parseMime(rawBuf)

            // Check subject AND body - catches blank subjects and recruiter-forwarded emails
            if (!HIRING_KEYWORDS.test(subject) && !HIRING_KEYWORDS.test(text)) continue

            emails.push({
              uid,
              inbox:      inbox.user,
              mailbox,
              company_id: await companyIdForDomain(inbox.user),
              from:       fromStr,
              subject,
              text,
              date:       msg.envelope?.date?.toISOString() ?? new Date().toISOString(),
            })
          }
        } catch (mbErr: unknown) {
          // Spam folder may not exist on all accounts - log and continue to next mailbox
          console.error(`[hiring-emails] mailbox ${mailbox} failed for ${inbox.user}:`, mbErr instanceof Error ? mbErr.message : mbErr)
        } finally {
          lock?.release()
        }
      }

      await client.logout()
    } catch (err: unknown) {
      // Log and continue - one broken inbox shouldn't block the others
      console.error(`[hiring-emails] IMAP failed for ${inbox.user}:`, err instanceof Error ? err.message : err)
    }
  }

  return c.json({ count: emails.length, emails })
})

// ── POST /api/internal/mark-email-read ───────────────────────────────────────
// Called by n8n after each successful ingest to mark the email as Seen.
// Keeping mark-as-read separate from fetch means a failed ingest never
// silently drops the email - it will be retried on the next run.
app.post('/api/internal/mark-email-read', async (c) => {
  const secret = c.req.header('x-n8n-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { uid, inbox, mailbox = 'INBOX' } = await c.req.json()
  if (!uid) return c.json({ error: 'uid required' }, 400)

  // Find the right credentials for this inbox
  const inboxes = getHiringInboxes()
  const target  = inbox ? inboxes.find(i => i.user === inbox) : inboxes[0]
  if (!target) return c.json({ error: 'inbox not configured' }, 400)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: unknown) => any }

  const client = new ImapFlow({
    host:              'imap.gmail.com',
    port:              993,
    secure:            true,
    auth:              { user: target.user, pass: target.pass.replace(/\s/g, '') },
    logger:            false,
    tls:               { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     20000,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock(mailbox)
    try {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
    await client.logout()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: `IMAP failed: ${msg}` }, 502)
  }

  return c.json({ ok: true, uid })
})

function extractApplicantInfo(fromStr: string, bodyText: string): { name: string; email: string; phone: string | null } {
  const emailMatch = fromStr.match(/<([^>]+)>/)
  const email = (emailMatch ? emailMatch[1] : fromStr).trim().toLowerCase()
  const nameRaw = fromStr.replace(/<[^>]+>/, '').replace(/["']/g, '').trim()
  const name = nameRaw || email.split('@')[0].replace(/[._+]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const phoneMatch = bodyText.match(/(?:\+91|91)[-\s]?[6-9]\d{9}|[6-9]\d{9}/)
  const phone = phoneMatch ? phoneMatch[0].replace(/[-\s]/g, '') : null
  return { name, email, phone }
}

// ── POST /api/internal/hiring/pull-gmail ─────────────────────────────────────
// The single automation endpoint for resume ingestion.
// n8n calls this on a schedule. CBOP connects to all configured inboxes,
// downloads PDF/DOCX attachments, saves them, and creates applicant records.
// Pass { since_days: 90 } once to backfill all historical resumes.
// Deduplicates by email + company_id so re-running is always safe.

app.post('/api/internal/hiring/pull-gmail', async (c) => {
  const secret = c.req.header('x-n8n-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json().catch(() => ({})) as { since_days?: number }
  const sinceDays = typeof body.since_days === 'number' ? body.since_days : 2

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: unknown) => { connect(): Promise<void>; getMailboxLock(mb: string): Promise<{ release(): void }>; search(q: unknown, opts?: unknown): Promise<number[]>; fetchOne(uid: string, what: unknown, opts?: unknown): Promise<{ envelope?: { from?: Array<{ name?: string; address?: string }>; subject?: string; date?: Date }; source?: Buffer } | undefined>; messageFlagsAdd(uid: string, flags: string[], opts?: unknown): Promise<void>; logout(): Promise<void> } }

  const resumesDir = path.join(process.cwd(), 'uploads', 'resumes')
  if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true })

  let processed = 0, created = 0, skipped = 0
  const errors: string[] = []

  for (const inbox of getHiringInboxes()) {
    const companyId = await companyIdForDomain(inbox.user)
    if (!companyId) { errors.push(`No company mapping for ${inbox.user}`); continue }

    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: inbox.user, pass: inbox.pass.replace(/\s/g, '') },
      logger: false, tls: { rejectUnauthorized: false },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    })

    try {
      await client.connect()

      for (const mailbox of ['INBOX', '[Gmail]/Spam']) {
        let lock: { release(): void } | null = null
        try {
          lock = await client.getMailboxLock(mailbox)
          const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
          const uids = await client.search({ since }, { uid: true }) ?? []

          for (const uid of uids) {
            try {
              const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
              if (!msg) continue

              const fromAddr = msg.envelope?.from?.[0]
              const fromStr = fromAddr?.address
                ? `${fromAddr.name ?? ''} <${fromAddr.address}>`.trim()
                : (fromAddr?.name ?? '')
              const subject = msg.envelope?.subject ?? ''
              const rawBuf = msg.source ?? Buffer.alloc(0)
              const { text: bodyText, driveUrl, attachments } = await parseMime(rawBuf)

              // Qualify: PDF/DOCX attachment OR Drive link OR hiring keywords
              if (attachments.length === 0 && !driveUrl && !HIRING_KEYWORDS.test(subject) && !HIRING_KEYWORDS.test(bodyText)) {
                processed++; continue
              }

              const { name, email, phone } = extractApplicantInfo(fromStr, bodyText)
              if (!email.includes('@')) { processed++; continue }
              if (SENDER_BLOCKLIST.test(email)) { processed++; continue }

              // Dedup - safe to re-run
              const { rows: existing } = await query(
                'SELECT id, resume_url FROM hiring_applicants WHERE email = $1 AND company_id = $2 LIMIT 1',
                [email, companyId]
              )

              // Save best attachment (prefer PDF); fall back to Drive URL
              let resumeUrl: string | null = null
              const best = attachments.find(a => a.ext === '.pdf') ?? attachments[0]
              if (best) {
                const fname = `resume-${Date.now()}-${email.replace(/[^a-z0-9]/gi, '_')}${best.ext}`
                fs.writeFileSync(path.join(resumesDir, fname), best.data)
                resumeUrl = `/uploads/resumes/${fname}`
              } else if (driveUrl) {
                resumeUrl = driveUrl
              }

              // Existing record: only backfill resume if it was missing
              if (existing.length > 0) {
                if (!existing[0].resume_url && resumeUrl) {
                  await query(
                    'UPDATE hiring_applicants SET resume_url=$1, updated_at=NOW() WHERE id=$2',
                    [resumeUrl, existing[0].id]
                  )
                }
                skipped++; processed++; continue
              }

              // Best-effort college/year extraction from body
              const collegeMatch = bodyText.match(/(?:studying at|student at|currently at|from)\s+([A-Z][^,.\n]{5,60})/i)
              const college = collegeMatch?.[1]?.trim() ?? null
              const yearMatch = bodyText.match(/(?:year|yr)[:\s]*([1-4])/i)
              const yearOfStudy = yearMatch ? parseInt(yearMatch[1]) : null

              const emailBody = subject
                ? `Subject: ${subject}\n\n${bodyText}`.trim()
                : bodyText.trim()

              await query(
                `INSERT INTO hiring_applicants
                  (company_id, name, email, phone, college, year_of_study, resume_url, resume_text, source, stage)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'gmail_imap','applied')`,
                [companyId, name, email, phone, college, yearOfStudy, resumeUrl, emailBody || null]
              )

              await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
              created++
            } catch (msgErr: unknown) {
              errors.push(`uid ${uid}: ${msgErr instanceof Error ? msgErr.message : String(msgErr)}`)
            }
            processed++
          }
        } catch (mbErr: unknown) {
          errors.push(`${mailbox} @ ${inbox.user}: ${mbErr instanceof Error ? mbErr.message : String(mbErr)}`)
        } finally {
          lock?.release()
        }
      }
      await client.logout()
    } catch (connErr: unknown) {
      errors.push(`connect ${inbox.user}: ${connErr instanceof Error ? connErr.message : String(connErr)}`)
    }
  }

  return c.json({ ok: true, processed, created, skipped, errors })
})

// ── POST /api/internal/hiring/backfill-email-bodies ──────────────────────────
// Backfills missing resume_text AND resume_url for gmail_imap applicants.
// Safe to re-run - only updates rows where the field is still null.

app.post('/api/internal/hiring/backfill-email-bodies', async (c) => {
  const secret = c.req.header('x-n8n-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) return c.json({ error: 'Forbidden' }, 403)

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImapFlow } = require('imapflow') as { ImapFlow: new (opts: unknown) => any }

  const resumesDir = path.join(process.cwd(), 'uploads', 'resumes')
  if (!fs.existsSync(resumesDir)) fs.mkdirSync(resumesDir, { recursive: true })

  // All applicants missing a resume file (any source - catches old n8n workflow records too)
  const { rows: needsFill } = await query(
    `SELECT id, email, company_id, resume_text, resume_url FROM hiring_applicants
     WHERE resume_url IS NULL AND company_id IS NOT NULL`,
    []
  )

  if (needsFill.length === 0) return c.json({ ok: true, updated: 0, message: 'Nothing to backfill' })

  type NeedsRow = { id: string; email: string; company_id: string; resume_text: string | null; resume_url: string | null }
  const byCompany: Record<string, NeedsRow[]> = {}
  for (const row of needsFill as NeedsRow[]) {
    if (!byCompany[row.company_id]) byCompany[row.company_id] = []
    byCompany[row.company_id].push(row)
  }

  let updated = 0
  const errors: string[] = []

  for (const inbox of getHiringInboxes()) {
    const companyId = await companyIdForDomain(inbox.user)
    if (!companyId) continue
    const batch = byCompany[companyId]
    if (!batch || batch.length === 0) continue

    const emailMap = new Map(batch.map(a => [a.email.toLowerCase(), a]))

    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: inbox.user, pass: inbox.pass.replace(/\s/g, '') },
      logger: false, tls: { rejectUnauthorized: false },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    })

    try {
      await client.connect()

      for (const mailbox of ['INBOX', '[Gmail]/Spam']) {
        let lock: { release(): void } | null = null
        try {
          lock = await client.getMailboxLock(mailbox)
          const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
          const uids: number[] = await client.search({ since }, { uid: true }) ?? []

          for (const uid of uids) {
            try {
              const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true })
              if (!msg) continue
              const fromAddr = msg.envelope?.from?.[0]
              const fromEmail = (fromAddr?.address ?? '').toLowerCase().trim()
              const applicant = emailMap.get(fromEmail)
              if (!applicant) continue

              const subject = msg.envelope?.subject ?? ''
              const rawBuf = msg.source ?? Buffer.alloc(0)
              const { text: bodyText, driveUrl, attachments } = await parseMime(rawBuf)

              let didUpdate = false

              // Fill email body if missing
              if (!applicant.resume_text) {
                const emailBody = subject ? `Subject: ${subject}\n\n${bodyText}`.trim() : bodyText.trim()
                if (emailBody) {
                  await query(`UPDATE hiring_applicants SET resume_text=$1, updated_at=NOW() WHERE id=$2`, [emailBody, applicant.id])
                  applicant.resume_text = emailBody
                  didUpdate = true
                }
              }

              // Save binary attachment or Drive URL if missing
              if (!applicant.resume_url) {
                const best = attachments.find(a => a.ext === '.pdf') ?? attachments[0]
                let resumeUrl: string | null = null
                if (best) {
                  const fname = `resume-${Date.now()}-${fromEmail.replace(/[^a-z0-9]/gi, '_')}${best.ext}`
                  fs.writeFileSync(path.join(resumesDir, fname), best.data)
                  resumeUrl = `/uploads/resumes/${fname}`
                } else if (driveUrl) {
                  resumeUrl = driveUrl
                }
                if (resumeUrl) {
                  await query(`UPDATE hiring_applicants SET resume_url=$1, updated_at=NOW() WHERE id=$2`, [resumeUrl, applicant.id])
                  applicant.resume_url = resumeUrl
                  didUpdate = true
                }
              }

              if (didUpdate) {
                updated++
                // Only remove from map once both fields are filled
                if (applicant.resume_text && applicant.resume_url) emailMap.delete(fromEmail)
              }
            } catch (msgErr: unknown) {
              errors.push(`uid ${uid}: ${msgErr instanceof Error ? msgErr.message : String(msgErr)}`)
            }
          }
        } catch (mbErr: unknown) {
          errors.push(`${mailbox} @ ${inbox.user}: ${mbErr instanceof Error ? mbErr.message : String(mbErr)}`)
        } finally {
          lock?.release()
        }
      }

      await client.logout()
    } catch (connErr: unknown) {
      errors.push(`connect ${inbox.user}: ${connErr instanceof Error ? connErr.message : String(connErr)}`)
    }
  }

  return c.json({ ok: true, updated, total: needsFill.length, errors })
})

// Internal-only - called by n8n for transactional emails (onboarding, welcome, etc.)
// Protected by N8N_WEBHOOK_SECRET header, same as other webhook endpoints.
// Never expose this route externally via Nginx.
app.post('/api/internal/send-email', async (c) => {
  const secret = c.req.header('x-internal-secret')
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()
  const { to, subject, text, html, design_id, vars } = body as {
    to: string; subject?: string; text?: string; html?: string
    design_id?: string; vars?: Record<string, string>
  }
  if (!to) return c.json({ error: 'Missing required field: to' }, 400)

  // Design-driven send (n8n workflows referencing a reusable Email Studio design by id)
  if (design_id) {
    const { rows } = await query(`SELECT * FROM email_designs WHERE id = $1`, [design_id])
    if (rows.length === 0) return c.json({ error: `Design ${design_id} not found` }, 404)
    const d = rows[0]
    const design: EmailDesignRow = {
      id: d.id, company_id: d.company_id, name: d.name, subject: d.subject,
      design_json: d.design_json, html: d.html, text: d.text, category: d.category,
      content_mode: d.content_mode, variables: d.variables, is_global: d.is_global, slug: d.slug,
    }
    const filledSubject = (design.subject ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars ?? {})[k] ?? `{{${k}}}`)
    const renderedHtml  = await inlineImagesAsBase64(renderDesignHtml(design, vars ?? {}))

    const result = await sendEmail({
      to, subject: filledSubject || subject || design.name, html: renderedHtml,
      kind: design.category ?? 'transactional', companyId: design.company_id,
      designId: design.id, respectSuppression: true,
    })
    if (!result.ok) return c.json({ ok: false, status: result.status, error: result.reason }, result.status === 'suppressed' ? 200 : 502)
    return c.json({ ok: true, messageId: result.messageId })
  }

  if (!subject || (!text && !html)) {
    return c.json({ error: 'Missing required fields: subject, and text or html (or provide design_id)' }, 400)
  }

  const result = await sendEmail({
    to,
    subject,
    text: text || '',
    html: html || `<p>${text}</p>`,
    kind: 'transactional',
    respectSuppression: true,
  })

  if (!result.ok) {
    return c.json({ ok: false, status: result.status, error: result.reason }, result.status === 'suppressed' ? 200 : 502)
  }
  return c.json({ ok: true, messageId: result.messageId })
})

export default app
