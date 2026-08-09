import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query } from '../lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest } from '../lib/audit-log'
import { sendEmail, isAtDailyCap, dailyCapFor } from '../lib/mailer'
import { sendViaOpenClaw } from '../lib/openclaw'
import { extractResumeData, suggestRoleForApplicant, extractStatedRole } from '../lib/resume-scorer'
import { scoreResumeWithLLM, type LLMScore } from '../lib/local-llm'
import { emailWrap } from './hiring-batches'
import { buildTemplateEmail } from './templates'
import { renderDesignHtml, inlineImagesAsBase64, type EmailDesignRow } from '../lib/email-designs'
import { getCompanyBrand } from '../lib/company-brand'
import '../lib/hono-vars'
import * as fs from 'fs'
import * as path from 'path'

// ── Template engine helpers ───────────────────────────────────────────────────

// Fetch an email template by slug and render it as HTML with the given vars.
// Lookup order: Email Studio design (new, preferred) → legacy Document Studio
// template → null (callers fall back to hardcoded DEFAULT_* constants).
async function renderEmailTemplate(slug: string, vars: Record<string, string>): Promise<string | null> {
  try {
    const { rows: designRows } = await query(`SELECT * FROM email_designs WHERE slug = $1`, [slug])
    if (designRows.length > 0) {
      const d = designRows[0]
      const design: EmailDesignRow = {
        id: d.id, company_id: d.company_id, name: d.name, subject: d.subject,
        design_json: d.design_json, html: d.html, text: d.text, category: d.category,
        content_mode: d.content_mode, variables: d.variables, is_global: d.is_global, slug: d.slug,
      }
      return await inlineImagesAsBase64(renderDesignHtml(design, vars))
    }
  } catch { /* fall through to legacy templates table */ }

  try {
    const res = await query(
      `SELECT t.*, c.name AS company_name, c.logo_url AS company_logo_url
       FROM templates t JOIN companies c ON c.id = t.company_id
       WHERE t.slug = $1`,
      [slug]
    )
    if (res.rows.length === 0) return null
    return await buildTemplateEmail(res.rows[0] as Record<string, unknown>, vars)
  } catch { return null }
}

// Extract plain text from a local resume file (PDF or DOCX).
// Returns empty string if file missing, unreadable, or unsupported format.
async function extractResumeFileText(resumeUrl: string): Promise<string> {
  try {
    if (!resumeUrl || resumeUrl.startsWith('http')) return ''
    const filePath = path.join(process.cwd(), resumeUrl)
    if (!fs.existsSync(filePath)) return ''
    const buf = fs.readFileSync(filePath)
    if (resumeUrl.endsWith('.pdf')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const result = await pdfParse(buf)
      return result.text?.replace(/\s+/g, ' ').trim() ?? ''
    }
    if (resumeUrl.endsWith('.docx') || resumeUrl.endsWith('.doc')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth') as { extractRawText(opts: { buffer: Buffer }): Promise<{ value: string }> }
      const result = await mammoth.extractRawText({ buffer: buf })
      return result.value?.replace(/\s+/g, ' ').trim() ?? ''
    }
  } catch { /* non-fatal */ }
  return ''
}

const app = new Hono()

// ── Helpers ───────────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

// Renders a plain {{var}}-interpolated template body into the shared branded
// email frame, instead of the old raw `.replace(/\n/g,'<br>')` (unstyled text dump).
function textToEmailHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Per-company branding for emails - sourced from companies.logo_initials /
// companies.email_branding via api/lib/company-brand.ts (see that file for why;
// this used to be a hardcoded map here, byte-for-byte duplicated in hiring-batches.ts).

function buildRejectionHtml(opts: {
  applicantName: string
  roleTitle: string
  companyName: string
  companyId: string
  rejectionReason?: string | null
}): { html: string; text: string } {
  const brand  = getCompanyBrand(opts.companyId)
  const reason = opts.rejectionReason?.trim()

  const reasonBlock = reason
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
        After careful review, we wanted to share some context: <em>${reason}</em>
       </p>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E5E7EB;">

        <tr><td style="background:${brand.accent};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:16px;font-weight:700;color:#0F1117;letter-spacing:-0.3px;">${opts.companyName}</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">${brand.tagline}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 32px 28px;">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">Hi <strong>${opts.applicantName}</strong>,</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
              Thank you for your interest in the <strong>${opts.roleTitle}</strong> internship at ${opts.companyName}. We genuinely appreciate the time and effort you put into your application.
            </p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
              After reviewing your profile, we regret to inform you that we will not be moving forward with your application at this time.
            </p>
            ${reasonBlock}
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
              This decision does not reflect negatively on your potential - hiring decisions are often shaped by very specific needs at a given point in time. We encourage you to keep building and to apply again as your experience grows.
            </p>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#374151;">
              We wish you the very best in your journey ahead.
            </p>

            <div style="border-top:1px solid #E5E7EB;padding-top:20px;">
              <p style="margin:0;font-size:13px;color:#6B7280;">Warm regards,</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0F1117;">${brand.signoff}</p>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 32px;border-top:1px solid #E5E7EB;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">
              This email was sent because you applied for an internship at ${opts.companyName}. Please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  const reasonText = reason ? `\nRegarding your application, we wanted to share: ${reason}\n` : ''
  const text = `Hi ${opts.applicantName},

Thank you for your interest in the ${opts.roleTitle} internship at ${opts.companyName}. We appreciate the time and effort you put into your application.

After reviewing your profile, we regret to inform you that we will not be moving forward with your application at this time.
${reasonText}
This decision does not reflect negatively on your potential - hiring decisions are often shaped by very specific needs at a given point in time. We encourage you to keep building and to apply again as your experience grows.

We wish you the very best in your journey ahead.

Warm regards,
${brand.signoff}`

  return { html, text }
}

const DEFAULT_REJECTION_TEMPLATE = `Hi {{applicant_name}},

Thank you for applying for the {{role_title}} position at {{company_name}}.

After reviewing your application, we will not be moving forward at this time.

We encourage you to continue building your skills and apply again in the future.

Best,
{{company_name}} Team`

const DEFAULT_INTERVIEW_TEMPLATE = `Hi {{applicant_name}},

We reviewed your application for {{role_title}} and would like to invite you for an interview.

Date: {{interview_date}}
Time: {{interview_time}} IST
Meeting Link: {{meet_link}}

Please confirm your attendance by replying to this email.

Best,
{{interviewer_name}}
{{company_name}}`

const DEFAULT_OFFER_TEMPLATE = `Hi {{applicant_name}},

We are pleased to offer you an internship position as {{role_title}} at {{company_name}}.

Please find the offer letter attached. Review the terms and reply:
- "I ACCEPT" to confirm your joining
- "I DECLINE" if you wish to withdraw

The offer expires in 48 hours.

Welcome aboard,
{{company_name}} Team`

const DEFAULT_WELCOME_TEMPLATE = `Hi {{applicant_name}},

Welcome to the team! We are excited to have you join us as {{role_title}}.

Your start date: {{start_date}}
Your team lead: {{team_lead_name}}
Reporting to: {{team_lead_email}}

You will receive separate invites for:
- Slack workspace
- Discord server
- Wiki / documentation access

See you soon,
{{company_name}} Team`

async function getHiringSettings(companyId: string) {
  const res = await query(
    `SELECT * FROM hiring_settings WHERE company_id = $1`,
    [companyId],
  )
  return res.rows[0] || null
}

async function sendRejectionEmail(
  applicant: Record<string, unknown>,
  role: Record<string, unknown>,
  company: Record<string, unknown>,
  template?: string,
): Promise<void> {
  const { html, text } = buildRejectionHtml({
    applicantName:   String(applicant.name),
    roleTitle:       String(role.title),
    companyName:     String(company.name),
    companyId:       String(applicant.company_id),
    rejectionReason: applicant.rejection_reason ? String(applicant.rejection_reason) : null,
  })

  // Custom template overrides the branded HTML (plain interpolation)
  if (template) {
    const reason = applicant.rejection_reason ? String(applicant.rejection_reason).trim() : ''
    const vars = {
      applicant_name:        String(applicant.name),
      role_title:            String(role.title),
      company_name:          String(company.name),
      rejection_reason:      reason,
      // Whole-paragraph block - empty when no reason was given, so the
      // placeholder never leaks into the sent email as literal text.
      rejection_reason_line: reason ? `\n\n${reason}` : '',
    }
    const body = interpolate(template, vars)
    const brand = getCompanyBrand(String(applicant.company_id))
    await sendEmail({
      to:      String(applicant.email),
      subject: `Your application to ${company.name}`,
      text:    body,
      html:    emailWrap(String(company.name), brand.accent, brand.tagline, textToEmailHtml(body), 'Do not reply to this email.'),
    })
    return
  }

  const rejectionVars = {
    applicant_name: String(applicant.name),
    role_title:     String(role.title),
    company_name:   String(company.name),
  }
  const richHtml = await renderEmailTemplate('rejection_email', rejectionVars)
  await sendEmail({
    to:      String(applicant.email),
    subject: `Your application to ${company.name} - Update`,
    text,
    html:    richHtml ?? html,
  })
}

