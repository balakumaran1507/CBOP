import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { requireRole } from '../middleware/require-role'
import { query, transaction } from '../lib/db'
import { sendEmail } from '../lib/mailer'
import { sendViaOpenClaw } from '../lib/openclaw'
import { getCompanyBrand } from '../lib/company-brand'
import '../lib/hono-vars'

const app = new Hono()

// Thrown inside a transaction() callback to bail out with a specific HTTP
// status once the row lock (SELECT ... FOR UPDATE) confirms the batch isn't
// in the state the caller expects — e.g. a concurrent request already
// started/advanced it. transaction() rolls back on any thrown error, so this
// never leaves a half-applied write behind.
class RouteError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ── Company branding ──────────────────────────────────────────────────────────
// Sourced from companies.logo_initials / companies.email_branding via
// api/lib/company-brand.ts - see that file for why (used to be a hardcoded
// map here, byte-for-byte duplicated in hiring.ts).

// ── Email builders ────────────────────────────────────────────────────────────

export const EMAIL_FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica Neue,Arial,sans-serif`
export const EMAIL_MONO = `ui-monospace,'Cascadia Code','Courier New',monospace`

export function emailWrap(companyName: string, accent: string, tagline: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8F9FA;font-family:${EMAIL_FONT};">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E5E7EB;">

        <tr><td style="background:${accent};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #E5E7EB;">
            <div style="font-size:16px;font-weight:700;color:#0F1117;letter-spacing:-0.3px;">${companyName}</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">${tagline}</div>
          </td>
        </tr>

        <tr><td style="padding:32px 32px 28px;">${body}</td></tr>

        <tr>
          <td style="padding:16px 32px;border-top:1px solid #E5E7EB;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">${footer}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildPrepEmail(opts: {
  name: string
  position: number
  total: number
  estimatedTime: string
  batchDate: string
  companyName: string
  companyId: string
  roleTitle: string
}): string {
  const brand = getCompanyBrand(opts.companyId)

  const body = `
    <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0F1117;letter-spacing:-0.4px;">Interview Scheduled</p>
    <p style="margin:0 0 24px;font-size:13px;color:#6B7280;">${opts.batchDate}</p>

    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Hi <strong>${opts.name}</strong>, you have been selected for an interview for the <strong>${opts.roleTitle}</strong> role at ${opts.companyName}.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border:1px solid #E5E7EB;margin:0 0 24px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:10px;font-weight:600;color:#6B7280;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">Your Slot</div>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#6B7280;padding:4px 28px 4px 0;white-space:nowrap;">Position in queue</td>
            <td style="font-size:14px;font-weight:600;color:#0F1117;font-family:${EMAIL_MONO};">${opts.position} of ${opts.total}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6B7280;padding:4px 28px 4px 0;white-space:nowrap;">Estimated start</td>
            <td style="font-size:14px;font-weight:600;color:#0F1117;font-family:${EMAIL_MONO};">${opts.estimatedTime} IST</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
      <strong>Do not join the meeting yet.</strong> We will send you the link via WhatsApp and email the moment it is your turn. Keep your phone nearby.
    </p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#374151;">
      Please be ready to join within <strong>2 minutes</strong> of receiving the notification.
    </p>

    <div style="border-top:1px solid #E5E7EB;padding-top:20px;">
      <p style="margin:0;font-size:13px;color:#6B7280;">Warm regards,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0F1117;">${brand.signoff}</p>
    </div>`

  return emailWrap(
    opts.companyName, brand.accent, brand.tagline, body,
    `You are receiving this because you applied for an internship at ${opts.companyName}. Do not reply to this email.`,
  )
}

function buildTurnEmail(opts: {
  name: string
  companyName: string
  companyId: string
  meetLink: string
}): string {
  const brand = getCompanyBrand(opts.companyId)

  const body = `
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#0F1117;letter-spacing:-0.4px;">Your interview is ready.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
      Hi <strong>${opts.name}</strong>, the panel at <strong>${opts.companyName}</strong> is ready for you. Please join immediately.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background:${brand.accent};border-radius:8px;">
          <a href="${opts.meetLink}" target="_blank"
             style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.2px;">
            Join Interview Now
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 6px;font-size:12px;color:#6B7280;">If the button does not open, copy this link:</p>
    <p style="margin:0 0 24px;font-size:12px;color:#0F1117;font-family:${EMAIL_MONO};word-break:break-all;">${opts.meetLink}</p>

    <p style="margin:0 0 28px;font-size:14px;font-weight:600;color:#B91C1C;">Please join within 2 minutes - the panel is waiting.</p>

    <div style="border-top:1px solid #E5E7EB;padding-top:20px;">
      <p style="margin:0;font-size:13px;color:#6B7280;">See you soon,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0F1117;">${brand.signoff}</p>
    </div>`

  return emailWrap(
    opts.companyName, brand.accent, brand.tagline, body,
    `You are receiving this because you are scheduled for an interview at ${opts.companyName}. Do not reply to this email.`,
  )
}

// ── POST /api/hiring/batches ──────────────────────────────────────────────────

app.post('/api/hiring/batches', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const userId     = c.get('userId')

  const body = await c.req.json() as {
    company_id:      string
    role_id?:        string
    meet_link:       string
    batch_name?:     string
    slot_duration?:  number
    buffer_minutes?: number
    scheduled_at:    string
    panel?:          { user_id: string; name: string }[]
    applicant_ids:   string[]
  }

  const {
    company_id, role_id, meet_link, batch_name,
    scheduled_at, panel, applicant_ids,
  } = body
  const slot_duration  = body.slot_duration  ?? 15
  const buffer_minutes = body.buffer_minutes ?? 2

  // Validate
  if (!meet_link?.trim())   return c.json({ error: 'meet_link is required' }, 400)
  if (!scheduled_at)        return c.json({ error: 'scheduled_at is required' }, 400)
  if (!Array.isArray(applicant_ids) || applicant_ids.length === 0) {
    return c.json({ error: 'applicant_ids must be a non-empty array' }, 400)
  }
  if (new Date(scheduled_at) <= new Date()) {
    return c.json({ error: 'scheduled_at must be in the future' }, 400)
  }
  if (!companyIds.includes(company_id)) {
    return c.json({ error: 'Company not in scope' }, 403)
  }

  // Look up company for emails
  const coRes = await query(`SELECT name FROM companies WHERE id = $1`, [company_id])
  const companyName = coRes.rows[0]?.name as string ?? ''

  // Insert the batch (role_id is optional - batches can span multiple roles)
  const batchRes = await query(
    `INSERT INTO hiring_batches
       (company_id, role_id, created_by, meet_link, batch_name,
        slot_duration, buffer_minutes, scheduled_at, panel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING *`,
    [
      company_id, role_id ?? null, userId, meet_link, batch_name ?? null,
      slot_duration, buffer_minutes, scheduled_at,
      JSON.stringify(panel ?? []),
    ],
  )
  const batch = batchRes.rows[0]
  const batchId = batch.id as string

  // Insert candidates in order + compute estimated_at
  const scheduledDate = new Date(scheduled_at)
  const candidateRows: Array<{ position: number; estimated_at: Date }> = []

  for (let i = 0; i < applicant_ids.length; i++) {
    const position    = i + 1
    const offsetMins  = i * (slot_duration + buffer_minutes)
    const estimated   = new Date(scheduledDate.getTime() + offsetMins * 60_000)
    candidateRows.push({ position, estimated_at: estimated })

    await query(
      `INSERT INTO hiring_batch_candidates
         (batch_id, applicant_id, position, estimated_at)
       VALUES ($1,$2,$3,$4)`,
      [batchId, applicant_ids[i], position, estimated.toISOString()],
    )
  }

  // Mark all applicants as having been invited_at
  await query(
    `UPDATE hiring_batch_candidates SET invited_at = NOW() WHERE batch_id = $1`,
    [batchId],
  )

  // Fetch applicant details for prep emails - include their individual role title
  const appsRes = await query(
    `SELECT a.id, a.name, a.email, COALESCE(r.title, 'Intern') AS role_title
     FROM hiring_applicants a
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     WHERE a.id = ANY($1)`,
    [applicant_ids],
  )
  const appsMap = new Map<string, { name: string; email: string; role_title: string }>(
    (appsRes.rows as Array<{ id: string; name: string; email: string; role_title: string }>).map((r) => [r.id, r])
  )

  // Format batch date for humans
  const batchDate = scheduledDate.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  // Send prep emails to all candidates fire-and-forget
  let prepEmailsSent = 0
  const emailJobs = applicant_ids.map(async (appId, i) => {
    const applicant = appsMap.get(appId)
    if (!applicant?.email) return

    const position   = i + 1
    const offsetMins = i * (slot_duration + buffer_minutes)
    const estimated  = new Date(scheduledDate.getTime() + offsetMins * 60_000)
    const timeStr    = estimated.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).toUpperCase()

    try {
      const roleTitle = applicant.role_title
      await sendEmail({
        to:                  applicant.email,
        subject:             `Interview Scheduled - ${roleTitle} at ${companyName} | Slot ${position} of ${applicant_ids.length}`,
        html:                buildPrepEmail({
          name:          applicant.name,
          position,
          total:         applicant_ids.length,
          estimatedTime: timeStr,
          batchDate,
          companyName,
          companyId:     company_id,
          roleTitle,
        }),
        companyId:           company_id,
        kind:                'hiring',
        enforceVerified:     false,
        respectSuppression:  false,
      })
      prepEmailsSent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[hiring-batches] prep email failed for ${applicant.email}:`, msg)
    }
  })

  // Fire all emails in parallel, don't block response
  Promise.all(emailJobs).catch((e) => console.error('[hiring-batches] prep email batch error:', e))

  return c.json({ ok: true, batch_id: batchId, count: applicant_ids.length, prep_emails_sent: prepEmailsSent }, 201)
})

