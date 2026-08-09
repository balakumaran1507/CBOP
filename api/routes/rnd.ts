import { Hono } from 'hono'
import { requireAuth } from '../middleware/require-auth'
import { query } from '../lib/db'
import { notFound, validationError } from '../lib/route-utils'
import '../lib/hono-vars'

const app = new Hono()

const VALID_STATUSES  = ['exploring', 'active', 'paused', 'concluded']
const VALID_DOMAINS   = ['security', 'ctf', 'design', 'ai', 'infra', 'devops', 'marketing', 'tooling', 'other']
const VALID_TYPES     = ['note', 'experiment', 'finding', 'prototype', 'milestone', 'blocker']
const VALID_PHASES    = ['ideation', 'exploration', 'development', 'analysis', 'documentation', 'publication']
const VALID_RES_TYPES = ['budget', 'api', 'hardware', 'software', 'human', 'other']
const VALID_REF_TYPES = ['paper', 'code', 'dataset', 'tool', 'competitor', 'related_work', 'inspiration', 'standard']
const VALID_PUB_TYPES = ['ieee_paper', 'conference', 'blog_post', 'linkedin', 'internal_report', 'patent', 'whitepaper', 'demo']
const VALID_RES_STATUSES = ['needed', 'requested', 'approved', 'available', 'rejected']
const VALID_MS_STATUSES  = ['pending', 'in_progress', 'done', 'blocked']
const VALID_PUB_STATUSES = ['not_started', 'drafting', 'review', 'submitted', 'published', 'rejected']

const DEFAULT_CHECKLISTS: Record<string, { text: string }[]> = {
  ieee_paper: [
    { text: 'Problem statement and research gap clearly defined' },
    { text: 'Related work / literature review section drafted' },
    { text: 'Research methodology documented' },
    { text: 'Experiments designed and executed' },
    { text: 'Results recorded and analyzed' },
    { text: 'Figures and tables created with captions' },
    { text: 'Abstract written (150–250 words)' },
    { text: 'Introduction written' },
    { text: 'Conclusion and future work written' },
    { text: 'References formatted in IEEE citation style' },
    { text: 'Paper formatted to IEEE template (two-column)' },
    { text: 'Co-author review completed' },
    { text: 'Spell-check and grammar pass done' },
    { text: 'Plagiarism check run (< 20% similarity)' },
    { text: 'Submission portal account created' },
    { text: 'Paper submitted' },
  ],
  conference: [
    { text: 'Target conference identified and CFP read' },
    { text: 'Submission deadline confirmed' },
    { text: 'Abstract submitted (if required)' },
    { text: 'Paper written and formatted to conference template' },
    { text: 'Figures and tables polished' },
    { text: 'Peer review within team completed' },
    { text: 'Plagiarism check done' },
    { text: 'Paper submitted to conference portal' },
    { text: 'Presentation slides prepared (if accepted)' },
    { text: 'Camera-ready version submitted (if accepted)' },
  ],
  blog_post: [
    { text: 'Target audience and key insight identified' },
    { text: 'Title and SEO keyword chosen' },
    { text: 'Outline drafted' },
    { text: 'Draft written (600–1500 words)' },
    { text: 'Technical accuracy reviewed' },
    { text: 'Images / diagrams added' },
    { text: 'SEO meta description written (< 160 chars)' },
    { text: 'Internal links added' },
    { text: 'Reviewed by one other team member' },
    { text: 'Published and URL verified' },
    { text: 'Shared on social channels' },
  ],
  linkedin: [
    { text: 'Key insight or finding identified' },
    { text: 'Hook (first line) written — must grab attention' },
    { text: 'Content body written (300–500 words)' },
    { text: 'Call to action included' },
    { text: 'Relevant hashtags added (5–10)' },
    { text: 'Visual or image prepared' },
    { text: 'Relevant connections tagged' },
    { text: 'Post published' },
    { text: 'Engagement monitored for 48h' },
  ],
  internal_report: [
    { text: 'Executive summary written (1 page max)' },
    { text: 'Problem and hypothesis documented' },
    { text: 'Methodology described' },
    { text: 'Findings documented with evidence' },
    { text: 'Limitations and risks noted' },
    { text: 'Recommendations written' },
    { text: 'Budget and resource impact noted' },
    { text: 'Next steps defined with owners' },
    { text: 'Report reviewed by initiative owner' },
    { text: 'Distributed to stakeholders' },
  ],
  patent: [
    { text: 'Novelty and prior art search completed' },
    { text: 'Invention disclosure form filled' },
    { text: 'Claims drafted (independent + dependent)' },
    { text: 'Drawings / diagrams prepared' },
    { text: 'Patent attorney consulted' },
    { text: 'Provisional patent application filed' },
    { text: 'Full patent application prepared' },
    { text: 'Application submitted to patent office' },
  ],
  whitepaper: [
    { text: 'Target audience and problem defined' },
    { text: 'Executive summary written' },
    { text: 'Technical content drafted' },
    { text: 'Case studies or data included' },
    { text: 'Visuals and diagrams added' },
    { text: 'Reviewed by subject matter expert' },
    { text: 'Formatted to company brand template' },
    { text: 'Published / distributed' },
  ],
  demo: [
    { text: 'Demo scope and success criteria defined' },
    { text: 'Demo environment set up' },
    { text: 'Core functionality implemented' },
    { text: 'Script / walkthrough written' },
    { text: 'Recorded or live demo tested end-to-end' },
    { text: 'Feedback collected and documented' },
  ],
}

