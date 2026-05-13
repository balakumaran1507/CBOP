#!/usr/bin/env node
/**
 * Health check script
 * Verifies all services are running and accessible
 */

const http = require('http')
const { Pool } = require('pg')

const services = [
  { name: 'CBOP App', url: 'http://localhost:3003/api/health' },
  { name: 'n8n', url: 'http://localhost:5678' },
  { name: 'Outline', url: 'http://localhost:3000' },
  { name: 'Nextcloud', url: 'http://localhost:8080' },
  { name: 'Gitea', url: 'http://localhost:3001' },
  { name: 'Uptime Kuma', url: 'http://localhost:3002' },
  { name: 'Nginx Proxy Manager', url: 'http://localhost:81' },
]

async function checkHttp(name, url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      if (res.statusCode === 200 || res.statusCode === 302) {
        console.log(`✓ ${name} is running`)
        resolve(true)
      } else {
        console.log(`✗ ${name} returned status ${res.statusCode}`)
        resolve(false)
      }
    }).on('error', (err) => {
      console.log(`✗ ${name} is not accessible: ${err.message}`)
      resolve(false)
    })
  })
}

async function checkDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  try {
    const result = await pool.query('SELECT NOW()')
    console.log(`✓ PostgreSQL is running`)
    await pool.end()
    return true
  } catch (error) {
    console.log(`✗ PostgreSQL is not accessible: ${error.message}`)
    return false
  }
}

async function runHealthCheck() {
  console.log('Running health checks...\n')

  let allHealthy = true

  // Check database
  const dbHealthy = await checkDatabase()
  if (!dbHealthy) allHealthy = false

  // Check HTTP services
  for (const service of services) {
    const healthy = await checkHttp(service.name, service.url)
    if (!healthy) allHealthy = false
  }

  console.log('\n' + (allHealthy ? '✓ All services healthy' : '✗ Some services are down'))
  process.exit(allHealthy ? 0 : 1)
}

runHealthCheck()
