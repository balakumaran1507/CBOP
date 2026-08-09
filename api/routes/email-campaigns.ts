import { Hono }         from 'hono'
import { requireAuth }  from '../middleware/require-auth'
import { requireRole }  from '../middleware/require-role'
import { query }        from '../lib/db'
import { getCampaignTransporter, isDomainVerified, isSuppressed, suppress, isAtDailyCap, dailyCapFor, todaySentCount, injectTrackingPixel, rewriteLinksForTracking } from '../lib/mailer'
import { scanEmail } from '../lib/spam-scanner'
import { sendViaOpenClaw } from '../lib/openclaw'
import { getOpsAlertTelegramId } from '../lib/ops-alerts'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import dns               from 'node:dns/promises'
import '../lib/hono-vars'

// ── Anti-abuse constants ──────────────────────────────────────────────────────
// Background: zapsters.in was locked (Google 534-5.7.9) on 2026-06-16 because
// the loop burst 900+ sends in hours with no pacing and kept retrying on dead
// credentials. These constants enforce human-like sending behaviour.

// 3 consecutive SMTP failures = mailbox locked / credential dead, not bad recipients.
const MAX_CONSECUTIVE_FAILURES = 3

// Auto-pause if bounce rate exceeds this after at least MIN_SENDS_FOR_BOUNCE_CHECK.
// Google flags accounts with >2% complaint rate; >5% hard bounce triggers review.
const MAX_BOUNCE_RATE    = 0.05
const MIN_SENDS_FOR_BOUNCE_CHECK = 30

// Batch size before a cooling pause (mimics human "send a batch, take a break").
const BATCH_PAUSE_EVERY  = 50

// Business hours in UTC: 9 AM – 9 PM IST = 03:30 – 15:30 UTC.
// Sending at 3 AM is a primary bot signal. Outside this window the loop sleeps
// 10 min and retries rather than pausing the campaign.
const BIZ_HOUR_START_UTC = 3   // 08:30 IST
const BIZ_HOUR_END_UTC   = 16  // 21:30 IST

function isBusinessHours(): boolean {
  const h = new Date().getUTCHours()
  return h >= BIZ_HOUR_START_UTC && h < BIZ_HOUR_END_UTC
}

const app = new Hono()

// ── Delay helper ──────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── Email validation ──────────────────────────────────────────────────────────
const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

const mxCache = new Map<string, boolean>()

async function hasMx(domain: string): Promise<boolean> {
  if (mxCache.has(domain)) return mxCache.get(domain)!
  try {
    const records = await dns.resolveMx(domain)
    const ok = records.length > 0
    mxCache.set(domain, ok)
    return ok
  } catch {
    mxCache.set(domain, false)
    return false
  }
}

// ── Parse recipient list (raw text) ──────────────────────────────────────────
// Accepts:
//   plain@email.com
//   Name <email@domain.com>
//   name,email@domain.com  (CSV)
function parseRecipientLine(line: string): { email: string; name: string } | null {
  line = line.trim()
  if (!line || line.startsWith('#')) return null

  // Name <email> format
  const bracketMatch = line.match(/^(.+?)\s*<([^>]+)>$/)
  if (bracketMatch) return { name: bracketMatch[1].trim(), email: bracketMatch[2].trim().toLowerCase() }

  // CSV: name,email
  const commaIdx = line.lastIndexOf(',')
  if (commaIdx > 0) {
    const right = line.slice(commaIdx + 1).trim()
    if (EMAIL_REGEX.test(right)) return { name: line.slice(0, commaIdx).trim(), email: right.toLowerCase() }
  }

  // Plain email
  if (EMAIL_REGEX.test(line)) return { name: '', email: line.toLowerCase() }
  return null
}

// ── Merge tag substitution ────────────────────────────────────────────────────
function applyMergeTags(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '')
}

// ── Unsubscribe token (HMAC so we don't store tokens in DB) ──────────────────
const UNSUB_SECRET = process.env.BETTER_AUTH_SECRET ?? 'cbop-unsub-secret'

function unsubToken(email: string): string {
  return createHmac('sha256', UNSUB_SECRET).update(email.toLowerCase()).digest('hex').slice(0, 32)
}