// ── GET /api/rnd/initiatives ──────────────────────────────────────────────────

app.get('/api/rnd/initiatives', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const status = c.req.query('status')
  const domain = c.req.query('domain')

  let pi = 2
  const result = await query(
    `SELECT
       i.id, i.title, i.description, i.domain, i.status, i.company_id,
       i.outcome, i.tags, i.created_at, i.updated_at,
       i.phase, i.hypothesis, i.problem_statement, i.budget_estimate,
       co.name AS company_name,
       u.name  AS created_by_name,
       COUNT(l.id)::int AS log_count,
       (SELECT COUNT(*)::int FROM rnd_milestones m WHERE m.initiative_id = i.id) AS milestones_total,
       (SELECT COUNT(*)::int FROM rnd_milestones m WHERE m.initiative_id = i.id AND m.status = 'done') AS milestones_done,
       (SELECT COUNT(*)::int FROM rnd_resources r WHERE r.initiative_id = i.id AND r.status NOT IN ('available','rejected')) AS resources_pending
     FROM rnd_initiatives i
     LEFT JOIN companies co ON co.id = i.company_id
     LEFT JOIN users u      ON u.id  = i.created_by_id
     LEFT JOIN rnd_log_entries l ON l.initiative_id = i.id
     WHERE (i.company_id = ANY($1::uuid[]) OR i.company_id IS NULL)
       ${status ? `AND i.status = $${pi++}` : ''}
       ${domain ? `AND i.domain = $${pi++}` : ''}
     GROUP BY i.id, co.name, u.name
     ORDER BY i.updated_at DESC`,
    [
      companyIds,
      ...(status ? [status] : []),
      ...(domain ? [domain] : []),
    ]
  )

  return c.json({ initiatives: result.rows })
})

// ── POST /api/rnd/initiatives ─────────────────────────────────────────────────