async function notifyReviewers(
  applicant: Record<string, unknown>,
  role: Record<string, unknown>,
  company: Record<string, unknown>,
  isTechnical: boolean,
): Promise<void> {
  const reviewerQuery = isTechnical
    ? `SELECT telegram_chat_id FROM users WHERE role IN ('coo', 'cto') AND is_active = true AND telegram_chat_id IS NOT NULL`
    : `SELECT telegram_chat_id FROM users WHERE role = 'coo' AND is_active = true AND telegram_chat_id IS NOT NULL`

  const res = await query(reviewerQuery)
  const msg = `[HIRING] New shortlist: ${applicant.name} - ${role.title} at ${company.name}`

  for (const row of res.rows) {
    try {
      await sendViaOpenClaw({
        channel: 'telegram',
        to:      String(row.telegram_chat_id),
        message: msg,
      })
    } catch { /* non-fatal */ }
  }
}

// ── GET /api/hiring/applicants ─────────────────────────────────────────────

app.get('/api/hiring/applicants', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const role       = c.get('role') as string
  const { stage, role_id, company_id, scored_only } = c.req.query()

  const conditions: string[] = ['a.company_id = ANY($1)']
  const params: unknown[]    = [companyIds]
  let p = 2

  if (role === 'cto') {
    conditions.push(`r.is_technical = true`)
  }

  if (stage) {
    conditions.push(`a.stage = $${p++}`)
    params.push(stage)
  }
  if (role_id) {
    conditions.push(`a.role_id = $${p++}`)
    params.push(role_id)
  }
  if (company_id && companyIds.includes(company_id)) {
    conditions.push(`a.company_id = $${p++}`)
    params.push(company_id)
  }
  if (scored_only === 'true') {
    conditions.push(`a.ai_scored_at IS NOT NULL`)
  }

  const result = await query(
    `SELECT a.*, r.title AS role_title, r.role_type, r.is_technical,
            co.name AS company_name,
            u.name  AS reviewer_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r   ON r.id  = a.role_id
     LEFT JOIN companies co     ON co.id = a.company_id
     LEFT JOIN users u          ON u.id  = a.reviewed_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.ai_score DESC, a.created_at DESC`,
    params,
  )

  return c.json({ applicants: result.rows })
})

// ── POST /api/hiring/applicants ────────────────────────────────────────────

app.post('/api/hiring/applicants', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body = await c.req.json()
  const {
    name, email, phone, college, year_of_study,
    role_id, company_id, resume_text, portfolio_url,
    linkedin_url, github_url, source,
  } = body

  if (!name || !email) return c.json({ error: 'name and email required' }, 400)
  if (company_id && !companyIds.includes(company_id)) {
    return c.json({ error: 'Company not in scope' }, 403)
  }

  const result = await query(
    `INSERT INTO hiring_applicants
       (name, email, phone, college, year_of_study, role_id, company_id,
        resume_text, portfolio_url, linkedin_url, github_url, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [name, email, phone ?? null, college ?? null, year_of_study ?? null,
     role_id ?? null, company_id ?? null, resume_text ?? null,
     portfolio_url ?? null, linkedin_url ?? null, github_url ?? null,
     source ?? 'manual'],
  )

  const applicant = result.rows[0]

  // Enqueue scoring job
  if (resume_text && role_id) {
    await query(
      `INSERT INTO system_jobs (name, type, status, payload)
       VALUES ('score_resume', 'hiring', 'pending', $1::jsonb)`,
      [JSON.stringify({ applicant_id: applicant.id })],
    )
  }

  return c.json({ applicant }, 201)
})

// ── POST /api/hiring/applicants/ingest (n8n email ingestion) ───────────────

app.post('/api/hiring/applicants/ingest', async (c) => {
  const secret = c.req.header('x-n8n-secret') || c.req.header('x-cbop-secret')
  if (secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const body = await c.req.json()
  const { name, email, resume_text, source, role_id, company_id } = body

  if (!name || !email) return c.json({ error: 'name and email required' }, 400)

  const resolvedCompanyId = company_id ?? null

  const existing = await query(
    `SELECT id FROM hiring_applicants WHERE email = $1 LIMIT 1`,
    [email],
  )
  if (existing.rows.length > 0) {
    return c.json({ applicant_id: existing.rows[0].id, duplicate: true })
  }

  const result = await query(
    `INSERT INTO hiring_applicants
       (name, email, role_id, company_id, resume_text, source)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [name, email, role_id ?? null, resolvedCompanyId, resume_text ?? null, source ?? 'email'],
  )

  const applicantId = result.rows[0].id

  // Fire-and-forget: score + ack email + Telegram alert
  setImmediate(async () => {
    let scoreTotal = 0
    let aiOffline  = false

    try {
      const appRow = await query(
        `SELECT a.*, r.title AS role_title, r.required_skills, r.preferred_skills
         FROM hiring_applicants a
         LEFT JOIN hiring_roles r ON r.id = a.role_id
         WHERE a.id = $1`,
        [applicantId],
      )
      if (appRow.rows.length) {
        let ap = appRow.rows[0]

        // Always extract and store stated role first
        const statedRole = resume_text ? await extractStatedRole(resume_text) : null
        if (statedRole) {
          await query(`UPDATE hiring_applicants SET stated_role = $1 WHERE id = $2`, [statedRole, applicantId])
        }

        // Auto-match role if not provided - search ALL active roles
        if (!ap.role_id && resume_text) {
          const roleOptions = await query(
            `SELECT id, title, required_skills FROM hiring_roles WHERE active = true`,
            [],
          )
          if (roleOptions.rows.length) {
            const matchedRoleId = await suggestRoleForApplicant(resume_text, roleOptions.rows, statedRole)
            if (matchedRoleId) {
              await query(`UPDATE hiring_applicants SET role_id = $1 WHERE id = $2`, [matchedRoleId, applicantId])
              const refetch = await query(
                `SELECT a.*, r.title AS role_title, r.required_skills, r.preferred_skills
                 FROM hiring_applicants a
                 LEFT JOIN hiring_roles r ON r.id = a.role_id
                 WHERE a.id = $1`,
                [applicantId],
              )
              ap = refetch.rows[0]
            }
            // If no match found at all, summary will flag it
          }
        }

        // Score via local LLM (Ollama + Gemma)
        let llmScore: LLMScore | null = null
        if (resume_text) {
          try {
            llmScore = await scoreResumeWithLLM(
              resume_text,
              String(ap.role_title || 'Intern'),
              ap.required_skills || [],
            )
          } catch (scoreErr) {
            const scoreMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr)
            console.warn('[ingest] Ollama scoring failed:', scoreMsg)
            aiOffline = true
          }
        }

        if (llmScore) {
          const { rows: [ingestSettings] } = await query(
            `SELECT auto_shortlist_threshold, auto_reject_threshold FROM hiring_settings WHERE company_id = $1`,
            [ap.company_id],
          )
          const shortlistT = (ingestSettings?.auto_shortlist_threshold as number) ?? 75
          const rejectT    = (ingestSettings?.auto_reject_threshold    as number) ?? 25
          const newStage = llmScore.score > shortlistT ? 'shortlisted' : llmScore.score < rejectT ? 'rejected' : 'reviewed'
          await query(
            `UPDATE hiring_applicants
             SET ai_score = $1, ai_score_breakdown = $2, ai_summary = $3, ai_scored_at = NOW(), stage = $4
             WHERE id = $5`,
            [llmScore.score, JSON.stringify(llmScore), llmScore.summary, newStage, applicantId],
          )
          scoreTotal = llmScore.score
        }

        // Extract and save contact details (best-effort, separate Ollama call)
        if (resume_text) {
          try {
            const resumeData = await extractResumeData(resume_text, String(ap.role_title || 'Intern'))
            if (resumeData.skills.length > 0) {
              const cu: string[] = []; const cp: unknown[] = []; let ci = 1
              const maybeSet = (f: string, v: string | null | undefined) => { if (v) { cu.push(`${f} = $${ci++}`); cp.push(v) } }
              maybeSet('college', resumeData.college)
              maybeSet('phone', resumeData.phone)
              maybeSet('github_url', resumeData.github_url)
              maybeSet('linkedin_url', resumeData.linkedin_url)
              maybeSet('portfolio_url', resumeData.portfolio_url)
              if (resumeData.year_of_study) { cu.push(`year_of_study = $${ci++}`); cp.push(resumeData.year_of_study) }
              if (cu.length) { cp.push(applicantId); await query(`UPDATE hiring_applicants SET ${cu.join(', ')} WHERE id = $${ci}`, cp) }
            }
          } catch { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.error('[ingest] auto-score failed:', e)
      aiOffline = true
    }

    // Telegram alert to CEO - score result or manual review request
    try {
      const balaRes = await query(
        `SELECT telegram_chat_id FROM users WHERE role = 'ceo' AND is_active = true AND telegram_chat_id IS NOT NULL LIMIT 1`,
        [],
      )
      if (balaRes.rows.length) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cbop.etherence.com'
        const msg = aiOffline
          ? `HIRING - Manual Review Needed\n\nName: ${name}\nEmail: ${email}\n\nAI scorer is offline. Please review this applicant manually.\n\n${appUrl}/hiring`
          : `HIRING - Application Scored\n\nName: ${name}\nEmail: ${email}\nAI Score: ${scoreTotal}/100\n\n${appUrl}/hiring`
        await sendViaOpenClaw({
          channel: 'telegram',
          to:      String(balaRes.rows[0].telegram_chat_id),
          message: msg,
        })
      }
    } catch (e) {
      console.error('[ingest] telegram alert failed:', e)
    }

    try {
      await sendEmail({
        to:      email,
        subject: 'We received your application!',
        html:    `<p>Hi ${name},</p>
<p>Thanks for reaching out! We've received your application and our team will review it shortly.</p>
<p>We'll be in touch if your profile matches our current openings.</p>
<p>Best,<br>The Team</p>`,
        text: `Hi ${name},\n\nThanks for reaching out! We've received your application and our team will review it shortly.\n\nWe'll be in touch if your profile matches our current openings.\n\nBest,\nThe Team`,
      })
    } catch (e) {
      console.error('[ingest] ack email failed:', e)
    }
  })

  return c.json({ applicant_id: applicantId, created: true }, 201)
})

