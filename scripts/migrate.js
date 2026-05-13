#!/usr/bin/env node
/**
 * Database migration script
 * Runs all SQL files in migrations/ directory in order
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

  console.log('Running database migrations...')

  for (const file of files) {
    const filePath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(filePath, 'utf8')

    console.log(`Running migration: ${file}`)

    try {
      await pool.query(sql)
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