app.post('/api/rnd/initiatives', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json()
  const { title, description, domain, company_id, tags } = body

  if (!title?.trim()) return validationError(c, 'title is required')
  if (domain && !VALID_DOMAINS.includes(domain)) return validationError(c, 'Invalid domain')

  const result = await query(
    `INSERT INTO rnd_initiatives
       (title, description, domain, company_id, tags, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      title.trim(),
      description?.trim() || null,
      domain || 'other',
      company_id || null,
      tags || [],
      userId,
    ]
  )

  return c.json({ initiative: result.rows[0] }, 201)
})

// ── PATCH /api/rnd/initiatives/:id ───────────────────────────────────────────

app.patch('/api/rnd/initiatives/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { title, description, domain, status, company_id, outcome, tags, phase, hypothesis, problem_statement, budget_estimate } = body

  if (status && !VALID_STATUSES.includes(status)) return validationError(c, 'Invalid status')
  if (domain && !VALID_DOMAINS.includes(domain))  return validationError(c, 'Invalid domain')
  if (phase  && !VALID_PHASES.includes(phase))    return validationError(c, 'Invalid phase')

  const result = await query(
    `UPDATE rnd_initiatives
     SET title            = COALESCE($1, title),
         description      = COALESCE($2, description),
         domain           = COALESCE($3, domain),
         status           = COALESCE($4, status),
         company_id       = COALESCE($5, company_id),
         outcome          = COALESCE($6, outcome),
         tags             = COALESCE($7, tags),
         phase            = COALESCE($8, phase),
         hypothesis       = COALESCE($9, hypothesis),
         problem_statement = COALESCE($10, problem_statement),
         budget_estimate  = COALESCE($11, budget_estimate)
     WHERE id = $12
       AND (company_id = ANY($13::uuid[]) OR company_id IS NULL)
     RETURNING *`,
    [
      title?.trim() || null,
      description !== undefined ? (description?.trim() || null) : null,
      domain || null,
      status || null,
      company_id !== undefined ? (company_id || null) : null,
      outcome !== undefined ? (outcome?.trim() || null) : null,
      tags || null,
      phase || null,
      hypothesis !== undefined ? (hypothesis?.trim() || null) : null,
      problem_statement !== undefined ? (problem_statement?.trim() || null) : null,
      budget_estimate !== undefined ? budget_estimate : null,
      id,
      companyIds,
    ]
  )

  if (result.rows.length === 0) return notFound(c, 'Initiative')
  return c.json({ initiative: result.rows[0] })
})

// ── DELETE /api/rnd/initiatives/:id ──────────────────────────────────────────

app.delete('/api/rnd/initiatives/:id', requireAuth, async (c) => {
  const companyIds = c.get('companyIds') as string[]
  const id = c.req.param('id')
  const result = await query(
    `DELETE FROM rnd_initiatives WHERE id = $1 AND (company_id = ANY($2::uuid[]) OR company_id IS NULL) RETURNING id`,
    [id, companyIds]
  )
  if (result.rows.length === 0) return notFound(c, 'Initiative')
  return c.json({ ok: true })
})

// ── GET /api/rnd/initiatives/:id/log ─────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/log', requireAuth, async (c) => {
  const id = c.req.param('id')
  const result = await query(
    `SELECT l.id, l.body, l.entry_type, l.created_at,
            u.name AS created_by_name
     FROM rnd_log_entries l
     LEFT JOIN users u ON u.id = l.created_by_id
     WHERE l.initiative_id = $1
     ORDER BY l.created_at DESC`,
    [id]
  )
  return c.json({ entries: result.rows })
})

// ── POST /api/rnd/initiatives/:id/log ────────────────────────────────────────

app.post('/api/rnd/initiatives/:id/log', requireAuth, async (c) => {
  const id     = c.req.param('id')
  const userId = c.get('userId') as string
  const body   = await c.req.json()
  const { entry_body, entry_type } = body

  if (!entry_body?.trim()) return validationError(c, 'entry_body is required')
  if (entry_type && !VALID_TYPES.includes(entry_type)) return validationError(c, 'Invalid entry_type')

  const result = await query(
    `INSERT INTO rnd_log_entries (initiative_id, body, entry_type, created_by_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, entry_type, created_at`,
    [id, entry_body.trim(), entry_type || 'note', userId]
  )
  await query(`UPDATE rnd_initiatives SET updated_at = NOW() WHERE id = $1`, [id])
  return c.json({ entry: result.rows[0] }, 201)
})

// ── DELETE /api/rnd/log/:id ───────────────────────────────────────────────────

app.delete('/api/rnd/log/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  await query(`DELETE FROM rnd_log_entries WHERE id = $1`, [id])
  return c.json({ ok: true })
})

// ── Milestones ────────────────────────────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/milestones', requireAuth, async (c) => {
  const id = c.req.param('id')
  const result = await query(
    `SELECT * FROM rnd_milestones WHERE initiative_id = $1 ORDER BY phase, sort_order, created_at`,
    [id]
  )
  return c.json({ milestones: result.rows })
})

app.post('/api/rnd/initiatives/:id/milestones', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { phase, title, due_date, status } = body

  if (!phase || !VALID_PHASES.includes(phase)) return validationError(c, 'Invalid phase')
  if (!title?.trim()) return validationError(c, 'title is required')
  if (status && !VALID_MS_STATUSES.includes(status)) return validationError(c, 'Invalid status')

  const result = await query(
    `INSERT INTO rnd_milestones (initiative_id, phase, title, due_date, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, phase, title.trim(), due_date || null, status || 'pending']
  )
  return c.json({ milestone: result.rows[0] }, 201)
})