// ── Running campaigns set (in-memory guard against double-start) ───────────────
const running = new Set<string>()

// ── Background send loop ──────────────────────────────────────────────────────
import path from 'node:path'
import { readFile } from 'node:fs/promises'

async function runCampaign(campaignId: string) {
  if (running.has(campaignId)) return
  running.add(campaignId)

  try {
    const { rows: [camp] } = await query(
      `SELECT mc.*, c.name AS company_name
       FROM marketing_campaigns mc
       JOIN companies c ON c.id = mc.company_id
       WHERE mc.id = $1`, [campaignId]
    )
    if (!camp) return

    const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003'
    const { transporter, from, senderEmail } = await getCampaignTransporter(camp.company_id, camp.company_name)

    // Reconcile any recipients left in 'sending' by a crash/restart that hit
    // between the SMTP call succeeding and the status update that follows it.
    // We can't tell from email_recipients alone whether the send actually went
    // out - email_send_log is the durable record of what was truly sent, so
    // check there before deciding to resend (avoids duplicate delivery on the
    // common "process died mid-batch, campaign auto-resumes on boot" path).
    const { rows: stuck } = await query(
      `SELECT id, email FROM email_recipients WHERE campaign_id = $1 AND status = 'sending'`,
      [campaignId]
    )
    for (const row of stuck) {
      const { rows: [logged] } = await query(
        `SELECT 1 FROM email_send_log WHERE campaign_id = $1 AND to_email = $2 AND status = 'sent' LIMIT 1`,
        [campaignId, row.email]
      )
      await query(
        `UPDATE email_recipients SET status = $2 WHERE id = $1`,
        [row.id, logged ? 'sent' : 'pending']
      )
    }

    // Load optional PDF attachment once (same file for every recipient)
    let pdfBuffer: Buffer | null = null
    let pdfFilename = ''
    if (camp.pdf_attachment_path) {
      try {
        const pdfDir = path.join(process.cwd(), 'uploads', 'campaign-pdfs')
        pdfBuffer  = await readFile(path.join(pdfDir, camp.pdf_attachment_path))
        pdfFilename = camp.pdf_attachment_path.replace(/^.*[\\/]/, '')
      } catch { /* attachment missing - log but continue */ }
    }

    let consecutiveFailures = 0
    let batchCount          = 0   // emails sent this session (for batch pausing)

    while (true) {
      // ── 1. Status check ────────────────────────────────────────────────────
      const { rows: [status] } = await query(
        'SELECT status FROM marketing_campaigns WHERE id = $1', [campaignId]
      )
      if (!status || status.status !== 'running') break

      // ── 2. Business hours gate (9 AM – 9 PM IST = UTC 03–16) ───────────────
      // Sending at 3 AM is a primary bot signal to Google's abuse heuristics.
      // Outside window: sleep 10 min and retry - campaign stays "running".
      if (!isBusinessHours()) {
        const utcH = new Date().getUTCHours()
        console.log(`[campaigns] outside business hours (UTC ${utcH}h) - sleeping 10 min`)
        await sleep(10 * 60_000)
        continue
      }

      // ── 3. Daily cap check ────────────────────────────────────────────────
      if (await isAtDailyCap(senderEmail)) {
        await query(`UPDATE marketing_campaigns SET status = 'paused' WHERE id = $1`, [campaignId])
        console.warn(`[campaigns] daily cap reached for ${senderEmail} - campaign ${campaignId} paused`)
        break
      }

      // ── 4. Next pending recipient ─────────────────────────────────────────
      const { rows: [recipient] } = await query(
        `SELECT * FROM email_recipients WHERE campaign_id = $1 AND status = 'pending' LIMIT 1`,
        [campaignId]
      )
      if (!recipient) {
        await query(
          `UPDATE marketing_campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [campaignId]
        )
        break
      }

      // ── 5. Suppression check ──────────────────────────────────────────────
      // Applies regardless of personal_mode - an unsubscribed/bounced/complained
      // address must never be emailed again, personal-framed send or not.
      if (await isSuppressed(recipient.email, camp.company_id)) {
        await query(`UPDATE email_recipients SET status = 'failed', error = 'Suppressed' WHERE id = $1`, [recipient.id])
        await query(`UPDATE marketing_campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [campaignId])
        continue
      }

      // ── 6. Build email ────────────────────────────────────────────────────
      const mergeData: Record<string, string> = {
        name:    recipient.name ?? '',
        email:   recipient.email,
        company: camp.company_name,
        ...(recipient.merge_data ?? {}),
      }

      const subject  = applyMergeTags(camp.subject, mergeData)
      let   bodyHtml = applyMergeTags(camp.body_html, mergeData)
      let   bodyText = applyMergeTags(camp.body_text ?? camp.body_html.replace(/<[^>]+>/g, ''), mergeData)

      const token    = unsubToken(recipient.email)
      const unsubUrl = `${appUrl}/api/campaigns/unsub?token=${token}&email=${encodeURIComponent(recipient.email)}`
      bodyHtml += `<br><br><hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#888">You received this email because you are on our mailing list. <a href="${unsubUrl}">Unsubscribe</a></p>`
      bodyText += `\n\n---\nUnsubscribe: ${unsubUrl}`

      // Open/click tracking - this is the actual bulk-send path (sendEmail() in
      // mailer.ts is NOT used here), so tracking has to be injected directly.
      const trackingToken = randomUUID()
      const trackedHtml = injectTrackingPixel(rewriteLinksForTracking(bodyHtml, trackingToken), trackingToken)

      const mailOptions: Parameters<typeof transporter.sendMail>[0] = {
        from,
        to:          recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email,
        replyTo:     camp.reply_to ?? undefined,
        subject,
        html:        trackedHtml,
        text:        bodyText,
        attachments: pdfBuffer ? [{ filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' }] : [],
        headers: {
          'List-Unsubscribe':      `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }

      // ── 7. Send ───────────────────────────────────────────────────────────
      await query(`UPDATE email_recipients SET status = 'sending' WHERE id = $1`, [recipient.id])
      try {
        const info = await transporter.sendMail(mailOptions)
        await query(`UPDATE email_recipients SET status = 'sent', sent_at = NOW() WHERE id = $1`, [recipient.id])
        await query(`UPDATE marketing_campaigns SET sent_count = sent_count + 1 WHERE id = $1`, [campaignId])
        await query(
          `INSERT INTO email_send_log (company_id, kind, to_email, from_email, subject, status, message_id, tracking_token, campaign_id)
           VALUES ($1,$2,$3,$4,$5,'sent',$6,$7,$8)`,
          [camp.company_id, 'campaign', recipient.email, senderEmail, subject.slice(0, 300), info?.messageId ?? null, trackingToken, campaignId]
        ).catch(() => {})
        consecutiveFailures = 0
        batchCount++
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        await query(`UPDATE email_recipients SET status = 'failed', error = $2 WHERE id = $1`, [recipient.id, msg.slice(0, 300)])
        await query(`UPDATE marketing_campaigns SET failed_count = failed_count + 1 WHERE id = $1`, [campaignId])
        await query(
          `INSERT INTO email_send_log (company_id, kind, to_email, from_email, subject, status, reason)
           VALUES ($1,$2,$3,$4,$5,'failed',$6)`,
          [camp.company_id, 'campaign', recipient.email, senderEmail, subject.slice(0, 300), msg.slice(0, 300)]
        ).catch(() => {})

        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await query(`UPDATE marketing_campaigns SET status = 'paused' WHERE id = $1`, [campaignId])
          console.error(`[campaigns] ${consecutiveFailures} consecutive failures - campaign ${campaignId} paused`)
          // Per-company alert recipient (companies.ops_alert_telegram_id) - see api/lib/ops-alerts.ts
          const alertTelegramId = await getOpsAlertTelegramId(camp.company_id as string | null)
          await sendViaOpenClaw({
            channel: 'telegram', to: alertTelegramId,
            message:
              `⚠️ Campaign "${camp.name}" auto-paused after ${consecutiveFailures} consecutive SMTP failures ` +
              `from ${senderEmail}.\nLatest: ${msg.slice(0, 200)}\n` +
              `This usually means the mailbox is locked - open Gmail in a browser before resuming.`,
          }).catch(() => {})
          break
        }
      }

      // ── 8. Bounce rate circuit breaker (every 30 sends) ─────────────────
      // >5% hard bounce rate = Google will flag the account. Auto-pause + alert.
      if (batchCount > 0 && batchCount % MIN_SENDS_FOR_BOUNCE_CHECK === 0) {
        const { rows: [stats] } = await query(
          `SELECT sent_count, failed_count FROM marketing_campaigns WHERE id = $1`, [campaignId]
        )
        const total      = (stats?.sent_count ?? 0) + (stats?.failed_count ?? 0)
        const bounceRate = total > 0 ? (stats?.failed_count ?? 0) / total : 0
        if (total >= MIN_SENDS_FOR_BOUNCE_CHECK && bounceRate > MAX_BOUNCE_RATE) {
          await query(`UPDATE marketing_campaigns SET status = 'paused' WHERE id = $1`, [campaignId])
          const alertTelegramId = await getOpsAlertTelegramId(camp.company_id as string | null)
          await sendViaOpenClaw({
            channel: 'telegram', to: alertTelegramId,
            message:
              `⚠️ Campaign "${camp.name}" auto-paused - bounce rate ${(bounceRate * 100).toFixed(1)}% ` +
              `(${stats.failed_count}/${total} failed). Clean the list before resuming - ` +
              `Google will lock the mailbox above 5% bounce.`,
          }).catch(() => {})
          break
        }
      }

      // ── 9. Per-email interval: 30–90s random ────────────────────────────
      // Avg ~60s × 700 emails + batch pauses ≈ 14h total → fits one business day.
      // Randomness breaks the machine-regularity pattern Gmail flags.
      const delay = 30_000 + Math.floor(Math.random() * 60_000)
      await sleep(delay)

      // ── 10. Batch cooldown: every 50 sends, rest 8–12 min ───────────────
      // Mimics a human pausing between bursts. Prevents hourly spike detection.
      if (batchCount > 0 && batchCount % BATCH_PAUSE_EVERY === 0) {
        const cooldown = 8 * 60_000 + Math.floor(Math.random() * 4 * 60_000)
        console.log(`[campaigns] batch of ${BATCH_PAUSE_EVERY} sent - cooling ${Math.round(cooldown / 60_000)}m`)
        await sleep(cooldown)
      }
    }
  } finally {
    running.delete(campaignId)
  }
}

// ── Startup recovery - resume campaigns that were running before server restart ──
;(async () => {
  await new Promise(r => setTimeout(r, 3000)) // wait for DB pool to be ready
  try {
    const { rows } = await query(
      `SELECT id FROM marketing_campaigns WHERE status = 'running' ORDER BY started_at ASC`
    )
    if (rows.length > 0) {
      console.log(`[campaigns] resuming ${rows.length} campaign(s) that were running before restart`)
      for (const row of rows) {
        runCampaign(row.id as string).catch(err => console.error('[campaigns] resume error:', err))
      }
    }
  } catch (err) {
    console.error('[campaigns] startup recovery check failed:', err)
  }
})()

// ── POST /api/campaigns/email/validate ───────────────────────────────────────
// Validate a raw email list without saving. Returns counts and lists.
app.post('/api/campaigns/email/validate', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const { raw } = await c.req.json() as { raw: string }
  if (!raw) return c.json({ error: 'raw is required' }, 400)

  const lines   = raw.split(/[\r\n]+/).filter(Boolean)
  const seen    = new Set<string>()
  const valid:   Array<{ email: string; name: string }> = []
  const invalid: Array<{ line: string; reason: string }> = []

  // Process in parallel batches of 10 for MX lookups
  const parsed = lines.map(l => ({ line: l, parsed: parseRecipientLine(l) }))

  for (const { line, parsed: p } of parsed) {
    if (!p) { invalid.push({ line, reason: 'Cannot parse email address' }); continue }
    if (seen.has(p.email)) { invalid.push({ line, reason: 'Duplicate' }); continue }
    seen.add(p.email)

    const hasMxRecord = await hasMx(p.email.split('@')[1])
    if (!hasMxRecord) { invalid.push({ line, reason: 'Domain has no MX records' }); continue }

    valid.push(p)
  }

  return c.json({
    valid_count:   valid.length,
    invalid_count: invalid.length,
    total:         lines.length,
    valid:         valid.slice(0, 50),    // preview first 50
    invalid:       invalid.slice(0, 50),  // preview first 50
  })
})

// ── POST /api/campaigns/email/spam-check ─────────────────────────────────────
// Preview the spam score of subject + body before saving/sending.
app.post('/api/campaigns/email/spam-check', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const { subject, body_html, body_text } = await c.req.json() as {
    subject?: string; body_html?: string; body_text?: string
  }
  const report = scanEmail({
    subject:    subject ?? '',
    html:       body_html ?? '',
    text:       body_text ?? '',
    isBulk:     true,
    autoFooter: true,
  })
  return c.json(report)
})

// ── GET /api/campaigns/email ──────────────────────────────────────────────────
app.get('/api/campaigns/email', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const { rows } = await query(
    `SELECT mc.*, c.name AS company_name, mc.type
     FROM marketing_campaigns mc
     JOIN companies c ON c.id = mc.company_id
     WHERE mc.company_id = ANY($1) AND mc.type = 'email'
     ORDER BY mc.created_at DESC`,
    [companyIds]
  )

  return c.json(rows)
})

// ── POST /api/campaigns/email ─────────────────────────────────────────────────
app.post('/api/campaigns/email', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const userId     = c.get('userId') as string
  const companyIds = c.get('companyIds') as string[]

  const body = await c.req.json() as {
    company_id:    string
    name:          string
    subject:       string
    body_html:     string
    body_text?:    string
    reply_to?:     string
    raw_list:      string
    personal_mode?: boolean
  }

  const { company_id, name, subject, body_html, body_text, reply_to, raw_list } = body
  const personal_mode = Boolean(body.personal_mode)

  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!name || !subject || !body_html || !raw_list) {
    return c.json({ error: 'name, subject, body_html, and raw_list are required' }, 400)
  }

  // Cap at 1000 for personal mode (no bulk headers)
  if (personal_mode) {
    const lineCount = raw_list.split(/[\r\n]+/).filter(Boolean).length
    if (lineCount > 1000) return c.json({ error: `Personal blast is capped at 1000 recipients (got ${lineCount}). Split into batches.` }, 400)
  }

  // Parse + validate recipients
  const lines  = raw_list.split(/[\r\n]+/).filter(Boolean)
  const seen   = new Set<string>()
  const valid: Array<{ email: string; name: string }> = []
  const invalid: number[] = []

  for (const line of lines) {
    const p = parseRecipientLine(line)
    if (!p || seen.has(p.email)) { invalid.push(1); continue }
    seen.add(p.email)
    const hasMxRecord = await hasMx(p.email.split('@')[1])
    if (!hasMxRecord) { invalid.push(1); continue }
    valid.push(p)
  }

  // Get company name for sender routing
  const { rows: [company] } = await query('SELECT name FROM companies WHERE id = $1', [company_id])
  const { senderEmail, from } = await getCampaignTransporter(company_id, company?.name)

  // Create campaign
  const { rows: [camp] } = await query(
    `INSERT INTO marketing_campaigns
       (company_id, name, type, subject, body_html, body_text, sender_email, reply_to,
        status, total_count, valid_count, invalid_count, created_by, personal_mode)
     VALUES ($1,$2,'email',$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      company_id, name, subject, body_html,
      body_text ?? '', senderEmail, reply_to ?? null,
      lines.length, valid.length, invalid.length, userId, personal_mode,
    ]
  )

  // Insert valid recipients in bulk
  if (valid.length > 0) {
    const placeholders = valid.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',')
    const values = valid.flatMap(r => [camp.id, r.email, r.name || null])
    await query(
      `INSERT INTO email_recipients (campaign_id, email, name) VALUES ${placeholders}`,
      values
    )
  }

  return c.json(camp, 201)
})

// ── GET /api/campaigns/email/:id ──────────────────────────────────────────────
app.get('/api/campaigns/email/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const { rows: [camp] } = await query(
    `SELECT mc.*, c.name AS company_name
     FROM marketing_campaigns mc
     JOIN companies c ON c.id = mc.company_id
     WHERE mc.id = $1 AND mc.company_id = ANY($2) AND mc.type = 'email'`,
    [c.req.param('id'), companyIds]
  )
  if (!camp) return c.json({ error: 'Not found' }, 404)

  const { rows: [engagement] } = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked
     FROM email_send_log WHERE campaign_id = $1`,
    [c.req.param('id')]
  )

  return c.json({ ...camp, engagement })
})

// ── GET /api/campaigns/email/:id/recipients ───────────────────────────────────
app.get('/api/campaigns/email/:id/recipients', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  // Verify ownership
  const { rows: [camp] } = await query(
    `SELECT id FROM marketing_campaigns WHERE id = $1 AND company_id = ANY($2) AND type = 'email'`,
    [c.req.param('id'), companyIds]
  )
  if (!camp) return c.json({ error: 'Not found' }, 404)

  const filter = c.req.query('status') ?? 'all'
  const where  = filter === 'all' ? '' : `AND status = '${filter}'`

  const { rows } = await query(
    `SELECT id, email, name, status, error, sent_at, created_at
     FROM email_recipients
     WHERE campaign_id = $1 ${where}
     ORDER BY created_at ASC
     LIMIT 500`,
    [c.req.param('id')]
  )

  return c.json(rows)
})

// ── POST /api/campaigns/email/:id/start ──────────────────────────────────────
app.post('/api/campaigns/email/:id/start', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param("id") ?? ""

  const { rows: [camp] } = await query(
    `SELECT * FROM marketing_campaigns WHERE id = $1 AND company_id = ANY($2) AND type = 'email'`,
    [id, companyIds]
  )
  if (!camp) return c.json({ error: 'Not found' }, 404)
  if (running.has(id)) return c.json({ error: 'Already running' }, 409)

  // Verified-domain guard - refuse to start on an unauthenticated sender domain.
  if (camp.sender_email && !(await isDomainVerified(camp.sender_email))) {
    return c.json({
      error: `Sender domain for "${camp.sender_email}" is not verified (SPF/DKIM/DMARC). ` +
             `Set it up before sending - see docs/modules/EMAIL_DELIVERABILITY.md.`,
    }, 422)
  }

  // Daily cap check - surface this BEFORE starting so the UI gets a real error
  // instead of the campaign silently flipping running→paused in the background.
  if (camp.sender_email) {
    const [sent, cap] = await Promise.all([
      todaySentCount(camp.sender_email),
      dailyCapFor(camp.sender_email),
    ])
    if (sent >= cap) {
      // UTC midnight = when the cap resets (email_send_log uses UTC date_trunc)
      const nowUtc       = new Date()
      const resetUtc     = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 1))
      const diffMs       = resetUtc.getTime() - nowUtc.getTime()
      const diffHrs      = Math.floor(diffMs / 3_600_000)
      const diffMins     = Math.floor((diffMs % 3_600_000) / 60_000)
      return c.json({
        error: `Daily send cap reached for ${camp.sender_email} (${sent}/${cap} sent today). ` +
               `Cap resets at midnight UTC - ${diffHrs}h ${diffMins}m from now. Try resuming after that.`,
        cap_info: { sent, cap, resets_in_ms: diffMs },
      }, 422)
    }
  }

  // Spam-content gate - block obviously spammy campaigns before they ever send.
  const report = scanEmail({
    subject:    camp.subject ?? '',
    html:       camp.body_html ?? '',
    text:       camp.body_text ?? '',
    isBulk:     !camp.personal_mode,
    autoFooter: !camp.personal_mode,
  })
  await query(`UPDATE marketing_campaigns SET spam_score = $2 WHERE id = $1`, [id, report.score])
  if (report.level === 'block') {
    return c.json({ error: 'Campaign blocked by spam scan.', spam: report }, 422)
  }

  await query(
    `UPDATE marketing_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW())
     WHERE id = $1`, [id]
  )

  // Fire-and-forget background send
  runCampaign(id).catch(err => console.error('[email-campaigns] runCampaign error:', err))

  return c.json({ ok: true, status: 'running' })
})

// ── POST /api/campaigns/email/:id/pause ──────────────────────────────────────
app.post('/api/campaigns/email/:id/pause', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param("id") ?? ""

  const { rows: [camp] } = await query(
    `SELECT id FROM marketing_campaigns WHERE id = $1 AND company_id = ANY($2) AND type = 'email'`,
    [id, companyIds]
  )
  if (!camp) return c.json({ error: 'Not found' }, 404)

  await query(`UPDATE marketing_campaigns SET status = 'paused' WHERE id = $1`, [id])
  return c.json({ ok: true, status: 'paused' })
})

// ── POST /api/campaigns/email/:id/attach-pdf ─────────────────────────────────
// Upload an optional PDF to attach to every email in the campaign.
app.post('/api/campaigns/email/:id/attach-pdf', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') ?? ''

  const { rows: [camp] } = await query(
    `SELECT id FROM marketing_campaigns WHERE id = $1 AND company_id = ANY($2) AND type = 'email'`,
    [id, companyIds]
  )
  if (!camp) return c.json({ error: 'Not found' }, 404)

  const formData  = await c.req.formData()
  const file      = formData.get('pdf') as File | null
  if (!file || file.type !== 'application/pdf') return c.json({ error: 'A PDF file is required' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'PDF must be under 5 MB' }, 400)

  const { mkdir, writeFile } = await import('node:fs/promises')
  const pdfDir = path.join(process.cwd(), 'uploads', 'campaign-pdfs')
  await mkdir(pdfDir, { recursive: true })

  const filename = `${id}.pdf`
  await writeFile(path.join(pdfDir, filename), Buffer.from(await file.arrayBuffer()))
  await query(`UPDATE marketing_campaigns SET pdf_attachment_path = $2 WHERE id = $1`, [id, filename])

  return c.json({ ok: true, filename })
})

// ── DELETE /api/campaigns/email/:id/attach-pdf ───────────────────────────────
app.delete('/api/campaigns/email/:id/attach-pdf', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id') ?? ''
  await query(
    `UPDATE marketing_campaigns SET pdf_attachment_path = NULL WHERE id = $1 AND company_id = ANY($2)`,
    [id, companyIds]
  )
  return c.json({ ok: true })
})

// ── DELETE /api/campaigns/email/:id ──────────────────────────────────────────
app.delete('/api/campaigns/email/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param("id") ?? ""

  if (running.has(id)) return c.json({ error: 'Cannot delete a running campaign - pause it first' }, 409)

  await query(
    `DELETE FROM marketing_campaigns WHERE id = $1 AND company_id = ANY($2) AND type = 'email'`,
    [id, companyIds]
  )
  return c.json({ ok: true })
})

// ── GET /api/campaigns/unsub ─────────────────────────────────────────────────
// Public endpoint - no auth required. Registered before /:id to avoid param collision.
app.get('/api/campaigns/unsub', async (c) => {
  const email     = (c.req.query('email') ?? '').toLowerCase()
  const token     = c.req.query('token') ?? ''
  const campaignId = c.req.query('campaign') ?? null

  if (!email || token !== unsubToken(email)) {
    return c.html('<h2>Invalid unsubscribe link.</h2>', 400)
  }

  await query(
    `INSERT INTO email_unsubscribes (email, campaign_id)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email, campaignId]
  )
  // Mirror into the unified suppression list (single source of truth).
  await suppress(email, 'unsubscribe', null, campaignId ? `campaign ${campaignId}` : undefined)
  // If this address is a managed subscriber, flip its status too.
  await query(
    `UPDATE email_subscribers SET status = 'unsubscribed', unsubscribed_at = NOW()
     WHERE email = $1 AND status != 'unsubscribed'`,
    [email]
  ).catch(() => {})

  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Unsubscribed</title>
    <style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f2f3f3}
    .box{background:#fff;border-radius:8px;padding:40px 48px;text-align:center;max-width:400px;border:1px solid #d5dbdb}
    h2{font-family:Syne,sans-serif;color:#232f3e;margin:0 0 12px}p{color:#666;margin:0}</style></head>
    <body><div class="box"><h2>Unsubscribed</h2>
    <p>${email} has been removed from our mailing list.<br>You will not receive any further emails.</p>
    </div></body></html>`)
})

export default app
