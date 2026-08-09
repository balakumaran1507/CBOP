/**
 * Setup/fix founder accounts for Ouantum and Zapsters.
 * Run: node --env-file=.env scripts/setup-founder-accounts.mjs
 */
import { Pool } from 'pg'
import { hashPassword } from '@better-auth/utils/password'
import { randomBytes } from 'node:crypto'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const OUANTUM_ID  = 'feecf705-c787-45cf-b0d9-c02299e77ab5'
const ZAPSTERS_ID = '8c95f121-b53d-467a-971e-0e9b3793e7d6'

// New passwords to set
const OUANTUM_PW  = 'Ouantum@2026!'
const ZAPSTERS_PW = 'Zapsters@2026!'

function newId() {
  return randomBytes(16).toString('base64url').slice(0, 22)
}

async function run() {
  const client = await pool.connect()
  try {

    // ── 1. founders@ouantum.com — reset password ────────────────────────────
    console.log('\n── founders@ouantum.com ──')
    const { rows: ouantumUsers } = await client.query(
      `SELECT id FROM "user" WHERE email = 'founders@ouantum.com'`
    )
    if (ouantumUsers.length === 0) {
      console.log('  ✗ No user row — run seed first')
    } else {
      const userId = ouantumUsers[0].id
      const hashed = await hashPassword(OUANTUM_PW)
      const { rowCount } = await client.query(
        `UPDATE account SET password = $1, "updatedAt" = NOW()
         WHERE "userId" = $2 AND "providerId" = 'credential'`,
        [hashed, userId]
      )
      if (rowCount === 0) {
        // No account row — create one
        await client.query(
          `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
           VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
          [newId(), userId, hashed]
        )
        console.log('  ✓ Created credential account')
      } else {
        console.log('  ✓ Password reset')
      }
      // Ensure Ouantum company is assigned (keep any existing assignments too)
      await client.query(
        `INSERT INTO user_companies (user_id, company_id)
         SELECT u.id, $1 FROM users u WHERE u.email = 'founders@ouantum.com'
         ON CONFLICT DO NOTHING`,
        [OUANTUM_ID]
      )
      console.log(`  ✓ Ouantum company assignment confirmed`)
      console.log(`  → Email:    founders@ouantum.com`)
      console.log(`  → Password: ${OUANTUM_PW}`)
    }

    // ── 2. founders@zapsters.in — create from scratch ───────────────────────
    console.log('\n── founders@zapsters.in ──')

    // 2a. better-auth user table
    const { rows: existingAuthUser } = await client.query(
      `SELECT id FROM "user" WHERE email = 'founders@zapsters.in'`
    )
    let zapUserId
    if (existingAuthUser.length > 0) {
      zapUserId = existingAuthUser[0].id
      console.log('  ↳ better-auth user row already exists')
    } else {
      zapUserId = newId()
      await client.query(
        `INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, 'founders@zapsters.in', 'Zapsters Founder', true, NOW(), NOW())`,
        [zapUserId]
      )
      console.log('  ✓ Created better-auth user row')
    }

    // 2b. credential account
    const { rows: existingAccount } = await client.query(
      `SELECT id FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [zapUserId]
    )
    const zapHashed = await hashPassword(ZAPSTERS_PW)
    if (existingAccount.length > 0) {
      await client.query(
        `UPDATE account SET password = $1, "updatedAt" = NOW() WHERE "userId" = $2 AND "providerId" = 'credential'`,
        [zapHashed, zapUserId]
      )
      console.log('  ↳ Credential account existed — password updated')
    } else {
      await client.query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
        [newId(), zapUserId, zapHashed]
      )
      console.log('  ✓ Created credential account')
    }

    // 2c. CBOP users table (role-based lookup happens here)
    const { rows: existingCbopUser } = await client.query(
      `SELECT id FROM users WHERE email = 'founders@zapsters.in'`
    )
    let zapCbopUserId
    if (existingCbopUser.length > 0) {
      zapCbopUserId = existingCbopUser[0].id
      console.log('  ↳ CBOP users row already exists')
    } else {
      const { rows: inserted } = await client.query(
        `INSERT INTO users (email, name, role) VALUES ('founders@zapsters.in', 'Zapsters Founder', 'ceo') RETURNING id`
      )
      zapCbopUserId = inserted[0].id
      console.log('  ✓ Created CBOP users row (role: ceo)')
    }

    // 2d. Assign to Zapsters company
    await client.query(
      `INSERT INTO user_companies (user_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [zapCbopUserId, ZAPSTERS_ID]
    )
    console.log('  ✓ Assigned to Zapsters company')

    // 2e. Seed all company_modules as enabled for Zapsters
    await client.query(
      `INSERT INTO company_modules (company_id, module_key, is_enabled)
       SELECT $1, m.key, true
       FROM (VALUES
         ('finance'),('mentor'),('sales'),('hiring'),('campaigns'),('blog'),
         ('seo'),('social'),('documents'),('email_studio'),('subscribers'),
         ('templates'),('work'),('goals'),('rnd'),('audit'),('settings'),('legal')
       ) AS m(key)
       ON CONFLICT DO NOTHING`,
      [ZAPSTERS_ID]
    )
    console.log('  ✓ All 18 modules enabled for Zapsters')

    console.log(`  → Email:    founders@zapsters.in`)
    console.log(`  → Password: ${ZAPSTERS_PW}`)

    console.log('\n✓ All done.\n')

  } catch (err) {
    console.error('\n✗ Error:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