// ── POST /api/hiring/applicants/:id/score ─────────────────────────────────

app.post('/api/hiring/applicants/:id/score', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, r.required_skills, r.preferred_skills, r.is_technical,
            co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  let applicant = appRes.rows[0]

  // If resume_text is empty or very short, try to extract from uploaded PDF/DOCX file.
  // This covers applicants whose resume came as a binary attachment (not inline email text).
  let resumeText = String(applicant.resume_text || '')
  if (resumeText.length < 100 && applicant.resume_url && !String(applicant.resume_url).startsWith('http')) {
    const fileText = await extractResumeFileText(String(applicant.resume_url))
    if (fileText.length > resumeText.length) {
      resumeText = fileText
      // Persist so future scoring and AI summary use the richer text
      await query(`UPDATE hiring_applicants SET resume_text = $1 WHERE id = $2`, [resumeText, applicantId])
    }
  }

  // Always extract and save stated_role if not already stored
  if (resumeText && !applicant.stated_role) {
    const statedRole = await extractStatedRole(resumeText)
    if (statedRole) {
      await query(`UPDATE hiring_applicants SET stated_role = $1 WHERE id = $2`, [statedRole, applicantId])
      applicant.stated_role = statedRole
    }
  }

  // Auto-match role if none assigned - search ALL active roles so stated role is found cross-company
  if (!applicant.role_id && resumeText) {
    const roleOptions = await query(
      `SELECT id, title, required_skills FROM hiring_roles WHERE active = true`,
      [],
    )
    if (roleOptions.rows.length) {
      const matchedRoleId = await suggestRoleForApplicant(resumeText, roleOptions.rows, applicant.stated_role)
      if (matchedRoleId) {
        await query(`UPDATE hiring_applicants SET role_id = $1 WHERE id = $2`, [matchedRoleId, applicantId])
        const refetch = await query(
          `SELECT a.*, r.title AS role_title, r.required_skills, r.preferred_skills, r.is_technical,
                  co.name AS company_name
           FROM hiring_applicants a
           LEFT JOIN hiring_roles r ON r.id = a.role_id
           LEFT JOIN companies co   ON co.id = a.company_id
           WHERE a.id = $1`,
          [applicantId],
        )
        applicant = refetch.rows[0]
      }
    }
  }

  const requiredSkills = (applicant.required_skills as string[]) || []

  // Score via local LLM (Ollama + Gemma) - returns 503 if Ollama is unreachable
  if (!resumeText) return c.json({ error: 'No resume text available - cannot score' }, 422)

  let llmScore: LLMScore
  try {
    llmScore = await scoreResumeWithLLM(resumeText, String(applicant.role_title || 'Intern'), requiredSkills)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[score] Ollama unavailable:', msg)
    return c.json({ error: 'Ollama unavailable - score not updated' }, 503)
  }

  let newStage = applicant.stage as string

  const { rows: [settings] } = await query(
    `SELECT auto_shortlist_threshold, auto_reject_threshold FROM hiring_settings WHERE company_id = $1`,
    [applicant.company_id],
  )
  const shortlistThreshold = (settings?.auto_shortlist_threshold as number) ?? 75
  const rejectThreshold    = (settings?.auto_reject_threshold    as number) ?? 25

  if (llmScore.score < rejectThreshold && newStage === 'applied') {
    newStage = 'rejected'
  } else if (llmScore.score > shortlistThreshold && newStage === 'applied') {
    newStage = 'shortlisted'
  }

  await query(
    `UPDATE hiring_applicants SET
       ai_score = $1, ai_score_breakdown = $2::jsonb, ai_summary = $3,
       ai_scored_at = NOW(), stage = $4
     WHERE id = $5`,
    [llmScore.score, JSON.stringify(llmScore), llmScore.summary, newStage, applicantId],
  )

  // Extract and save contact details (best-effort)
  if (resumeText) {
    try {
      const resumeData = await extractResumeData(resumeText, String(applicant.role_title || 'Intern'))
      if (resumeData.skills.length > 0) {
        const contactUpdates: string[] = []
        const contactParams: unknown[] = []
        let ci = 1
        const maybeSet = (field: string, val: string | null | undefined) => {
          if (val) { contactUpdates.push(`${field} = $${ci++}`); contactParams.push(val) }
        }
        maybeSet('college', resumeData.college)
        maybeSet('phone', resumeData.phone)
        if (!applicant.github_url)    maybeSet('github_url', resumeData.github_url)
        if (!applicant.linkedin_url)  maybeSet('linkedin_url', resumeData.linkedin_url)
        if (!applicant.portfolio_url) maybeSet('portfolio_url', resumeData.portfolio_url)
        if (!applicant.year_of_study && resumeData.year_of_study)
          { contactUpdates.push(`year_of_study = $${ci++}`); contactParams.push(resumeData.year_of_study) }
        if (contactUpdates.length) {
          contactParams.push(applicantId)
          await query(`UPDATE hiring_applicants SET ${contactUpdates.join(', ')} WHERE id = $${ci}`, contactParams)
        }
      }
    } catch { /* non-fatal */ }
  }

  if (newStage === 'shortlisted' && applicant.is_technical != null) {
    const coRes = await query(`SELECT name FROM companies WHERE id = $1`, [applicant.company_id])
    const co    = coRes.rows[0] || { name: '' }
    const role  = { title: applicant.role_title || 'Intern' }
    await notifyReviewers(applicant, role, co, Boolean(applicant.is_technical)).catch(() => {})
  }

  const updated = await query(
    `SELECT a.*, r.title AS role_title, r.role_type, r.is_technical, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1`,
    [applicantId],
  )
  return c.json({ applicant: updated.rows[0] })
})

// ── PATCH /api/hiring/applicants/:id/role ──────────────────────────────────

app.patch('/api/hiring/applicants/:id/role', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const { role_id } = await c.req.json()

  const check = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds]
  )
  if (!check.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  await query(
    `UPDATE hiring_applicants SET role_id = $1, updated_at = NOW() WHERE id = $2`,
    [role_id || null, applicantId]
  )
  return c.json({ ok: true })
})

// ── PATCH /api/hiring/applicants/:id/stage ─────────────────────────────────

