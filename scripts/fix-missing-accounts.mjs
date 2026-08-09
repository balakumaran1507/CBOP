/**
 * One-off fix: create missing better-auth credential accounts for users
 * that have a `user` row but no matching `account` row.
 * Run: node --env-file=.env scripts/fix-missing-accounts.mjs
 */
import { Pool } from 'pg'
import { hashPassword } from '@better-auth/utils/password'
import { randomBytes } from 'node:crypto'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Users that need credential accounts created.
// Passwords from the seed file — these are the real credentials.
const USERS_TO_FIX = [
  { email: 'founders@cybercomctf.com', password: 'T6Y8F9juH6mYVn' },
  // Add others here if needed
]

async function run() {
  const client = await pool.connect()
  try {
    for (const u of USERS_TO_FIX) {
      // 1. Find the user in better-auth's user table
      const { rows: users } = await client.query(
        `SELECT id, email FROM "user" WHERE email = $1`,
        [u.email]
      )
      if (users.length === 0) {
        console.log(`  ✗ No user row found for ${u.email} — skipping`)
        continue
      }
      const userId = users[0].id
      console.log(`  Found user: ${u.email} (id: ${userId})`)

      // 2. Check if account already exists
      const { rows: existing } = await client.query(
        `SELECT id FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
        [userId]
      )
      if (existing.length > 0) {
        console.log(`  ↳ Account already exists for ${u.email} — skipping`)
        continue
      }

      // 3. Hash the password using better-auth's own scrypt hasher
      const hashed = await hashPassword(u.password)
      console.log(`  Hashed password for ${u.email}`)

      // 4. Generate a new account ID (better-auth uses nanoid-style IDs)
      const accountId = randomBytes(16).toString('base64url').slice(0, 22)

      // 5. Insert the credential account
      await client.query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())`,
        [accountId, userId, userId, hashed]
      )
      console.log(`  ✓ Created credential account for ${u.email}`)
    }
    console.log('\nDone.')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
