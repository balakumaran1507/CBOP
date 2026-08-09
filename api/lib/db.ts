import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool, QueryResult, QueryResultRow } from 'pg'

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Test connection on startup
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database')
})

pool.on('error', (err) => {
  console.error('Unexpected database error:', err)
})

// ── Actor context (audit trail) ───────────────────────────────────────────────
// requireAuth establishes this once per request and every downstream call runs
// inside it. Two consumers:
//   1. api/lib/audit-log.ts — fills actor_id / actor_role when a caller does not
//      pass them explicitly.
//   2. transaction() below — publishes the actor to Postgres as the
//      transaction-local GUCs cbop.current_user_id / cbop.current_role, which is
//      what the cbop_write_audit_log() row trigger (migration 059) reads.
// Never set these per handler — the whole point is that it happens once, in
// shared middleware.

export interface ActorContext {
  userId: string | null
  role: string | null
  companyIds: string[]
}

const actorStore = new AsyncLocalStorage<ActorContext>()

/** Run fn with the given actor attached to the async context. */
export function runWithActorContext<T>(actor: ActorContext, fn: () => Promise<T>): Promise<T> {
  return actorStore.run(actor, fn)
}

/** The actor for the current request, or undefined outside a request (cron, n8n, MCP). */
export function getActorContext(): ActorContext | undefined {
  return actorStore.getStore()
}

/**
 * Execute a query against the database
 * @param text SQL query string
 * @param params Query parameters
 * @returns Query result
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now()
  try {
    const res = await pool.query<T>(text, params)
    const duration = Date.now() - start
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount })
    return res
  } catch (error) {
    console.error('Database query error:', error)
    throw error
  }
}

/**
 * Execute a transaction
 * @param callback Function that receives a client with transaction context
 * @returns Result from callback
 */
export async function transaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Publish the request actor to Postgres for the duration of this
    // transaction (third arg = is_local, so it is discarded at COMMIT/ROLLBACK
    // and can never leak to the next request that borrows this pooled client).
    const actor = actorStore.getStore()
    if (actor?.userId) {
      await client.query(
        `SELECT set_config('cbop.current_user_id', $1, true),
                set_config('cbop.current_role',    $2, true)`,
        [actor.userId, actor.role ?? '']
      )
    }

    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export { pool }
export default { query, transaction, pool }
