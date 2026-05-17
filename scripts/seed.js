#!/usr/bin/env node
/**
 * Seed script — creates 4 companies + 3 users (Bala/CEO, Nabeelah/COO, Guru/CTO).
 * Uses better-auth API to create credentials, then inserts into our users table.
 * Run: DATABASE_URL=... BETTER_AUTH_SECRET=... NEXT_PUBLIC_APP_URL=http://localhost:3003 node scripts/seed.js
 *
 * Idempotent: skips rows that already exist.
 */

const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const COMPANIES = [
  { name: 'Etherence IT', type: 'it',       invoice_prefix: 'ETH' },
  { name: 'Etherence Pentest', type: 'security', invoice_prefix: 'PEN' },
  { name: 'CYBERCOM CTF',  type: 'ctf',     invoice_prefix: 'CYB' },
  { name: 'AttackOS',      type: 'gamedev',  invoice_prefix: 'ATK' },
]

const USERS = [
  { name: 'Balakumaran', email: 'founders@cybercomctf.com',       role: 'ceo', password: 'T6Y8F9juH6mYVn', allCompanies: true },
  { name: 'Nabeelah',    email: 'nabeelahanjum.wrk@gmail.com',    role: 'coo', password: 'hNuPgNmY7iUmtG', allCompanies: true },
  { name: 'Guru',        email: 'guru2006may@gmail.com',          role: 'cto', password: 'sv27FCpRUc4FbF', allCompanies: false },
]

async function seed() {
  console.log('Seeding CBOP database...\n')
  const client = await pool.connect()

  try {
    // 1. Insert companies
    const companyIds = {}
    for (const co of COMPANIES) {
      const existing = await client.query('SELECT id FROM companies WHERE invoice_prefix = $1', [co.invoice_prefix])
      if (existing.rows.length > 0) {
        companyIds[co.invoice_prefix] = existing.rows[0].id
        console.log(`  ↳ Company exists: ${co.name}`)
      } else {
        const res = await client.query(
          'INSERT INTO companies (name, type, invoice_prefix) VALUES ($1, $2, $3) RETURNING id',
          [co.name, co.type, co.invoice_prefix]
        )
        companyIds[co.invoice_prefix] = res.rows[0].id
        console.log(`  ✓ Created company: ${co.name}`)
      }
    }

    const allCompanyIds = Object.values(companyIds)
    const etherenceItId = companyIds['ETH']

    // 2. Create users via better-auth + CBOP users table
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003'

    for (const u of USERS) {
      // Check if user already exists in our users table
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [u.email])
      if (existing.rows.length > 0) {
        console.log(`  ↳ User exists: ${u.name} (${u.email})`)
        continue
      }

      // Create via better-auth sign-up endpoint
      const signupRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: u.password, name: u.name }),
      })

      if (!signupRes.ok) {
        const body = await signupRes.text()
        let parsed = {}
        try { parsed = JSON.parse(body) } catch {}
        if (parsed.message === 'User with this email already exists') {
          console.log(`  ↳ Auth account exists: ${u.name} — continuing to sync users table`)
        } else {
          console.error(`  ✗ Failed to create auth account for ${u.name}: ${body}`)
          continue
        }
      }

      // Insert into CBOP users table (linked by email in requireAuth)
      await client.query(
        'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
        [u.email, u.name, u.role]
      )

      const userRow = await client.query('SELECT id FROM users WHERE email = $1', [u.email])
      const userId = userRow.rows[0].id

      // Assign companies
      const companySet = u.allCompanies ? allCompanyIds : [etherenceItId]
      for (const cid of companySet) {
        await client.query(
          'INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, cid]
        )
      }

      console.log(`  ✓ Created user: ${u.name} (${u.role}) — ${companySet.length} company(ies)`)
    }

    console.log('\n✓ Seed complete.')
  } catch (err) {
    console.error('\n✗ Seed failed:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