app.patch('/api/hiring/applicants/:id/stage', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const userId      = c.get('userId') as string
  const applicantId = c.req.param('id')
  const body        = await c.req.json()
  const { stage, rejection_reason, review_notes } = body

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, r.is_technical, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const applicant = appRes.rows[0]

  const updates: string[] = ['stage = $2']
  const params: unknown[] = [applicantId, stage]
  let p = 3

  updates.push(`reviewed_by = $${p++}`)
  params.push(userId)
  updates.push(`reviewed_at = NOW()`)

  if (rejection_reason) {
    updates.push(`rejection_reason = $${p++}`)
    params.push(rejection_reason)
  }
  if (review_notes) {
    updates.push(`review_notes = $${p++}`)
    params.push(review_notes)
  }
  if (stage === 'rejected') {
    updates.push(`rejection_queued_at = NOW()`)
  }
  if (stage === 'reviewed') {
    // no extra fields
  }

  await query(
    `UPDATE hiring_applicants SET ${updates.join(', ')} WHERE id = $1`,
    params,
  )

  if (stage === 'shortlisted') {
    const role = { title: applicant.role_title || 'Intern' }
    const co   = { name: applicant.company_name || '' }
    await notifyReviewers(applicant, role, co, Boolean(applicant.is_technical)).catch(() => {})
  }

  if (stage === 'rejected') {
    const reviewerRes = await query(
      `SELECT telegram_chat_id FROM users WHERE role IN ('ceo','coo') AND is_active = true AND telegram_chat_id IS NOT NULL`,
      [],
    )
    const reason = rejection_reason ? `\nReason: ${rejection_reason}` : ''
    const scoreInfo = applicant.ai_score ? ` (Score: ${applicant.ai_score}/100)` : ''
    const msg = `HIRING - Rejection Queued\n\nApplicant: ${applicant.name}${scoreInfo}\nEmail: ${applicant.email}${reason}\n\nRejection email sends in 48h unless cancelled in CBOP.`
    for (const row of reviewerRes.rows) {
      await sendViaOpenClaw({ channel: 'telegram', to: String(row.telegram_chat_id), message: msg }).catch(() => {})
    }
  }

  const updated = await query(`SELECT * FROM hiring_applicants WHERE id = $1`, [applicantId])
  return c.json({ applicant: updated.rows[0] })
})

// ── DELETE /api/hiring/applicants/:id ─────────────────────────────────────

app.delete('/api/hiring/applicants/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const { rows: [existing] } = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds]
  )
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // Delete child rows first (no ON DELETE CASCADE on these FKs)
  await query(`DELETE FROM hiring_batch_candidates WHERE applicant_id = $1`, [applicantId])
  await query(`DELETE FROM intern_records        WHERE applicant_id = $1`, [applicantId])
  await query(`DELETE FROM hiring_comments       WHERE applicant_id = $1`, [applicantId])
  await query(`DELETE FROM hiring_applicants     WHERE id = $1`,           [applicantId])
  return c.json({ ok: true })
})

// ── POST /api/hiring/applicants/:id/reject-now ─────────────────────────────

app.post('/api/hiring/applicants/:id/reject-now', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const body        = await c.req.json().catch(() => ({})) as { rejection_reason?: string }

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const applicant = appRes.rows[0]

  // If a reason was passed (from the reject box textarea), it overrides whatever
  // was previously stored - "Send Now" must send exactly what's on screen.
  if (typeof body.rejection_reason === 'string') {
    applicant.rejection_reason = body.rejection_reason
    await query(`UPDATE hiring_applicants SET rejection_reason = $2 WHERE id = $1`, [applicantId, body.rejection_reason])
  }

  const settingsRes = await getHiringSettings(String(applicant.company_id))
  await sendRejectionEmail(
    applicant,
    { title: applicant.role_title || 'Intern' },
    { name: applicant.company_name || '' },
    settingsRes?.rejection_email_template,
  )

  await query(
    `UPDATE hiring_applicants SET stage = 'rejected', rejection_sent_at = NOW(), rejection_queued_at = NOW()
     WHERE id = $1`,
    [applicantId],
  )

  return c.json({ success: true, rejection_sent_at: new Date().toISOString() })
})

// ── POST /api/hiring/applicants/:id/send-rejection (called by n8n) ─────────

app.post('/api/hiring/applicants/:id/send-rejection', async (c) => {
  const secret = c.req.header('x-n8n-secret') || c.req.header('x-cbop-secret')
  if (secret !== process.env.N8N_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const applicantId = c.req.param('id')

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.stage = 'rejected' AND a.rejection_sent_at IS NULL`,
    [applicantId],
  )
  if (!appRes.rows.length) return c.json({ skipped: true })

  const applicant = appRes.rows[0]
  const settingsRes = await getHiringSettings(String(applicant.company_id))

  await sendRejectionEmail(
    applicant,
    { title: applicant.role_title || 'Intern' },
    { name: applicant.company_name || '' },
    settingsRes?.rejection_email_template,
  )

  await query(
    `UPDATE hiring_applicants SET rejection_sent_at = NOW() WHERE id = $1`,
    [applicantId],
  )

  return c.json({ success: true })
})

// ── POST /api/hiring/applicants/:id/schedule-interview ────────────────────

app.post('/api/hiring/applicants/:id/schedule-interview', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const body        = await c.req.json()
  const { interview_at, meet_link, panel_user_ids } = body

  if (!interview_at) return c.json({ error: 'interview_at required' }, 400)

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, r.is_technical, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const applicant = appRes.rows[0]

  // Build panel info
  let panelUsers: { id: string; name: string; email: string; telegram_chat_id: string | null }[] = []
  if (Array.isArray(panel_user_ids) && panel_user_ids.length) {
    const panelRes = await query(
      `SELECT id, name, email, telegram_chat_id FROM users WHERE id = ANY($1)`,
      [panel_user_ids],
    )
    panelUsers = panelRes.rows as typeof panelUsers
  }

  const panelJson = JSON.stringify(panelUsers.map((u) => ({ user_id: u.id, name: u.name, telegram_chat_id: u.telegram_chat_id })))

  await query(
    `UPDATE hiring_applicants SET
       stage = 'interview_scheduled',
       interview_at = $2,
       interview_meet_link = $3,
       interview_panel = $4::jsonb
     WHERE id = $1`,
    [applicantId, interview_at, meet_link ?? null, panelJson],
  )

  // Send interview email to applicant
  const settingsRes = await getHiringSettings(String(applicant.company_id))
  const dt = new Date(interview_at)
  const dateStr = dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  const interviewer = panelUsers[0]?.name || 'Hiring Team'

  const vars = {
    applicant_name:   String(applicant.name),
    role_title:       String(applicant.role_title || 'Intern'),
    company_name:     String(applicant.company_name || ''),
    interview_date:   dateStr,
    interview_time:   timeStr,
    meet_link:        meet_link || '(link to be shared)',
    applicant_email:  String(applicant.email),
    interviewer_name: interviewer,
  }

  const emailBody = interpolate(settingsRes?.interview_email_template || DEFAULT_INTERVIEW_TEMPLATE, vars)

  try {
    const brand    = getCompanyBrand(applicant.company_id)
    const richHtml = await renderEmailTemplate('interview_confirmation', vars)
    await sendEmail({
      to:      String(applicant.email),
      subject: `Interview Invitation - ${applicant.role_title} at ${applicant.company_name}`,
      text:    emailBody,
      html:    richHtml ?? emailWrap(String(applicant.company_name), brand.accent, brand.tagline, textToEmailHtml(emailBody), 'Do not reply to this email.'),
    })
  } catch { /* non-fatal - interview still scheduled */ }

  // Fire n8n webhook for reminder scheduling
  const n8nUrl = process.env.N8N_URL
  if (n8nUrl) {
    fetch(`${n8nUrl}/webhook/interview-reminder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.N8N_WEBHOOK_SECRET ? { 'x-n8n-secret': process.env.N8N_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({
        applicant_id:        applicantId,
        interview_at:        interview_at,
        meet_link:           meet_link,
        panel_ids:           panel_user_ids,
        panel_names:         panelUsers.map((u) => u.name).join(', '),
        panel_telegram_ids:  panelUsers.map((u) => u.telegram_chat_id).filter(Boolean),
        applicant_email:     applicant.email,
      }),
    }).catch(() => {})
  }

  return c.json({ success: true, interview_at, meet_link })
})

// ── POST /api/hiring/applicants/:id/cancel-interview ─────────────────────
// Cancels a scheduled interview, reverts stage to shortlisted, sends cancellation email.
// Body: { reason?: string }