app.patch('/api/rnd/milestones/:id', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { title, status, due_date, phase } = body

  if (status && !VALID_MS_STATUSES.includes(status)) return validationError(c, 'Invalid status')
  if (phase  && !VALID_PHASES.includes(phase))        return validationError(c, 'Invalid phase')

  const result = await query(
    `UPDATE rnd_milestones
     SET title    = COALESCE($1, title),
         status   = COALESCE($2, status),
         due_date = COALESCE($3, due_date),
         phase    = COALESCE($4, phase)
     WHERE id = $5
     RETURNING *`,
    [title?.trim() || null, status || null, due_date || null, phase || null, id]
  )
  if (result.rows.length === 0) return notFound(c, 'Milestone')
  return c.json({ success: true, milestone: result.rows[0] })
})

app.delete('/api/rnd/milestones/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  await query(`DELETE FROM rnd_milestones WHERE id = $1`, [id])
  return new Response(null, { status: 204 })
})

// ── Resources ─────────────────────────────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/resources', requireAuth, async (c) => {
  const id = c.req.param('id')
  const result = await query(
    `SELECT * FROM rnd_resources WHERE initiative_id = $1 ORDER BY resource_type, created_at`,
    [id]
  )
  return c.json({ resources: result.rows })
})

app.post('/api/rnd/initiatives/:id/resources', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { resource_type, name, status, estimated_cost, notes } = body

  if (!resource_type || !VALID_RES_TYPES.includes(resource_type)) return validationError(c, 'Invalid resource_type')
  if (!name?.trim()) return validationError(c, 'name is required')
  if (status && !VALID_RES_STATUSES.includes(status)) return validationError(c, 'Invalid status')

  const result = await query(
    `INSERT INTO rnd_resources (initiative_id, resource_type, name, status, estimated_cost, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, resource_type, name.trim(), status || 'needed', estimated_cost ?? null, notes?.trim() || null]
  )
  return c.json({ resource: result.rows[0] }, 201)
})

app.patch('/api/rnd/resources/:id', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { name, status, estimated_cost, notes, resource_type } = body

  if (status        && !VALID_RES_STATUSES.includes(status))       return validationError(c, 'Invalid status')
  if (resource_type && !VALID_RES_TYPES.includes(resource_type))   return validationError(c, 'Invalid resource_type')

  const result = await query(
    `UPDATE rnd_resources
     SET name           = COALESCE($1, name),
         status         = COALESCE($2, status),
         estimated_cost = COALESCE($3, estimated_cost),
         notes          = COALESCE($4, notes),
         resource_type  = COALESCE($5, resource_type)
     WHERE id = $6
     RETURNING *`,
    [name?.trim() || null, status || null, estimated_cost ?? null, notes?.trim() || null, resource_type || null, id]
  )
  if (result.rows.length === 0) return notFound(c, 'Resource')
  return c.json({ success: true, resource: result.rows[0] })
})

app.delete('/api/rnd/resources/:id', requireAuth, async (c) => {
  await query(`DELETE FROM rnd_resources WHERE id = $1`, [c.req.param('id')])
  return new Response(null, { status: 204 })
})

// ── References ────────────────────────────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/references', requireAuth, async (c) => {
  const id = c.req.param('id')
  const result = await query(
    `SELECT * FROM rnd_references WHERE initiative_id = $1 ORDER BY is_pinned DESC, ref_type, created_at DESC`,
    [id]
  )
  return c.json({ references: result.rows })
})

app.post('/api/rnd/initiatives/:id/references', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { ref_type, title, url, notes, is_pinned } = body

  if (!ref_type || !VALID_REF_TYPES.includes(ref_type)) return validationError(c, 'Invalid ref_type')
  if (!title?.trim()) return validationError(c, 'title is required')

  const result = await query(
    `INSERT INTO rnd_references (initiative_id, ref_type, title, url, notes, is_pinned)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, ref_type, title.trim(), url?.trim() || null, notes?.trim() || null, is_pinned ?? false]
  )
  return c.json({ reference: result.rows[0] }, 201)
})

app.patch('/api/rnd/references/:id', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { title, url, notes, is_pinned, ref_type } = body

  if (ref_type && !VALID_REF_TYPES.includes(ref_type)) return validationError(c, 'Invalid ref_type')

  const result = await query(
    `UPDATE rnd_references
     SET title     = COALESCE($1, title),
         url       = COALESCE($2, url),
         notes     = COALESCE($3, notes),
         is_pinned = COALESCE($4, is_pinned),
         ref_type  = COALESCE($5, ref_type)
     WHERE id = $6
     RETURNING *`,
    [title?.trim() || null, url?.trim() || null, notes?.trim() || null, is_pinned ?? null, ref_type || null, id]
  )
  if (result.rows.length === 0) return notFound(c, 'Reference')
  return c.json({ success: true, reference: result.rows[0] })
})

