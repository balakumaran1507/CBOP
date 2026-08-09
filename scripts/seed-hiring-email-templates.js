// Seed hiring email templates into the templates table.
// Uses Etherence IT as the default company (these are global/shared templates).
// Run: node --env-file=.env scripts/seed-hiring-email-templates.js

const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Etherence IT is the primary company for global hiring templates
const COMPANY_ID = '11111111-1111-1111-1111-111111111111'

function makeDoc(paragraphs) {
  return {
    type: 'doc',
    content: paragraphs.map(p => {
      if (p.type === 'heading') {
        return { type: 'heading', attrs: { level: p.level }, content: p.content }
      }
      if (p.type === 'bulletList') {
        return {
          type: 'bulletList',
          content: p.items.map(item => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: toInline(item) }],
          })),
        }
      }
      return { type: 'paragraph', content: toInline(p.text ?? '') }
    }),
  }
}

function toInline(text) {
  // Convert text with {{variable}} markers to Tiptap inline nodes
  const parts = []
  const regex = /\{\{(\w+)\}\}/g
  let last = 0
  let m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) })
    parts.push({ type: 'variable', attrs: { variable: m[1] } })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

const TEMPLATES = [
  {
    slug: 'interview_confirmation',
    name: 'Interview Confirmation Email',
    type: 'email',
    output_type: 'email',
    doc: makeDoc([
      { text: 'Hi {{applicant_name}},' },
      { text: 'We reviewed your application for the {{role_title}} position and are pleased to invite you for an interview.' },
      { type: 'heading', level: 3, content: toInline('Interview Details') },
      { type: 'bulletList', items: [
        'Date: {{interview_date}}',
        'Time: {{interview_time}} IST',
        'Meeting Link: {{meet_link}}',
      ]},
      { text: 'Please confirm your attendance by replying to this email. If you need to reschedule, let us know at least 24 hours in advance.' },
      { text: 'Looking forward to speaking with you.' },
      { text: 'Warm regards,' },
      { text: '{{interviewer_name}}' },
      { text: '{{company_name}}' },
    ]),
  },
  {
    slug: 'rejection_email',
    name: 'Application Rejection Email',
    type: 'email',
    output_type: 'email',
    doc: makeDoc([
      { text: 'Hi {{applicant_name}},' },
      { text: 'Thank you for applying for the {{role_title}} position at {{company_name}}. We genuinely appreciate the time and effort you put into your application.' },
      { text: 'After reviewing your profile carefully, we regret to inform you that we will not be moving forward with your application at this time.' },
      { text: 'This decision does not reflect negatively on your potential — hiring decisions are often shaped by very specific needs at a given point in time. We encourage you to keep building your skills and to apply again as your experience grows.' },
      { text: 'We wish you the very best in your journey ahead.' },
      { text: 'Warm regards,' },
      { text: '{{company_name}} Team' },
    ]),
  },
  {
    slug: 'offer_letter_email',
    name: 'Offer Letter Email',
    type: 'email',
    output_type: 'email',
    doc: makeDoc([
      { text: 'Hi {{applicant_name}},' },
      { text: 'We are delighted to offer you an internship position as {{role_title}} at {{company_name}}.' },
      { text: 'Please find the offer letter attached to this email. Kindly review the terms and reply with one of the following:' },
      { type: 'bulletList', items: [
        '"I ACCEPT" — to confirm your joining',
        '"I DECLINE" — if you wish to withdraw',
      ]},
      { text: 'This offer expires within 48 hours of receipt. We look forward to having you on the team.' },
      { text: 'Welcome aboard,' },
      { text: '{{company_name}} Team' },
    ]),
  },
  {
    slug: 'welcome_email',
    name: 'Welcome / Joining Email',
    type: 'email',
    output_type: 'email',
    doc: makeDoc([
      { text: 'Hi {{applicant_name}},' },
      { text: 'Welcome to the team! We are excited to have you join us as {{role_title}} at {{company_name}}.' },
      { type: 'heading', level: 3, content: toInline('Your Onboarding Details') },
      { type: 'bulletList', items: [
        'Start Date: {{start_date}}',
        'Team Lead: {{team_lead_name}}',
        'Reporting to: {{team_lead_email}}',
      ]},
      { text: 'You will receive separate invites for our Slack workspace, Discord server, and internal documentation access.' },
      { text: 'If you have any questions before your start date, feel free to reach out. We are here to help you settle in.' },
      { text: 'See you soon,' },
      { text: '{{company_name}} Team' },
    ]),
  },
]

async function run() {
  for (const t of TEMPLATES) {
    const vars = extractVars(t.doc)
    const existing = await pool.query('SELECT id FROM templates WHERE slug = $1', [t.slug])
    if (existing.rows.length > 0) {
      console.log(`SKIP (already exists): ${t.slug}`)
      continue
    }
    await pool.query(
      `INSERT INTO templates (company_id, name, type, output_type, content_json, variables, slug, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [COMPANY_ID, t.name, t.type, t.output_type, JSON.stringify(t.doc), JSON.stringify(vars), t.slug]
    )
    console.log(`INSERTED: ${t.slug}`)
  }
  await pool.end()
  console.log('Done.')
}

function extractVars(node, found = new Set()) {
  if (node.type === 'variable' && node.attrs?.variable) found.add(node.attrs.variable)
  for (const c of node.content ?? []) extractVars(c, found)
  return [...found]
}

run().catch(e => { console.error(e); process.exit(1) })