app.post('/api/hiring/applicants/:id/cancel-interview', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const body        = await c.req.json().catch(() => ({})) as { reason?: string }

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)
  const applicant = appRes.rows[0]

  if (!['interview_scheduled', 'interview_done'].includes(String(applicant.stage))) {
    return c.json({ error: 'No interview to cancel' }, 400)
  }

  await query(
    `UPDATE hiring_applicants SET
       stage = 'shortlisted',
       interview_at = NULL, interview_meet_link = NULL, interview_panel = '[]'::jsonb,
       updated_at = NOW()
     WHERE id = $1`,
    [applicantId],
  )

  const reason = body.reason?.trim() || 'Due to scheduling constraints, we need to reschedule your interview.'
  const dt     = applicant.interview_at ? new Date(String(applicant.interview_at)) : null
  const dateStr = dt ? dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'your scheduled interview'

  const emailHtml = `<p>Hi ${applicant.name},</p>
<p>We need to cancel your interview for the <strong>${applicant.role_title || 'internship'}</strong> position at <strong>${applicant.company_name}</strong> that was scheduled for <strong>${dateStr}</strong>.</p>
<p>${reason}</p>
<p>We will be in touch to reschedule. We apologise for any inconvenience caused.</p>
<p>Best regards,<br>${applicant.company_name} Hiring Team</p>`

  try {
    await sendEmail({
      to:      String(applicant.email),
      subject: `Interview Cancellation - ${applicant.role_title} at ${applicant.company_name}`,
      text:    emailHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
      html:    emailHtml,
    })
  } catch { /* non-fatal */ }

  return c.json({ success: true })
})

// ── POST /api/hiring/applicants/:id/generate-offer-from-template ─────────

app.post('/api/hiring/applicants/:id/generate-offer-from-template', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const userId      = c.get('userId') as string
  const applicantId = c.req.param('id')
  const body        = await c.req.json() as {
    template_id:    string
    email_subject?: string
    email_message?: string
  }
  const { template_id, email_subject, email_message } = body

  if (!template_id) return c.json({ error: 'template_id is required' }, 400)

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)
  const applicant = appRes.rows[0]

  const tplRes = await query(
    `SELECT * FROM document_templates WHERE id = $1 AND company_id = ANY($2)`,
    [template_id, companyIds],
  )
  if (!tplRes.rows.length) return c.json({ error: 'Template not found or wrong company' }, 404)
  const template = tplRes.rows[0]
  const tags: string[] = Array.isArray(template.tags) ? (template.tags as string[]) : []

  // Map applicant fields → template tags (case-insensitive key lookup)
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const src: Record<string, string> = {
    name:     String(applicant.name     || ''),
    email:    String(applicant.email    || ''),
    role:     String(applicant.role_title || 'Intern'),
    position: String(applicant.role_title || 'Intern'),
    date:     today,
    company:  String(applicant.company_name || ''),
    college:  String(applicant.college  || ''),
    duration: '3 months',
  }
  const recipientData: Record<string, string> = { email: src.email }
  for (const tag of tags) {
    recipientData[tag] = src[tag.toLowerCase()] ?? ''
  }

  const { rows: [batch] } = await query(
    `INSERT INTO document_batches
       (template_id, company_id, name, status, total_count, send_email, created_by)
     VALUES ($1,$2,$3,'pending',1,true,$4) RETURNING *`,
    [template_id, template.company_id as string, `Offer - ${applicant.name as string}`, userId],
  )

  const { runBatch } = await import('./documents')
  let generatedIds: string[] = []
  try {
    generatedIds = await runBatch(
      batch.id as string,
      template as Record<string, unknown>,
      [recipientData],
      true,
      email_subject || `Internship Offer - ${applicant.role_title as string} at ${applicant.company_name as string}`,
      email_message,
    )
  } catch (e) {
    console.error('[hiring] runBatch failed:', e instanceof Error ? e.message : e)
    return c.json({ error: 'PDF generation failed - offer not created' }, 500)
  }

  if (!generatedIds[0]) {
    return c.json({ error: 'PDF generation produced no output' }, 500)
  }

  await query(
    `UPDATE hiring_applicants SET stage = 'offer_sent', offer_sent_at = NOW(), offer_letter_url = $2 WHERE id = $1`,
    [applicantId, `doc:${generatedIds[0]}`],
  )

  return c.json({ ok: true, batch_id: batch.id })
})

// ── POST /api/hiring/applicants/:id/send-offer ────────────────────────────

app.post('/api/hiring/applicants/:id/send-offer', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const applicant = appRes.rows[0]
  const settingsRes = await getHiringSettings(String(applicant.company_id))

  const vars = {
    applicant_name: String(applicant.name),
    role_title:     String(applicant.role_title || 'Intern'),
    company_name:   String(applicant.company_name || ''),
  }
  const emailBody = interpolate(settingsRes?.offer_email_template || DEFAULT_OFFER_TEMPLATE, vars)

  // Attach the generated offer letter PDF. `offer_letter_url` is either:
  //  - `doc:<document_generated.id>` - Document Studio template, set by batch-complete
  //    or generate-offer-from-template
  //  - a raw filesystem path - legacy, from the old hardcoded Puppeteer generator
  const attachments = []
  if (applicant.offer_letter_url) {
    try {
      const urlStr = String(applicant.offer_letter_url)
      const fsp = await import('fs/promises')
      let pdfData: Buffer | null = null
      if (urlStr.startsWith('doc:')) {
        const { rows: [doc] } = await query(`SELECT pdf_path FROM document_generated WHERE id = $1`, [urlStr.slice(4)])
        if (doc?.pdf_path) {
          pdfData = await fsp.readFile(path.join(process.cwd(), 'uploads', 'document-pdfs', String(doc.pdf_path)))
        }
      } else {
        pdfData = await fsp.readFile(urlStr)
      }
      if (pdfData) {
        attachments.push({
          filename: `offer-${(applicant.name as string).replace(/\s+/g, '-')}.pdf`,
          content:  pdfData,
        })
      }
    } catch { /* attach nothing if file missing */ }
  }

  const offerBrand = getCompanyBrand(applicant.company_id)
  const offerRichHtml = await renderEmailTemplate('offer_letter_email', vars)
  await sendEmail({
    to:          String(applicant.email),
    subject:     `Internship Offer - ${applicant.role_title} at ${applicant.company_name}`,
    text:        emailBody,
    html:        offerRichHtml ?? emailWrap(String(applicant.company_name), offerBrand.accent, offerBrand.tagline, textToEmailHtml(emailBody), 'Do not reply to this email.'),
    attachments,
  })

  await query(
    `UPDATE hiring_applicants SET stage = 'offer_sent', offer_sent_at = NOW() WHERE id = $1`,
    [applicantId],
  )

  return c.json({ success: true, offer_sent_at: new Date().toISOString() })
})

// ── POST /api/hiring/applicants/:id/onboard ───────────────────────────────

