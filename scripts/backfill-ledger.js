#!/usr/bin/env node
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function run() {
  console.log('Backfilling schema_migrations ledger...')
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  for (const file of files) {
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [file]
    )
    console.log(`✓ Recorded ${file} in ledger`)
  }

  console.log('Ledger backfilled successfully!')
  await pool.end()
}

run().catch(err => {
  console.error('Failed to backfill ledger:', err)
  process.exit(1)
})
