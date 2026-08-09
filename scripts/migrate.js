#!/usr/bin/env node
/**
 * Database migration script
 * Runs all SQL files in migrations/ directory in order.
 *
 * Idempotent: tracks applied migrations in a `schema_migrations` ledger table
 * so re-running this script against an already-migrated database is a no-op
 * for files already recorded, regardless of whether the individual .sql file
 * itself has defensive IF NOT EXISTS guards.
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function ensureLedger() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function getAppliedMigrations() {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations')
  return new Set(rows.map(r => r.filename))
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  console.log('Running database migrations...')

  await ensureLedger()
  const applied = await getAppliedMigrations()

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- ${file} already applied, skipping`)
      continue
    }

    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf8')

    console.log(`Running migration: ${file}`)

    try {
      await pool.query(sql)
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [file]
      )
      console.log(`✓ ${file} completed`)
    } catch (error) {
      console.error(`✗ ${file} failed:`, error.message)
      process.exit(1)
    }
  }

  console.log('All migrations completed successfully')
  await pool.end()
}

runMigrations().catch(error => {
  console.error('Migration failed:', error)
  process.exit(1)
})