app.post('/api/hiring/applicants/:id/onboard', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const body        = await c.req.json()
  const { team_lead_id, start_date } = body

  const appRes = await query(
    `SELECT a.*, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co   ON co.id = a.company_id
     WHERE a.id = $1 AND a.company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!appRes.rows.length) return c.json({ error: 'Applicant not found' }, 404)
  const applicant = appRes.rows[0]

  const settingsRes = await getHiringSettings(String(applicant.company_id))

  let teamLeadName  = ''
  let teamLeadEmail = ''
  if (team_lead_id) {
    const leadRes = await query(`SELECT name, email FROM users WHERE id = $1`, [team_lead_id])
    if (leadRes.rows.length) {
      teamLeadName  = String(leadRes.rows[0].name)
      teamLeadEmail = String(leadRes.rows[0].email)
    }
  }

  const startDateStr = start_date
    ? new Date(start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'To be confirmed'

  const vars = {
    applicant_name:  String(applicant.name),
    role_title:      String(applicant.role_title || 'Intern'),
    company_name:    String(applicant.company_name || ''),
    start_date:      startDateStr,
    team_lead_name:  teamLeadName || 'Your Team Lead',
    team_lead_email: teamLeadEmail || '',
  }

  // 1. Welcome email
  const welcomeBody    = interpolate(settingsRes?.welcome_email_template || DEFAULT_WELCOME_TEMPLATE, vars)
  const welcomeBrand   = getCompanyBrand(applicant.company_id)
  const welcomeRichHtml = await renderEmailTemplate('welcome_email', vars)
  await sendEmail({
    to:      String(applicant.email),
    subject: `Welcome to ${applicant.company_name}, ${applicant.name}!`,
    text:    welcomeBody,
    html:    welcomeRichHtml ?? emailWrap(String(applicant.company_name), welcomeBrand.accent, welcomeBrand.tagline, textToEmailHtml(welcomeBody), 'Do not reply to this email.'),
  }).catch(() => {})

  const now = new Date().toISOString()
  let slackSent    = false
  let discordSent  = false
  let wikiPageUrl: string | null = null

  // 2. Slack invite - notify Bala via Telegram to manually add the intern
  if (settingsRes?.slack_workspace_invite_url) {
    const balaRes = await query(
      `SELECT telegram_chat_id FROM users WHERE role = 'ceo' AND is_active = true AND telegram_chat_id IS NOT NULL LIMIT 1`,
    )
    if (balaRes.rows.length) {
      try {
        await sendViaOpenClaw({
          channel: 'telegram',
          to:      String(balaRes.rows[0].telegram_chat_id),
          message: `[HIRING] Please add ${applicant.name} to Slack:\n${settingsRes.slack_workspace_invite_url}`,
        })
        slackSent = true
      } catch { /* non-fatal */ }
    }
  }

  // 3. Discord invite
  if (settingsRes?.discord_invite_url) {
    try {
      await sendEmail({
        to:      String(applicant.email),
        subject: `Join our Discord - ${applicant.company_name}`,
        text:    `Hi ${applicant.name},\n\nJoin our Discord server: ${settingsRes.discord_invite_url}\n\nSee you there!`,
        html:    `Hi ${applicant.name},<br><br>Join our Discord server: <a href="${settingsRes.discord_invite_url}">${settingsRes.discord_invite_url}</a><br><br>See you there!`,
      })
      discordSent = true
    } catch { /* non-fatal */ }
  }

  // 4. Create Outline wiki page
  const outlineUrl   = process.env.OUTLINE_URL
  const outlineToken = process.env.OUTLINE_API_TOKEN
  if (outlineUrl && outlineToken) {
    try {
      const outlineRes = await fetch(`${outlineUrl}/api/documents.create`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${outlineToken}`,
        },
        body: JSON.stringify({
          title:     `${applicant.name} - ${applicant.role_title}`,
          text:      `# ${applicant.name}\n\n**Role:** ${applicant.role_title}\n**Company:** ${applicant.company_name}\n**Start Date:** ${startDateStr}\n**Team Lead:** ${teamLeadName}\n`,
          collectionId: process.env.OUTLINE_HIRING_COLLECTION_ID || undefined,
          publish:   true,
        }),
      })
      if (outlineRes.ok) {
        const outlineData = await outlineRes.json() as { data: { url: string } }
        wikiPageUrl = outlineData.data?.url || null
      }
    } catch { /* non-fatal */ }
  }

  // 5. Create intern_records row
  await query(
    `INSERT INTO intern_records (applicant_id, company_id, role_id, team_lead_id, start_date, status)
     VALUES ($1,$2,$3,$4,$5,'active')
     ON CONFLICT DO NOTHING`,
    [applicantId, applicant.company_id, applicant.role_id, team_lead_id ?? null, start_date ?? null],
  )

  // 6. Update applicant record
  await query(
    `UPDATE hiring_applicants SET
       stage = 'active_intern',
       slack_invited_at   = CASE WHEN $2 THEN NOW() ELSE NULL END,
       discord_invited_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
       wiki_page_url      = $4,
       onboarded_at       = NOW()
     WHERE id = $1`,
    [applicantId, slackSent, discordSent, wikiPageUrl],
  )

  // 7. Telegram to Bala
  const balaRes = await query(
    `SELECT telegram_chat_id FROM users WHERE role = 'ceo' AND is_active = true AND telegram_chat_id IS NOT NULL LIMIT 1`,
  )
  if (balaRes.rows.length) {
    await sendViaOpenClaw({
      channel: 'telegram',
      to:      String(balaRes.rows[0].telegram_chat_id),
      message: `[CBOP] New intern onboarded: ${applicant.name} for ${applicant.role_title} at ${applicant.company_name}`,
    }).catch(() => {})
  }

  return c.json({ success: true, wiki_url: wikiPageUrl, slack_sent: slackSent, discord_sent: discordSent })
})

// ── GET /api/hiring/roles ─────────────────────────────────────────────────

app.get('/api/hiring/roles', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const role       = c.get('role') as string
  const { company_id, active } = c.req.query()

  const conditions: string[] = ['r.company_id = ANY($1)']
  const params: unknown[]    = [companyIds]
  let p = 2

  // CTO sees technical roles only
  if (role === 'cto') conditions.push('r.is_technical = true')

  if (company_id && companyIds.includes(company_id)) {
    conditions.push(`r.company_id = $${p++}`)
    params.push(company_id)
  }
  if (active !== undefined) {
    conditions.push(`r.active = $${p++}`)
    params.push(active === 'true')
  }

  const result = await query(
    `SELECT r.*, co.name AS company_name,
            COUNT(a.id)::int AS applicant_count
     FROM hiring_roles r
     LEFT JOIN companies co ON co.id = r.company_id
     LEFT JOIN hiring_applicants a ON a.role_id = r.id AND a.stage != 'rejected'
     WHERE ${conditions.join(' AND ')}
     GROUP BY r.id, co.name
     ORDER BY r.created_at DESC`,
    params,
  )

  return c.json({ roles: result.rows })
})

// ── POST /api/hiring/roles ────────────────────────────────────────────────

app.post('/api/hiring/roles', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const body       = await c.req.json()
  const {
    company_id, title, role_type, employment_type, is_technical,
    description, required_skills, preferred_skills, min_year, slots,
  } = body

  if (!title || !company_id) return c.json({ error: 'title and company_id required' }, 400)
  if (!companyIds.includes(company_id)) return c.json({ error: 'Company not in scope' }, 403)

  const result = await query(
    `INSERT INTO hiring_roles
       (company_id, title, role_type, employment_type, is_technical,
        description, required_skills, preferred_skills, min_year, slots)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [company_id, title, role_type ?? null, employment_type ?? 'intern_unpaid',
     is_technical ?? true, description ?? null,
     required_skills ?? [], preferred_skills ?? [],
     min_year ?? 3, slots ?? 1],
  )

  return c.json({ role: result.rows[0] }, 201)
})

// ── PATCH /api/hiring/roles/:id ───────────────────────────────────────────

app.patch('/api/hiring/roles/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const roleId     = c.req.param('id')
  const body       = await c.req.json()

  const roleRes = await query(`SELECT company_id FROM hiring_roles WHERE id = $1`, [roleId])
  if (!roleRes.rows.length) return c.json({ error: 'Role not found' }, 404)
  if (!companyIds.includes(String(roleRes.rows[0].company_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const allowed = ['title','role_type','employment_type','is_technical','description',
                   'required_skills','preferred_skills','min_year','active','slots']
  const updates: string[] = []
  const params: unknown[] = [roleId]
  let p = 2

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = $${p++}`)
      params.push(body[key])
    }
  }
  if (!updates.length) return c.json({ error: 'No fields to update' }, 400)

  await query(`UPDATE hiring_roles SET ${updates.join(', ')} WHERE id = $1`, params)
  const updated = await query(`SELECT * FROM hiring_roles WHERE id = $1`, [roleId])
  return c.json({ role: updated.rows[0] })
})

// ── GET /api/hiring/settings/:company_id ─────────────────────────────────

app.get('/api/hiring/settings/:company_id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.param('company_id') as string

  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const res = await query(`SELECT * FROM hiring_settings WHERE company_id = $1`, [companyId])
  return c.json({ settings: res.rows[0] || null })
})

// ── PATCH /api/hiring/settings/:company_id ────────────────────────────────