// ── GET /api/hiring/batches ───────────────────────────────────────────────────

app.get('/api/hiring/batches', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const { status } = c.req.query()

  const conditions: string[] = ['b.company_id = ANY($1)']
  const params: unknown[]    = [companyIds]
  let p = 2

  if (status) {
    conditions.push(`b.status = $${p++}`)
    params.push(status)
  }

  const result = await query(
    `SELECT b.*,
            co.name AS company_name,
            r.title AS role_title,
            COUNT(bc.id)::int AS candidate_count
     FROM hiring_batches b
     LEFT JOIN companies co ON co.id = b.company_id
     LEFT JOIN hiring_roles r ON r.id = b.role_id
     LEFT JOIN hiring_batch_candidates bc ON bc.batch_id = b.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY b.id, co.name, r.title
     ORDER BY b.scheduled_at DESC
     LIMIT 20`,
    params,
  )

  return c.json({ batches: result.rows })
})

// ── GET /api/hiring/batches/:id ───────────────────────────────────────────────

app.get('/api/hiring/batches/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const batchId    = c.req.param('id')

  const batchRes = await query(
    `SELECT b.*, co.name AS company_name, r.title AS role_title
     FROM hiring_batches b
     LEFT JOIN companies co ON co.id = b.company_id
     LEFT JOIN hiring_roles r ON r.id = b.role_id
     WHERE b.id = $1`,
    [batchId],
  )
  if (!batchRes.rows.length) return c.json({ error: 'Batch not found' }, 404)

  const batch = batchRes.rows[0]
  if (!companyIds.includes(String(batch.company_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const candidatesRes = await query(
    `SELECT bc.*,
            a.name, a.email, a.phone, a.ai_score, a.ai_summary,
            a.stage, a.resume_url, a.college
     FROM hiring_batch_candidates bc
     JOIN hiring_applicants a ON a.id = bc.applicant_id
     WHERE bc.batch_id = $1
     ORDER BY bc.position ASC`,
    [batchId],
  )

  const batchWithCandidates = {
    ...batch,
    candidates: candidatesRes.rows,
  }

  return c.json({ batch: batchWithCandidates })
})

// ── PATCH /api/hiring/batches/:id/start ───────────────────────────────────────

app.patch('/api/hiring/batches/:id/start', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const batchId    = c.req.param('id')

  // Everything that reads-then-writes batch.status/current_index happens inside
  // one transaction holding a row lock (FOR UPDATE), so two concurrent /start
  // calls for the same batch can't both observe status='pending' and both
  // activate it — the second one blocks until the first commits, then sees
  // the now-'active' row and cleanly 409s instead of re-running activation.
  let batch: Record<string, unknown>
  let firstApplicant: { name: string; email: string; phone: string | null } | null = null
  try {
    batch = await transaction(async (client) => {
      const batchRes = await client.query(
        `SELECT b.*, co.name AS company_name
         FROM hiring_batches b
         LEFT JOIN companies co ON co.id = b.company_id
         WHERE b.id = $1
         FOR UPDATE OF b`,
        [batchId],
      )
      if (!batchRes.rows.length) throw new RouteError(404, 'Batch not found')

      const row = batchRes.rows[0]
      if (!companyIds.includes(String(row.company_id))) throw new RouteError(403, 'Forbidden')
      if (row.status !== 'pending') throw new RouteError(409, `Batch is already ${row.status}`)

      await client.query(
        `UPDATE hiring_batches SET status = 'active', current_index = 0 WHERE id = $1`,
        [batchId],
      )

      const firstRes = await client.query(
        `UPDATE hiring_batch_candidates SET status = 'current', turn_sent_at = NOW()
         WHERE batch_id = $1 AND position = 1
         RETURNING applicant_id`,
        [batchId],
      )
      if (firstRes.rows.length) {
        const appRes = await client.query(
          `SELECT a.name, a.email, a.phone FROM hiring_applicants a WHERE a.id = $1`,
          [firstRes.rows[0].applicant_id],
        )
        if (appRes.rows.length) firstApplicant = appRes.rows[0]
      }
      return row
    })
  } catch (err) {
    if (err instanceof RouteError) return c.json({ error: err.message }, err.status as 403 | 404 | 409)
    throw err
  }

  // Notifications are external I/O (WhatsApp/email) — fire after the
  // transaction has committed, never while holding the row lock.
  if (firstApplicant) {
    const applicant   = firstApplicant as { name: string; email: string; phone: string | null }
    const companyName = batch.company_name as string
    const meetLink     = batch.meet_link as string
    const companyId    = batch.company_id as string

    // Fire and forget - WhatsApp
    if (applicant.phone) {
      sendViaOpenClaw({
        channel: 'whatsapp',
        to:      String(applicant.phone),
        message: `Hi ${applicant.name}! 🎯 It's your turn for the interview with ${companyName}. Please join now:\n\n${meetLink}\n\nSee you soon! 👋`,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[hiring-batches] WhatsApp send failed:', msg)
      })
    }

    // Fire and forget - turn email
    sendEmail({
      to:                 String(applicant.email),
      subject:            `Join Now - Your Interview is Ready | ${companyName}`,
      html:               buildTurnEmail({ name: String(applicant.name), companyName, meetLink, companyId }),
      companyId,
      kind:               'hiring',
      enforceVerified:    false,
      respectSuppression: false,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[hiring-batches] turn email failed:', msg)
    })
  }

  const updated = await query(`SELECT * FROM hiring_batches WHERE id = $1`, [batchId])
  return c.json({ ok: true, batch: updated.rows[0] })
})

// ── PATCH /api/hiring/batches/:id/next ───────────────────────────────────────

app.patch('/api/hiring/batches/:id/next', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const batchId    = c.req.param('id')

  const body = await c.req.json() as {
    decision:       'accept' | 'reject' | 'hold'
    notes?:         string
    expected_index?: number
  }
  const { decision, notes, expected_index } = body

  if (!['accept', 'reject', 'hold'].includes(decision)) {
    return c.json({ error: 'decision must be accept, reject, or hold' }, 400)
  }

  // Row lock (FOR UPDATE) serializes concurrent /next calls for the same batch
  // so the second call blocks until the first transaction commits — no lost
  // updates. On its own that's not enough: the second call would then just
  // read the freshly-advanced row and quietly decide the next candidate down
  // the line, which is worse than a stale read. The expected_index check
  // below (against the current_index the client had loaded) is what actually
  // turns that into a clean 409 instead of silent mis-processing.
  type NextResult =
    | { kind: 'conflict'; status: number; message: string }
    | { kind: 'complete'; companyName: string; summary: { total: number; accepted: number; rejected: number; held: number } }
    | { kind: 'advanced'; companyName: string; meetLink: string; companyId: string; nextPosition: number; nextApplicant: Record<string, unknown> }

  const result = await transaction<NextResult>(async (client) => {
    const batchRes = await client.query(
      `SELECT b.*, co.name AS company_name
       FROM hiring_batches b
       LEFT JOIN companies co ON co.id = b.company_id
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [batchId],
    )
    if (!batchRes.rows.length) return { kind: 'conflict', status: 404, message: 'Batch not found' }

    const batch = batchRes.rows[0]
    if (!companyIds.includes(String(batch.company_id))) {
      return { kind: 'conflict', status: 403, message: 'Forbidden' }
    }
    if (batch.status !== 'active') {
      return { kind: 'conflict', status: 409, message: 'Batch is not active — it may have already been advanced or completed by another request' }
    }

    const currentIndex    = batch.current_index as number
    const currentPosition = currentIndex + 1

    // The row lock above (FOR UPDATE OF b) serializes concurrent /next calls,
    // but by itself it only prevents the two writes from corrupting each
    // other — it does NOT stop a second, now-unblocked request from silently
    // applying its decision to whatever candidate is "current" *after* the
    // first request already advanced the batch. A double-click or two open
    // tabs both read the same current_index into their UI before either
    // request lands; expected_index carries that stale snapshot through to
    // here so the second request can be told its view is stale and bail with
    // 409 instead of deciding the wrong candidate.
    if (typeof expected_index === 'number' && expected_index !== currentIndex) {
      return {
        kind: 'conflict',
        status: 409,
        message: 'Batch has already advanced by another request — your view is stale, please refresh',
      }
    }

    // Save decision to current candidate
    await client.query(
      `UPDATE hiring_batch_candidates
       SET status = 'done', decision = $1, interview_notes = $2, decided_at = NOW()
       WHERE batch_id = $3 AND position = $4`,
      [decision, notes ?? null, batchId, currentPosition],
    )

    // Map decision to applicant stage
    const stageMap: Record<string, string> = {
      accept: 'selected',
      reject: 'rejected',
      hold:   'shortlisted',
    }
    const newStage = stageMap[decision]

    // Update applicant stage - get applicant_id from current candidate
    const currentCandRes = await client.query(
      `SELECT applicant_id FROM hiring_batch_candidates WHERE batch_id = $1 AND position = $2`,
      [batchId, currentPosition],
    )
    if (currentCandRes.rows.length) {
      const applicantId = currentCandRes.rows[0].applicant_id as string
      await client.query(
        `UPDATE hiring_applicants SET stage = $1 WHERE id = $2`,
        [newStage, applicantId],
      )
    }

    // Advance current_index
    const nextIndex    = currentIndex + 1
    const nextPosition = nextIndex + 1

    // Check if next candidate exists
    const nextCandRes = await client.query(
      `SELECT bc.id, bc.applicant_id FROM hiring_batch_candidates bc
       WHERE bc.batch_id = $1 AND bc.position = $2`,
      [batchId, nextPosition],
    )

    if (nextCandRes.rows.length === 0) {
      // No more candidates - complete the batch
      await client.query(
        `UPDATE hiring_batches
         SET status = 'complete', current_index = $1, completed_at = NOW()
         WHERE id = $2`,
        [nextIndex, batchId],
      )

      const summaryRes = await client.query(
        `SELECT decision, COUNT(*)::int AS n
         FROM hiring_batch_candidates
         WHERE batch_id = $1 AND decision IS NOT NULL
         GROUP BY decision`,
        [batchId],
      )
      const summaryMap = Object.fromEntries(
        (summaryRes.rows as Array<{ decision: string; n: number }>).map((r) => [r.decision, r.n])
      )
      const totalRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM hiring_batch_candidates WHERE batch_id = $1`,
        [batchId],
      )

      return {
        kind: 'complete',
        companyName: batch.company_name as string,
        summary: {
          total:    totalRes.rows[0]?.n ?? 0,
          accepted: summaryMap['accept']  ?? 0,
          rejected: summaryMap['reject']  ?? 0,
          held:     summaryMap['hold']    ?? 0,
        },
      }
    }

    // There is a next candidate - set them to 'current'
    const nextApplicantId = nextCandRes.rows[0].applicant_id as string

    await client.query(
      `UPDATE hiring_batch_candidates
       SET status = 'current', turn_sent_at = NOW()
       WHERE batch_id = $1 AND position = $2`,
      [batchId, nextPosition],
    )

    await client.query(
      `UPDATE hiring_batches SET current_index = $1 WHERE id = $2`,
      [nextIndex, batchId],
    )

    const nextAppRes = await client.query(
      `SELECT id, name, email, phone, ai_score, ai_summary, stage, college
       FROM hiring_applicants WHERE id = $1`,
      [nextApplicantId],
    )

    return {
      kind: 'advanced',
      companyName:   batch.company_name as string,
      meetLink:      batch.meet_link as string,
      companyId:     batch.company_id as string,
      nextPosition,
      nextApplicant: nextAppRes.rows[0] ?? null,
    }
  })

  if (result.kind === 'conflict') return c.json({ error: result.message }, result.status as 403 | 404 | 409)

  if (result.kind === 'complete') {
    return c.json({ ok: true, complete: true, summary: result.summary })
  }

  // kind === 'advanced' — fire notifications after the transaction committed,
  // never while holding the row lock.
  const { companyName, meetLink, companyId, nextPosition, nextApplicant } = result
  if (nextApplicant) {
    const applicant = nextApplicant as { name: string; email: string; phone: string | null }

    if (applicant.phone) {
      sendViaOpenClaw({
        channel: 'whatsapp',
        to:      String(applicant.phone),
        message: `Hi ${applicant.name}! 🎯 It's your turn for the interview with ${companyName}. Please join now:\n\n${meetLink}\n\nSee you soon! 👋`,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[hiring-batches] WhatsApp send failed:', msg)
      })
    }

    sendEmail({
      to:                 String(applicant.email),
      subject:            `Join Now - Your Interview is Ready | ${companyName}`,
      html:               buildTurnEmail({ name: String(applicant.name), companyName, meetLink, companyId }),
      companyId,
      kind:               'hiring',
      enforceVerified:    false,
      respectSuppression: false,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[hiring-batches] turn email failed:', msg)
    })

    if (applicant.phone) {
      await query(
        `UPDATE hiring_batch_candidates SET whatsapp_sent = true WHERE batch_id = $1 AND position = $2`,
        [batchId, nextPosition],
      )
    }
  }

  return c.json({ ok: true, complete: false, next_applicant: nextApplicant })
})

