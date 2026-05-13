#!/usr/bin/env node
/**
 * Database seeding script
 * Seeds initial data for development/testing
 * Will be expanded in later slices
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

async function seed() {
  console.log('Seeding database...')

  try {
    // Seed data will be added in Slice 1
    // For now, companies are seeded in the migration file

    console.log('✓ Seed completed')
  } catch (error) {
    console.error('✗ Seed failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

seed()