app.patch('/api/hiring/settings/:company_id', requireAuth, requireRole('ceo'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const companyId  = c.req.param('company_id') as string

  if (!companyIds.includes(companyId)) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const allowed = [
    'rejection_delay_hours','auto_reject_threshold','auto_shortlist_threshold',
    'rejection_email_template','interview_email_template','offer_email_template',
    'welcome_email_template','google_calendar_id','slack_workspace_invite_url','discord_invite_url',
  ]

  const updates: string[] = ['company_id = $1', 'updated_at = NOW()']
  const params: unknown[] = [companyId]
  let p = 2

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = $${p++}`)
      params.push(body[key])
    }
  }

  await query(
    `INSERT INTO hiring_settings (company_id) VALUES ($1)
     ON CONFLICT (company_id) DO UPDATE SET ${updates.slice(2).join(', ')}, updated_at = NOW()`,
    params,
  )

  const res = await query(`SELECT * FROM hiring_settings WHERE company_id = $1`, [companyId])
  return c.json({ settings: res.rows[0] })
})

// ── GET /api/hiring/stats ─────────────────────────────────────────────────

app.get('/api/hiring/stats', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const companyId   = c.req.query('company_id')

  // Narrow to a single company if requested, still validated against user's allowed companies
  const scopedIds = companyId && companyIds.includes(companyId) ? [companyId] : companyIds

  const [stageRes, roleRes, avgRes, weekRes, interviewRes] = await Promise.all([
    query(
      `SELECT stage, COUNT(*)::int AS count FROM hiring_applicants
       WHERE company_id = ANY($1) GROUP BY stage`,
      [scopedIds],
    ),
    query(
      `SELECT r.title, COUNT(a.id)::int AS count
       FROM hiring_roles r
       LEFT JOIN hiring_applicants a ON a.role_id = r.id AND a.stage != 'rejected'
       WHERE r.company_id = ANY($1)
       GROUP BY r.id, r.title ORDER BY count DESC LIMIT 10`,
      [scopedIds],
    ),
    query(
      `SELECT COALESCE(AVG(ai_score), 0)::numeric AS avg_score
       FROM hiring_applicants WHERE company_id = ANY($1) AND ai_scored_at IS NOT NULL`,
      [scopedIds],
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM hiring_applicants
       WHERE company_id = ANY($1) AND created_at >= NOW() - INTERVAL '7 days'`,
      [scopedIds],
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM hiring_applicants
       WHERE company_id = ANY($1) AND stage = 'interview_scheduled'
         AND interview_at::date = CURRENT_DATE`,
      [scopedIds],
    ),
  ])

  const byStage = Object.fromEntries(stageRes.rows.map((r) => [r.stage, r.count]))
  const total   = stageRes.rows.reduce((sum, r) => sum + (r.count as number), 0)

  return c.json({
    total_applications: total,
    by_stage:           byStage,
    by_role:            roleRes.rows,
    avg_score:          parseFloat(String(avgRes.rows[0]?.avg_score || 0)),
    this_week_count:    weekRes.rows[0]?.count || 0,
    interviews_today:   interviewRes.rows[0]?.count || 0,
  })
})

// ── GET /api/hiring/interns ───────────────────────────────────────────────

app.get('/api/hiring/interns', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const result = await query(
    `SELECT ir.*, a.name AS applicant_name, a.email, a.phone,
            r.title AS role_title, co.name AS company_name,
            u.name  AS team_lead_name
     FROM intern_records ir
     JOIN hiring_applicants a ON a.id = ir.applicant_id
     LEFT JOIN hiring_roles r ON r.id = ir.role_id
     LEFT JOIN companies co   ON co.id = ir.company_id
     LEFT JOIN users u        ON u.id  = ir.team_lead_id
     WHERE ir.company_id = ANY($1)
     ORDER BY ir.created_at DESC`,
    [companyIds],
  )

  return c.json({ interns: result.rows })
})

// ── POST /api/hiring/notify-shortlisted ──────────────────────────────────────
// Personal blast to all shortlisted applicants - no bulk headers, optional PDF,
// 1000/day cap, 2s rate limit. Runs fire-and-forget in the background.

import { scanEmail } from '../lib/spam-scanner'
import { readFile }  from 'node:fs/promises'
import pathMod       from 'node:path'

const notifyRunning = new Set<string>() // keyed by company_id

app.post('/api/hiring/notify-shortlisted', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]

  const body = await c.req.json() as {
    company_id:   string
    subject:      string
    body_html:    string
    stages?:      string[]
    role_id?:     string
    pdf_path?:    string  // relative path under uploads/campaign-pdfs/
  }

  const { company_id, subject, body_html, pdf_path } = body
  const stages = body.stages?.length ? body.stages : ['shortlisted']
  const role_id = body.role_id ?? null

  if (!companyIds.includes(company_id)) return c.json({ error: 'Forbidden' }, 403)
  if (!subject || !body_html) return c.json({ error: 'subject and body_html are required' }, 400)
  if (notifyRunning.has(company_id)) return c.json({ error: 'A notification blast is already running for this company' }, 409)

  // Spam scan before doing anything
  const spamReport = scanEmail({ subject, html: body_html, isBulk: false })
  if (spamReport.level === 'block') {
    return c.json({ error: 'Blocked by spam scan', spam: spamReport }, 422)
  }

  // Fetch the applicants to notify
  const stageList = stages.map((_, i) => `$${i + 2}`).join(',')
  const params: unknown[] = [company_id, ...stages]
  if (role_id) params.push(role_id)
  const { rows: applicants } = await query(
    `SELECT a.id, a.name, a.email, r.title AS role_title, co.name AS company_name
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r  ON r.id  = a.role_id
     LEFT JOIN companies co    ON co.id = a.company_id
     WHERE a.company_id = $1 AND a.stage IN (${stageList})
       AND a.email IS NOT NULL AND a.email != ''
       ${role_id ? `AND a.role_id = $${params.length}` : ''}
     ORDER BY a.created_at ASC`,
    params
  )

  if (applicants.length === 0) return c.json({ error: 'No applicants found in the selected stages' }, 404)
  if (applicants.length > 1000) return c.json({ error: `Too many applicants (${applicants.length}). Filter by role or stage to stay under 1000.` }, 400)

  // Check daily cap upfront
  const senderEmail = process.env.SMTP_USER_CYBERCOM || process.env.SMTP_USER || ''
  if (await isAtDailyCap(senderEmail)) {
    return c.json({ error: `Daily send cap of ${await dailyCapFor(senderEmail)} reached for ${senderEmail}. Try again tomorrow.` }, 429)
  }

  // Acknowledge immediately, blast runs in background
  const jobId = crypto.randomUUID()

  ;(async () => {
    notifyRunning.add(company_id)
    let pdfBuffer: Buffer | null = null
    let pdfFilename = ''
    if (pdf_path) {
      try {
        const pdfDir = pathMod.join(process.cwd(), 'uploads', 'campaign-pdfs')
        pdfBuffer  = await readFile(pathMod.join(pdfDir, pdf_path))
        pdfFilename = pdf_path.replace(/^.*[\\/]/, '')
      } catch { /* missing PDF - continue without it */ }
    }

    for (const applicant of applicants) {
      if (await isAtDailyCap(senderEmail)) {
        console.warn(`[notify-shortlisted] daily cap hit mid-blast after ${applicants.indexOf(applicant)} of ${applicants.length}`)
        break
      }

      const mergeVars: Record<string, string> = {
        name:         applicant.name ?? '',
        role_title:   applicant.role_title ?? 'Intern',
        company_name: applicant.company_name ?? '',
        email:        applicant.email,
      }
      const merged = (s: string) =>
        s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => mergeVars[k] ?? '')

      await sendEmail({
        to:               applicant.email,
        subject:          merged(subject),
        html:             merged(body_html),
        companyId:        company_id,
        kind:             'hiring',
        enforceVerified:  true,
        respectSuppression: false,
        attachments: pdfBuffer ? [{ filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' }] : [],
      })

      await new Promise(r => setTimeout(r, 2000))
    }
    notifyRunning.delete(company_id)
  })().catch(e => { console.error('[notify-shortlisted]', e); notifyRunning.delete(company_id) })

  return c.json({
    ok:          true,
    job_id:      jobId,
    count:       applicants.length,
    spam:        spamReport,
    previews:    applicants.slice(0, 5).map(a => ({ name: a.name, email: a.email })),
  })
})

// ── GET /api/hiring/notify-shortlisted/status ────────────────────────────────
app.get('/api/hiring/notify-shortlisted/status', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const running = companyIds.some(id => notifyRunning.has(id))
  return c.json({ running })
})

// ── POST /api/hiring/upload-pdf ───────────────────────────────────────────────
// Temporary PDF upload for notify-shortlisted blast.
app.post('/api/hiring/upload-pdf', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const { mkdir: mkdirFs, writeFile: writeFileFs } = await import('node:fs/promises')
  const formData = await c.req.formData()
  const file = formData.get('pdf') as File | null
  if (!file || file.type !== 'application/pdf') return c.json({ error: 'PDF required' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'PDF must be under 5 MB' }, 400)
  const pdfDir = pathMod.join(process.cwd(), 'uploads', 'campaign-pdfs')
  await mkdirFs(pdfDir, { recursive: true })
  const filename = `hiring-${Date.now()}.pdf`
  await writeFileFs(pathMod.join(pdfDir, filename), Buffer.from(await file.arrayBuffer()))
  return c.json({ ok: true, filename })
})

// ── POST /api/hiring/applicants/:id/resume ─────────────────────────────────────
// Upload a resume file (PDF or image) for an applicant.
// Saves to uploads/resumes/ and updates hiring_applicants.resume_url.

const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/octet-stream', // some browsers send PDF as this
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const ALLOWED_RESUME_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif'])

app.post('/api/hiring/applicants/:id/resume', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const { mkdir: mkdirFs, writeFile: writeFileFs } = await import('node:fs/promises')

  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  // Verify applicant belongs to user's companies
  const existing = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!existing.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('resume') as File | null

  if (!file) return c.json({ error: 'No file provided - send field name "resume"' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File must be under 10 MB' }, 400)

  // Determine extension from original filename
  const originalName = file.name || 'resume'
  const dotIdx       = originalName.lastIndexOf('.')
  const ext          = dotIdx >= 0 ? originalName.slice(dotIdx).toLowerCase() : ''

  // Validate MIME type - allow pdf-as-octet-stream only when extension is .pdf
  const mimeOk = ALLOWED_RESUME_TYPES.has(file.type)
  const extOk  = ALLOWED_RESUME_EXTENSIONS.has(ext)

  if (!mimeOk && !extOk) {
    return c.json({ error: 'Only PDF and image files are allowed (jpg, png, webp, gif, pdf)' }, 415)
  }

  // Resolve extension: prefer filename ext, fall back to mime-derived
  let resolvedExt = ext
  if (!resolvedExt) {
    if (file.type === 'application/pdf' || file.type === 'application/octet-stream') resolvedExt = '.pdf'
    else if (file.type === 'image/jpeg') resolvedExt = '.jpg'
    else if (file.type === 'image/png')  resolvedExt = '.png'
    else if (file.type === 'image/webp') resolvedExt = '.webp'
    else if (file.type === 'image/gif')  resolvedExt = '.gif'
    else resolvedExt = '.bin'
  }

  const resumeDir = pathMod.join(process.cwd(), 'uploads', 'resumes')
  await mkdirFs(resumeDir, { recursive: true })

  const filename    = `resume-${applicantId}-${Date.now()}${resolvedExt}`
  const filePath    = pathMod.join(resumeDir, filename)
  const resumeUrl   = `/uploads/resumes/${filename}`

  await writeFileFs(filePath, Buffer.from(await file.arrayBuffer()))

  await query(
    `UPDATE hiring_applicants SET resume_url = $1 WHERE id = $2`,
    [resumeUrl, applicantId],
  )

  return c.json({ ok: true, resume_url: resumeUrl })
})

// ── GET /api/hiring/applicants/:id/resume/file ────────────────────────────────
// Serve an uploaded resume file directly from disk.

app.get('/api/hiring/applicants/:id/resume/file', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const { readFile: readFileFs } = await import('node:fs/promises')
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  const result = await query(
    `SELECT resume_url FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!result.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const resumeUrl = result.rows[0].resume_url as string | null
  if (!resumeUrl) return c.json({ error: 'No resume uploaded' }, 404)

  // Only serve files under uploads/resumes/ to prevent path traversal
  const filename = pathMod.basename(resumeUrl)
  const filePath = pathMod.join(process.cwd(), 'uploads', 'resumes', filename)

  let fileBuffer: Buffer
  try {
    fileBuffer = await readFileFs(filePath)
  } catch {
    return c.json({ error: 'File not found on disk' }, 404)
  }

  const ext = pathMod.extname(filename).toLowerCase()
  const isDoc = ext === '.doc' || ext === '.docx'
  const contentType =
    ext === '.pdf'  ? 'application/pdf' :
    ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
    ext === '.doc'  ? 'application/msword' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    ext === '.png'  ? 'image/png' :
    ext === '.webp' ? 'image/webp' :
    ext === '.gif'  ? 'image/gif' :
    'application/octet-stream'

  // Bulk-read/export of a candidate's personal data — DPDP evidence.
  await writeAuditLogForRequest(c, {
    action:       AUDIT_ACTIONS.exportApplicantFile,
    resourceType: 'hiring_applicants',
    resourceId:   applicantId,
    after:        { filename, content_type: contentType, bytes: fileBuffer.length },
  })

  return new Response(fileBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': `${isDoc ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control':       'private, max-age=3600',
    },
  })
})