app.delete('/api/rnd/references/:id', requireAuth, async (c) => {
  await query(`DELETE FROM rnd_references WHERE id = $1`, [c.req.param('id')])
  return new Response(null, { status: 204 })
})

// ── Publications ──────────────────────────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/publications', requireAuth, async (c) => {
  const id = c.req.param('id')
  const result = await query(
    `SELECT * FROM rnd_publications WHERE initiative_id = $1 ORDER BY created_at`,
    [id]
  )
  return c.json({ publications: result.rows })
})

app.post('/api/rnd/initiatives/:id/publications', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { pub_type, target_venue, target_date, notes } = body

  if (!pub_type || !VALID_PUB_TYPES.includes(pub_type)) return validationError(c, 'Invalid pub_type')

  const items = (DEFAULT_CHECKLISTS[pub_type] || []).map((item, i) => ({
    id: `item_${i}`, text: item.text, done: false,
  }))

  const result = await query(
    `INSERT INTO rnd_publications (initiative_id, pub_type, target_venue, target_date, notes, checklist)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, pub_type, target_venue?.trim() || null, target_date || null, notes?.trim() || null, JSON.stringify(items)]
  )
  return c.json({ publication: result.rows[0] }, 201)
})

app.patch('/api/rnd/publications/:id', requireAuth, async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const { status, target_venue, target_date, notes, checklist } = body

  if (status && !VALID_PUB_STATUSES.includes(status)) return validationError(c, 'Invalid status')

  const result = await query(
    `UPDATE rnd_publications
     SET status       = COALESCE($1, status),
         target_venue = COALESCE($2, target_venue),
         target_date  = COALESCE($3, target_date),
         notes        = COALESCE($4, notes),
         checklist    = CASE WHEN $5::boolean THEN $6::jsonb ELSE checklist END
     WHERE id = $7
     RETURNING *`,
    [
      status || null,
      target_venue?.trim() || null,
      target_date || null,
      notes?.trim() || null,
      checklist !== undefined,
      checklist !== undefined ? JSON.stringify(checklist) : '[]',
      id,
    ]
  )
  if (result.rows.length === 0) return notFound(c, 'Publication')
  return c.json({ success: true, publication: result.rows[0] })
})

app.delete('/api/rnd/publications/:id', requireAuth, async (c) => {
  await query(`DELETE FROM rnd_publications WHERE id = $1`, [c.req.param('id')])
  return new Response(null, { status: 204 })
})

// ── Report ────────────────────────────────────────────────────────────────────

app.get('/api/rnd/initiatives/:id/report', requireAuth, async (c) => {
  const id = c.req.param('id')

  const [initRes, msRes, resRes, refRes, pubRes, logRes] = await Promise.all([
    query(`SELECT i.*, u.name AS created_by_name FROM rnd_initiatives i LEFT JOIN users u ON u.id = i.created_by_id WHERE i.id = $1`, [id]),
    query(`SELECT * FROM rnd_milestones WHERE initiative_id = $1 ORDER BY phase, sort_order, created_at`, [id]),
    query(`SELECT * FROM rnd_resources WHERE initiative_id = $1 ORDER BY resource_type`, [id]),
    query(`SELECT * FROM rnd_references WHERE initiative_id = $1 ORDER BY is_pinned DESC, ref_type`, [id]),
    query(`SELECT * FROM rnd_publications WHERE initiative_id = $1 ORDER BY created_at`, [id]),
    query(`SELECT l.*, u.name AS created_by_name FROM rnd_log_entries l LEFT JOIN users u ON u.id = l.created_by_id WHERE l.initiative_id = $1 ORDER BY l.created_at DESC LIMIT 20`, [id]),
  ])

  if (initRes.rows.length === 0) return notFound(c, 'Initiative')

  const ini  = initRes.rows[0]
  const mss  = msRes.rows
  const ress = resRes.rows
  const refs = refRes.rows
  const pubs = pubRes.rows
  const logs = logRes.rows

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  const phaseMs = VALID_PHASES.reduce((acc, ph) => {
    acc[ph] = mss.filter(m => m.phase === ph)
    return acc
  }, {} as Record<string, typeof mss>)

  const totalCost = ress.reduce((s, r) => s + (r.estimated_cost ? Number(r.estimated_cost) : 0), 0)

  const milePhaseTable = VALID_PHASES
    .filter(ph => phaseMs[ph].length > 0)
    .map(ph => {
      const done = phaseMs[ph].filter(m => m.status === 'done').length
      return `| ${ph.charAt(0).toUpperCase() + ph.slice(1)} | ${done} | ${phaseMs[ph].length} |`
    }).join('\n')

  const mileDetail = VALID_PHASES
    .filter(ph => phaseMs[ph].length > 0)
    .map(ph => {
      const items = phaseMs[ph].map(m => `- [${m.status === 'done' ? 'x' : ' '}] ${m.title}${m.due_date ? ` _(due ${m.due_date})_` : ''}`).join('\n')
      return `### ${ph.charAt(0).toUpperCase() + ph.slice(1)}\n${items}`
    }).join('\n\n')

  const resTable = ress.length === 0 ? '_No resources defined._' :
    '| Type | Name | Status | Est. Cost |\n|---|---|---|---|\n' +
    ress.map(r => `| ${r.resource_type} | ${r.name} | ${r.status} | ${r.estimated_cost ? `₹${Number(r.estimated_cost).toLocaleString('en-IN')}` : '-'} |`).join('\n')

  const pinned     = refs.filter(r => r.is_pinned)
  const competitors = refs.filter(r => r.ref_type === 'competitor')
  const papers      = refs.filter(r => ['paper', 'standard'].includes(r.ref_type))
  const others      = refs.filter(r => !r.is_pinned && r.ref_type !== 'competitor' && !['paper','standard'].includes(r.ref_type))

  const formatRef = (r: { title: string; url?: string; notes?: string }) =>
    `- ${r.url ? `[${r.title}](${r.url})` : r.title}${r.notes ? ` — ${r.notes}` : ''}`

  const refSection = [
    pinned.length     ? `### Pinned\n${pinned.map(formatRef).join('\n')}` : '',
    competitors.length ? `### Competitors\n${competitors.map(formatRef).join('\n')}` : '',
    papers.length      ? `### Papers & Standards\n${papers.map(formatRef).join('\n')}` : '',
    others.length      ? `### Other References\n${others.map(formatRef).join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || '_No references added yet._'

  const pubTable = pubs.length === 0 ? '_No publication targets defined._' :
    '| Output | Venue | Status | Progress |\n|---|---|---|---|\n' +
    pubs.map(p => {
      const cl = Array.isArray(p.checklist) ? p.checklist : []
      const done = cl.filter((x: { done: boolean }) => x.done).length
      return `| ${p.pub_type.replace(/_/g, ' ')} | ${p.target_venue || '-'} | ${p.status.replace(/_/g, ' ')} | ${done}/${cl.length} items done |`
    }).join('\n')

  const logSection = logs.slice(0, 10).map(l => {
    const d = new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    return `**${d}** [${l.entry_type}] — ${l.body}`
  }).join('\n\n') || '_No log entries yet._'

  const report = `# R&D Report: ${ini.title}

**Date:** ${today}
**Phase:** ${ini.phase} | **Status:** ${ini.status} | **Domain:** ${ini.domain}
**Owner:** ${ini.created_by_name || 'Unknown'}${ini.budget_estimate ? `\n**Budget Estimate:** ₹${Number(ini.budget_estimate).toLocaleString('en-IN')}` : ''}

---

## Problem Statement
${ini.problem_statement || '_Not defined yet._'}

## Hypothesis
${ini.hypothesis || '_Not defined yet._'}

---

## Phase Progress

| Phase | Milestones Done | Total |
|---|---|---|
${milePhaseTable || '| — | — | — |'}

---

## Milestones

${mileDetail || '_No milestones defined yet._'}

---

## Resources

${resTable}

**Total estimated cost:** ${totalCost > 0 ? `₹${totalCost.toLocaleString('en-IN')}` : 'Not specified'}

---

## References & Competitor Landscape

${refSection}

---

## Publication Pipeline

${pubTable}

---

## Recent Log (last 10 entries)

${logSection}

---

## Outcome
${ini.outcome || '_Not yet concluded._'}

---
*Generated by CBOP R&D on ${today}*`

  return c.json({ report })
})

export default app
