#!/usr/bin/env node
/**
 * Seed script — demo projects + tasks across all companies so the Work
 * Kanban / Timeline views have realistic data to render.
 * Run: node --env-file=.env scripts/seed-work-demo.js
 *
 * Idempotent: skips a project if one with the same name+company already
 * exists, skips a task if one with the same title+project already exists.
 */

const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const today = new Date()
function daysFromNow(n) {
  const d = new Date(today)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// company invoice_prefix -> demo project + tasks
const PLAN = [
  {
    prefix: 'ETH',
    project: { name: 'Client Onboarding – Meridian Retail', work_type: 'client', deadline: daysFromNow(21) },
    tasks: [
      { title: 'Client kickoff call',              status: 'done',        priority: 'high',     start: -10, due: -8 },
      { title: 'Set up VPN access',                status: 'done',        priority: 'medium',   start: -8,  due: -6 },
      { title: 'Migrate mail to Google Workspace',  status: 'in_progress', priority: 'high',     start: -5,  due: 2 },
      { title: 'Configure firewall rules',          status: 'in_progress', priority: 'critical', start: -2,  due: -1 },
      { title: 'Deploy monitoring agents',          status: 'todo',        priority: 'medium',   start: 3,   due: 9 },
      { title: 'Final infra handover doc',          status: 'todo',        priority: 'low',      start: 10,  due: 18 },
    ],
  },
  {
    prefix: 'PEN',
    project: { name: 'Q3 Network Pentest – Cyberdyne Systems', work_type: 'client', deadline: daysFromNow(16) },
    tasks: [
      { title: 'Recon & OSINT gathering',           status: 'done',        priority: 'medium',   start: -12, due: -9 },
      { title: 'External network scan',              status: 'done',        priority: 'high',     start: -9,  due: -6 },
      { title: 'Web app vulnerability assessment',   status: 'review',      priority: 'critical', start: -6,  due: -1 },
      { title: 'Draft findings report',               status: 'in_progress', priority: 'high',     start: -1,  due: 6 },
      { title: 'Client debrief call',                 status: 'todo',        priority: 'medium',   start: 12,  due: 14 },
    ],
  },
  {
    prefix: 'CYB',
    project: { name: 'CTF Season 4 – Prep & Launch', work_type: 'client', deadline: daysFromNow(30) },
    tasks: [
      { title: 'Design crypto challenge set',        status: 'done',        priority: 'medium',   start: -14, due: -7 },
      { title: 'Build scoring infrastructure',        status: 'in_progress', priority: 'critical', start: -7,  due: 3 },
      { title: 'Recruit challenge authors',            status: 'in_progress', priority: 'medium',   start: -4,  due: 5 },
      { title: 'Beta test challenges',                  status: 'todo',        priority: 'high',     start: 8,   due: 15 },
      { title: 'Launch marketing campaign',             status: 'todo',        priority: 'low',      start: 16,  due: 28 },
    ],
  },
  {
    prefix: 'ATK',
    project: { name: 'AttackOS v2.0 Release', work_type: 'client', deadline: daysFromNow(25) },
    tasks: [
      { title: 'Implement multiplayer lobby',          status: 'done',        priority: 'high',     start: -16, due: -9 },
      { title: 'Fix save-file corruption bug',           status: 'done',        priority: 'critical', start: -9,  due: -7 },
      { title: 'Balance weapon damage',                    status: 'review',      priority: 'medium',   start: -7,  due: -2 },
      { title: 'Polish UI animations',                      status: 'in_progress', priority: 'low',      start: -2,  due: 7 },
      { title: 'Submit to Steam review',                      status: 'todo',        priority: 'high',     start: 18,  due: 22 },
    ],
  },
  {
    prefix: 'QNT',
    project: { name: 'Ouantum Platform Migration', work_type: 'client', deadline: daysFromNow(20) },
    tasks: [
      { title: 'Audit legacy infra',                     status: 'done',        priority: 'medium',   start: -11, due: -8 },
      { title: 'Provision new cloud environment',           status: 'in_progress', priority: 'high',     start: -8,  due: 1 },
      { title: 'Migrate database',                            status: 'todo',        priority: 'critical', start: 2,   due: 9 },
      { title: 'Cutover DNS',                                   status: 'todo',        priority: 'high',     start: 10,  due: 11 },
      { title: 'Post-migration QA',                              status: 'todo',        priority: 'medium',   start: 12,  due: 16 },
    ],
  },
  {
    prefix: 'ZAP',
    project: { name: 'Zapsters Mobile App v1', work_type: 'client', deadline: daysFromNow(28) },
    tasks: [
      { title: 'Design onboarding flow',                  status: 'done',        priority: 'medium',   start: -13, due: -10 },
      { title: 'Build push notifications',                  status: 'in_progress', priority: 'medium',   start: -6,  due: 4 },
      { title: 'Fix crash on Android 12',                      status: 'in_progress', priority: 'critical', start: -3,  due: -1 },
      { title: 'App Store submission',                          status: 'todo',        priority: 'high',     start: 14,  due: 19 },
      { title: 'Beta user feedback review',                      status: 'todo',        priority: 'low',      start: 20,  due: 26 },
    ],
  },
]

async function seed() {
  console.log('Seeding Work demo data...\n')
  const client = await pool.connect()

  try {
    const companies = await client.query('SELECT id, invoice_prefix FROM companies')
    const companyIdByPrefix = Object.fromEntries(companies.rows.map(r => [r.invoice_prefix, r.id]))

    const users = await client.query('SELECT id, role FROM users ORDER BY role')
    const ownerIds = users.rows.map(r => r.id)
    if (ownerIds.length === 0) throw new Error('No users found — run scripts/seed.js first')

    let ownerCursor = 0
    const nextOwner = () => ownerIds[ownerCursor++ % ownerIds.length]

    for (const entry of PLAN) {
      const companyId = companyIdByPrefix[entry.prefix]
      if (!companyId) {
        console.log(`  ✗ Skipping ${entry.project.name} — no company with prefix ${entry.prefix}`)
        continue
      }

      let projectId
      const existingProject = await client.query(
        'SELECT id FROM ops_projects WHERE name = $1 AND company_id = $2',
        [entry.project.name, companyId]
      )
      if (existingProject.rows.length > 0) {
        projectId = existingProject.rows[0].id
        console.log(`  ↳ Project exists: ${entry.project.name}`)
      } else {
        const res = await client.query(
          `INSERT INTO ops_projects (company_id, name, owner_id, status, deadline, work_type)
           VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
          [companyId, entry.project.name, nextOwner(), entry.project.deadline, entry.project.work_type]
        )
        projectId = res.rows[0].id
        console.log(`  ✓ Created project: ${entry.project.name}`)
      }

      let prevTaskId = null
      for (const [i, t] of entry.tasks.entries()) {
        const existingTask = await client.query(
          'SELECT id FROM ops_tasks WHERE title = $1 AND project_id = $2',
          [t.title, projectId]
        )
        if (existingTask.rows.length > 0) {
          prevTaskId = existingTask.rows[0].id
          console.log(`    ↳ Task exists: ${t.title}`)
          continue
        }
        // Chain every 3rd task onto the previous one as a dependency, for the
        // timeline view's "blocked by" indicator.
        const dependsOn = i > 0 && i % 3 === 0 ? prevTaskId : null
        const res = await client.query(
          `INSERT INTO ops_tasks
             (company_id, project_id, title, owner_id, priority, status, start_date, due_date, depends_on_task_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [companyId, projectId, t.title, nextOwner(), t.priority, t.status, daysFromNow(t.start), daysFromNow(t.due), dependsOn]
        )
        prevTaskId = res.rows[0].id
        console.log(`    ✓ Created task: ${t.title} [${t.status}]`)
      }
    }

    console.log('\nDone.')
  } finally {
    client.release()
    await pool.end()
  }
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