// ── GET /api/hiring/applicants/:id/resume/html ───────────────────────────────
// Converts a DOCX resume to HTML via mammoth and returns { html }.

app.get('/api/hiring/applicants/:id/resume/html', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  const result = await query(
    `SELECT resume_url FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!result.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const resumeUrl = result.rows[0].resume_url as string | null
  if (!resumeUrl) return c.json({ error: 'No resume uploaded' }, 404)

  const filename = pathMod.basename(resumeUrl)
  if (!/\.docx$/i.test(filename)) return c.json({ error: 'Not a DOCX file' }, 400)

  const filePath = pathMod.join(process.cwd(), 'uploads', 'resumes', filename)

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth') as { convertToHtml: (opts: { path: string }) => Promise<{ value: string }> }
    const res = await mammoth.convertToHtml({ path: filePath })
    return c.json({ html: res.value })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[resume/html] mammoth error:', msg)
    return c.json({ error: 'Failed to convert document' }, 500)
  }
})

// ── PATCH /api/hiring/applicants/:id/tags ─────────────────────────────────────

app.patch('/api/hiring/applicants/:id/tags', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')
  const body        = await c.req.json() as { tags?: unknown }

  if (!Array.isArray(body.tags)) return c.json({ error: 'tags must be an array' }, 400)

  const tags = body.tags as unknown[]
  if (tags.length > 10) return c.json({ error: 'Max 10 tags allowed' }, 400)
  for (const t of tags) {
    if (typeof t !== 'string') return c.json({ error: 'Each tag must be a string' }, 400)
    if (t.length > 30) return c.json({ error: 'Each tag must be 30 chars or fewer' }, 400)
  }

  const check = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!check.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  await query(
    `UPDATE hiring_applicants SET tags = $1 WHERE id = $2`,
    [tags, applicantId],
  )

  return c.json({ ok: true })
})

// ── GET /api/hiring/applicants/:id/comments ───────────────────────────────────

app.get('/api/hiring/applicants/:id/comments', requireAuth, async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const applicantId = c.req.param('id')

  const check = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!check.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const result = await query(
    `SELECT id, user_id, user_name, body, created_at
     FROM hiring_comments
     WHERE applicant_id = $1
     ORDER BY created_at DESC`,
    [applicantId],
  )

  return c.json({ comments: result.rows })
})

// ── POST /api/hiring/applicants/:id/comments ──────────────────────────────────

app.post('/api/hiring/applicants/:id/comments', requireAuth, async (c) => {
  const companyIds  = c.get('companyIds') as string[]
  const userId      = c.get('userId') as string
  const applicantId = c.req.param('id')
  const body        = await c.req.json() as { body?: unknown }

  if (!body.body || typeof body.body !== 'string' || !body.body.trim()) {
    return c.json({ error: 'body is required' }, 400)
  }

  const check = await query(
    `SELECT id FROM hiring_applicants WHERE id = $1 AND company_id = ANY($2)`,
    [applicantId, companyIds],
  )
  if (!check.rows.length) return c.json({ error: 'Applicant not found' }, 404)

  const userRow = await query(`SELECT name FROM users WHERE id = $1`, [userId])
  const userName = userRow.rows[0]?.name ?? 'Unknown'

  const result = await query(
    `INSERT INTO hiring_comments (applicant_id, user_id, user_name, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, user_name, body, created_at`,
    [applicantId, userId, userName, body.body.trim()],
  )

  return c.json({ comment: result.rows[0] }, 201)
})

// ── DELETE /api/hiring/comments/:id ──────────────────────────────────────────

app.delete('/api/hiring/comments/:id', requireAuth, async (c) => {
  const userId    = c.get('userId') as string
  const role      = c.get('role') as string
  const commentId = c.req.param('id')

  const check = await query(
    `SELECT id, user_id FROM hiring_comments WHERE id = $1`,
    [commentId],
  )
  if (!check.rows.length) return c.json({ error: 'Comment not found' }, 404)

  const comment = check.rows[0]
  if (comment.user_id !== userId && role !== 'ceo') {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await query(`DELETE FROM hiring_comments WHERE id = $1`, [commentId])

  return c.json({ ok: true })
})

export default app