// ── PATCH /api/hiring/batches/:id/complete ────────────────────────────────────

app.patch('/api/hiring/batches/:id/complete', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds')
  const batchId    = c.req.param('id')

  const batchRes = await query(
    `SELECT b.company_id, b.status, co.name AS company_name
     FROM hiring_batches b
     LEFT JOIN companies co ON co.id = b.company_id
     WHERE b.id = $1`,
    [batchId],
  )
  if (!batchRes.rows.length) return c.json({ error: 'Batch not found' }, 404)

  const batch = batchRes.rows[0]
  if (!companyIds.includes(String(batch.company_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await query(
    `UPDATE hiring_batches SET status = 'complete', completed_at = NOW() WHERE id = $1`,
    [batchId],
  )

  // ── Generate offer letters for all accepted candidates ─────────────────────

  // Find all accepted batch candidates with their applicant details
  const acceptedRes = await query(
    `SELECT bc.applicant_id,
            a.name, a.email, a.college,
            r.title AS role_title,
            co.name AS company_name
     FROM hiring_batch_candidates bc
     JOIN hiring_applicants a ON a.id = bc.applicant_id
     LEFT JOIN hiring_roles r ON r.id = a.role_id
     LEFT JOIN companies co ON co.id = a.company_id
     WHERE bc.batch_id = $1 AND bc.decision = 'accept'`,
    [batchId],
  )

  const offers: Array<{ name: string; email: string; offer_url: string; applicant_id: string }> = []
  let templateMissing = false

  if (acceptedRes.rows.length > 0) {
    const tplRes = await query(
      `SELECT * FROM document_templates
       WHERE company_id = $1 AND doc_type = 'offer_letter'
       ORDER BY updated_at DESC LIMIT 1`,
      [batch.company_id],
    )

    if (!tplRes.rows.length) {
      templateMissing = true
    } else {
      const template = tplRes.rows[0]
      const tags: string[] = Array.isArray(template.tags) ? (template.tags as string[]) : []
      const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

      const acceptedRows = acceptedRes.rows as Array<{
        applicant_id: string
        name: string
        email: string
        college: string | null
        role_title: string | null
        company_name: string | null
      }>

      const recipients: Record<string, string>[] = acceptedRows.map((applicant) => {
        const src: Record<string, string> = {
          name:     String(applicant.name || ''),
          email:    String(applicant.email || ''),
          role:     String(applicant.role_title || 'Intern'),
          position: String(applicant.role_title || 'Intern'),
          date:     today,
          company:  String(applicant.company_name || batch.company_name || ''),
          college:  String(applicant.college || ''),
          duration: '3 months',
        }
        const recipientData: Record<string, string> = { email: src.email }
        for (const tag of tags) {
          recipientData[tag] = src[tag.toLowerCase()] ?? ''
        }
        return recipientData
      })

      const { rows: [docBatch] } = await query(
        `INSERT INTO document_batches
           (template_id, company_id, name, status, total_count, send_email, created_by)
         VALUES ($1,$2,$3,'pending',$4,false,NULL) RETURNING id`,
        [template.id, template.company_id, `Offers - Batch ${batchId}`, recipients.length],
      )

      const { runBatch } = await import('./documents')
      let generatedIds: string[] = []
      try {
        generatedIds = await runBatch(
          docBatch.id as string,
          template as Record<string, unknown>,
          recipients,
          false,
        )
      } catch (e) {
        console.error('[hiring-batches] runBatch failed:', e instanceof Error ? e.message : e)
      }

      for (let i = 0; i < acceptedRows.length; i++) {
        const applicant = acceptedRows[i]
        const genId = generatedIds[i]
        if (!genId) continue

        await query(
          `UPDATE hiring_applicants
           SET offer_letter_url = $1, stage = 'selected', updated_at = NOW()
           WHERE id = $2`,
          [`doc:${genId}`, applicant.applicant_id],
        )

        offers.push({
          name:         applicant.name,
          email:        applicant.email,
          offer_url:    `/api/documents/generated/${genId}/pdf`,
          applicant_id: applicant.applicant_id,
        })
      }
    }
  }

  return c.json({ ok: true, offers, template_missing: templateMissing })
})

// ── PATCH /api/hiring/batches/:id/cancel ─────────────────────────────────────
// Cancels a batch (or individual candidate within it) and sends cancellation emails.
// Body: { reason?: string, candidate_id?: string }
// If candidate_id provided: cancels only that candidate, reverts to shortlisted, sends email.
// If no candidate_id: cancels the whole batch, sends email to all non-done candidates.

app.patch('/api/hiring/batches/:id/cancel', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const batchId    = c.req.param('id')
  const body       = await c.req.json().catch(() => ({})) as { reason?: string; candidate_id?: string }

  const batchRes = await query(
    `SELECT b.*, r.title AS role_title, co.name AS company_name
     FROM hiring_batches b
     LEFT JOIN hiring_roles r ON r.id = b.role_id
     LEFT JOIN companies co ON co.id = b.company_id
     WHERE b.id = $1`,
    [batchId],
  )
  if (!batchRes.rows.length) return c.json({ error: 'Batch not found' }, 404)
  const batch = batchRes.rows[0]
  if (!companyIds.includes(String(batch.company_id))) return c.json({ error: 'Forbidden' }, 403)

  const reason  = body.reason?.trim() || 'Due to scheduling changes, this interview session has been cancelled.'
  const dt      = batch.scheduled_at ? new Date(String(batch.scheduled_at)) : null
  const dateStr = dt ? dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'the scheduled date'

  function buildCancelEmail(name: string): string {
    const cancelBrand = getCompanyBrand(batch.company_id)
    const body = `
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
        We regret to inform you that your interview for the <strong>${batch.role_title || 'internship'}</strong> role at
        <strong>${batch.company_name}</strong> scheduled for <strong>${dateStr}</strong> has been cancelled.
      </p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">${reason}</p>
      <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#374151;">
        We will be in touch with further details. We sincerely apologise for any inconvenience.
      </p>
      <div style="border-top:1px solid #E5E7EB;padding-top:20px;">
        <p style="margin:0;font-size:13px;color:#6B7280;">Best regards,</p>
        <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#0F1117;">${cancelBrand.signoff}</p>
      </div>`
    return emailWrap(
      String(batch.company_name), cancelBrand.accent, cancelBrand.tagline, body,
      `You are receiving this because you had a scheduled interview at ${batch.company_name}. Do not reply to this email.`,
    )
  }

  if (body.candidate_id) {
    // Cancel individual candidate only
    const candRes = await query(
      `SELECT bc.*, a.name, a.email
       FROM hiring_batch_candidates bc
       JOIN hiring_applicants a ON a.id = bc.applicant_id
       WHERE bc.id = $1 AND bc.batch_id = $2`,
      [body.candidate_id, batchId],
    )
    if (!candRes.rows.length) return c.json({ error: 'Candidate not found in batch' }, 404)
    const cand = candRes.rows[0]

    await query(`UPDATE hiring_batch_candidates SET status = 'skipped', decision = NULL WHERE id = $1`, [cand.id])
    await query(
      `UPDATE hiring_applicants SET stage = 'shortlisted', interview_at = NULL, interview_meet_link = NULL WHERE id = $1`,
      [cand.applicant_id],
    )

    try {
      const html = buildCancelEmail(String(cand.name))
      await sendEmail({
        to: String(cand.email),
        subject: `Interview Cancellation - ${batch.role_title} at ${batch.company_name}`,
        text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
        html,
      })
    } catch { /* non-fatal */ }

    return c.json({ ok: true, cancelled: 1 })
  }

  // Cancel whole batch
  await query(`UPDATE hiring_batches SET status = 'cancelled' WHERE id = $1`, [batchId])

  // Email all candidates who haven't been decided yet (waiting or current)
  const candsRes = await query(
    `SELECT bc.applicant_id, a.name, a.email
     FROM hiring_batch_candidates bc
     JOIN hiring_applicants a ON a.id = bc.applicant_id
     WHERE bc.batch_id = $1 AND bc.status IN ('waiting', 'current')`,
    [batchId],
  )

  let emailsSent = 0
  for (const cand of candsRes.rows) {
    try {
      const html = buildCancelEmail(String(cand.name))
      await sendEmail({
        to: String(cand.email),
        subject: `Interview Cancellation - ${batch.role_title} at ${batch.company_name}`,
        text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
        html,
      })
      await query(
        `UPDATE hiring_applicants SET stage = 'shortlisted', interview_at = NULL, interview_meet_link = NULL WHERE id = $1`,
        [cand.applicant_id],
      )
      emailsSent++
    } catch { /* continue to next */ }
  }

  return c.json({ ok: true, cancelled: candsRes.rows.length, emails_sent: emailsSent })
})

// ── DELETE /api/hiring/batches/:id ────────────────────────────────────────────

app.delete('/api/hiring/batches/:id', requireAuth, requireRole('ceo', 'coo', 'cto'), async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const batchId    = c.req.param('id')

  const batchRes = await query(`SELECT company_id FROM hiring_batches WHERE id = $1`, [batchId])
  if (!batchRes.rows.length) return c.json({ error: 'Batch not found' }, 404)
  if (!companyIds.includes(String(batchRes.rows[0].company_id))) return c.json({ error: 'Forbidden' }, 403)

  await query(`DELETE FROM hiring_batches WHERE id = $1`, [batchId])
  return c.json({ ok: true })
})

export default app
