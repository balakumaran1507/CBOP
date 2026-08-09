import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Context, Next } from 'hono'
import { auth } from './lib/auth'
import { query } from './lib/db'
import { AUDIT_ACTIONS, writeAuditLogForRequest } from './lib/audit-log'
import sessionRoutes from './routes/session'
import dashboardRoutes from './routes/dashboard'
import dealsRoutes from './routes/deals'
import invoicesRoutes from './routes/invoices'
import leadsRoutes from './routes/leads'
import clientsRoutes from './routes/clients'
import projectsRoutes from './routes/projects'
import tasksRoutes from './routes/tasks'
import workSessionsRoutes from './routes/work-sessions'
import templatesRoutes from './routes/templates'
import financeRoutes from './routes/finance'
import mentorRoutes from './routes/mentor'
import ceoRoutes from './routes/ceo'
import settingsRoutes from './routes/settings'
import webhooksRoutes from './routes/webhooks'
import agentsRoutes from './routes/agents'
import internalRoutes from './routes/internal'
import mcpRoutes from './routes/mcp'
import hiringRoutes from './routes/hiring'
import hiringBatchesRoutes from './routes/hiring-batches'
import emailCampaignsRoutes from './routes/email-campaigns'
import documentsRoutes from './routes/documents'
import subscribersRoutes from './routes/subscribers'
import rndRoutes from './routes/rnd'
import emailStudioRoutes from './routes/email-studio'
import auditRoutes from './routes/audit'
import emailTrackRoutes from './routes/email-track'
import taxRoutes from './routes/tax'
import legalRoutes from './routes/legal'
import seoRoutes from './routes/seo'
import blogRoutes from './routes/blog'
import siteSettingsRoutes from './routes/site-settings'
import socialRoutes from './routes/social'
import goalsRoutes from './routes/goals'
import employeesRoutes from './routes/employees'
import departmentsRoutes from './routes/departments'
import notificationsRoutes from './routes/notifications'
import accountingRoutes from './routes/accounting'

const app = new Hono()

// ── Rate limiter for /api/auth/* ──────────────────────────────────────────────
// 10 requests per 60s per IP - brute-force protection on login/signup endpoints

const authRateMap = new Map<string, { count: number; resetAt: number }>()

async function authRateLimiter(c: Context, next: Next): Promise<Response | void> {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  const now      = Date.now()
  const windowMs = 60_000
  const maxReqs  = 10

  const entry = authRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    authRateMap.set(ip, { count: 1, resetAt: now + windowMs })
  } else {
    entry.count++
    if (entry.count > maxReqs) {
      // Lockout is an auditable auth event (DPDP / SOC 2 CC7): a burst of
      // failed logins from one IP is exactly the evidence an incident review
      // needs. Only the row that trips the limit is logged, not every
      // subsequent rejected request in the window.
      if (entry.count === maxReqs + 1) {
        void writeAuditLogForRequest(c, {
          action:       AUDIT_ACTIONS.authRateLimited,
          resourceType: 'route',
          resourceId:   `${c.req.method} ${c.req.path}`,
          after:        { reason: 'auth_rate_limit_exceeded', window_ms: windowMs, max_requests: maxReqs },
          ipAddress:    ip,
        })
      }
      return c.json({ error: 'Too many requests - try again in a minute' }, 429) as Response
    }
  }
  await next()
}

// Prune stale entries every 5 minutes so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of authRateMap) {
    if (now > entry.resetAt) authRateMap.delete(ip)
  }
}, 5 * 60_000)

app.use('*', logger())

// Security headers - applied to all responses
app.use('*', secureHeaders({
  strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
  xFrameOptions:           'DENY',
  xContentTypeOptions:     'nosniff',
  referrerPolicy:          'strict-origin-when-cross-origin',
  contentSecurityPolicy: {
    defaultSrc:  ["'self'"],
    scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
    imgSrc:      ["'self'", 'data:', 'blob:'],
    connectSrc:  ["'self'"],
    frameSrc:    ["'none'"],
    objectSrc:   ["'none'"],
    baseUri:     ["'self'"],
  },
}))

app.use('*', cors({
  origin: [
    process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003',
    'http://localhost:3003',
    'https://cbop.etherence.com',
    // CBOP Accounting (docs/modules/ACCOUNTING_Build_Plan.md) - a separate
    // Next.js app on its own subdomain, so its browser-side fetches to this
    // API are cross-origin even though the session cookie is shared via
    // crossSubDomainCookies (same-site != same-origin; CORS and SameSite are
    // independent checks and both must allow this). credentials: true below
    // plus this origin is what lets the shared cookie actually ride along.
    // Renamed 2026-08-07 from accounting.cbop.etherence.com: Cloudflare's free
    // Universal SSL only covers the apex + one wildcard level (*.etherence.com),
    // not a second level (*.cbop.etherence.com) - a two-label subdomain had no
    // valid edge cert at all. Flattened to a single label under etherence.com.
    'https://accounting.etherence.com',
    'http://localhost:3010',
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',').map(s => s.trim())
      : []),
  ],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'X-Active-Company-Id'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// Rate-limit auth endpoints
app.use('/api/auth/*', authRateLimiter)

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'cbop-api' }))

// better-auth handles all /api/auth/* routes.
//
// The handler is wrapped rather than called directly so that sign-in success,
// sign-in failure and sign-out land in audit_logs. better-auth owns the
// credential check, so the response status is the only honest signal of the
// outcome — we read it here instead of reaching into better-auth internals.
const AUDITED_AUTH_PATHS: Record<string, string> = {
  '/api/auth/sign-in/email':       'password',
  '/api/auth/sign-in/magic-link':  'magic_link',
  '/api/auth/sign-up/email':       'sign_up',
  '/api/auth/magic-link/verify':   'magic_link_verify',
  '/api/auth/sign-out':            'sign_out',
}

app.all('/api/auth/*', async (c) => {
  const req    = c.req.raw
  const path   = c.req.path
  const method = c.req.method

  const flow = AUDITED_AUTH_PATHS[path]
  if (!flow) return auth.handler(req)

  // Clone before better-auth consumes the body; only for the handful of paths
  // above, and failures are ignored so a malformed body can never break login.
  let email: string | undefined
  if (method === 'POST') {
    try {
      const body = (await req.clone().json()) as { email?: unknown }
      if (typeof body?.email === 'string') email = body.email.toLowerCase()
    } catch {
      // no/!json body — the event is still worth logging without an email
    }
  }

  const res = await auth.handler(req)
  const ok  = res.status >= 200 && res.status < 400

  const action =
    flow === 'sign_out'      ? AUDIT_ACTIONS.authSignOut
    : ok                     ? AUDIT_ACTIONS.authSignInSuccess
    :                          AUDIT_ACTIONS.authSignInFailure

  // Resolve the CBOP identity so the row carries actor_id/actor_role rather
  // than an email string only. Cheap: these paths are rare.
  let actorId: string | null = null
  let actorRole: string | null = null
  if (email && process.env.DATABASE_URL) {
    try {
      const found = await query(`SELECT id, role FROM users WHERE email = $1`, [email])
      if (found.rows.length > 0) {
        actorId   = found.rows[0].id as string
        actorRole = found.rows[0].role as string
      }
    } catch (err) {
      console.error('[audit] actor lookup failed for auth event', err)
    }
  }

  void writeAuditLogForRequest(c, {
    action,
    resourceType: 'auth',
    resourceId:   path,
    actorId,
    actorRole,
    after: { flow, email: email ?? null, status: res.status, ok },
  })

  return res
})

// Session data (role + companies from our users table)
app.route('/', sessionRoutes)

// Slice 2: Home dashboard data + mark-done stub
app.route('/', dashboardRoutes)

// Slice 3: Sales pipeline (deals, users, companies dropdowns)
app.route('/', dealsRoutes)

// Slice 4: Invoices + PDF
app.route('/', invoicesRoutes)

// Slice 5: Leads + Clients
app.route('/', leadsRoutes)
app.route('/', clientsRoutes)

// Slice 6: Tasks + Projects
app.route('/', projectsRoutes)
app.route('/', tasksRoutes)

// Slice 7: Work Sessions
app.route('/', workSessionsRoutes)

// Slice 8: Templates + PDF Export
app.route('/', templatesRoutes)

// Slice 9: CEO Panel - Finance + Mentor Council
app.route('/', financeRoutes)
app.route('/', mentorRoutes)
app.route('/', ceoRoutes)

// CBOP Accounting - double-entry ledger engine (docs/modules/ACCOUNTING_Build_Plan.md)
app.route('/', accountingRoutes)

// Slice 10: Settings - Team, Companies, System Jobs, Integrations
app.route('/', settingsRoutes)

// Slice 11: n8n webhook receivers - called by n8n after workflow completion
app.route('/', webhooksRoutes)
// Slice 12: OpenClaw agent trigger + cbop_control tool endpoints
app.route('/', agentsRoutes)

// Internal: email send endpoint for n8n (never expose externally)
app.route('/', internalRoutes)

// MCP server - OpenClaw connects here to use CBOP as a tool layer
app.route('/', mcpRoutes)

// Hiring module
app.route('/', hiringRoutes)
app.route('/', hiringBatchesRoutes)

// Email campaigns - bulk email with per-company sender routing
app.route('/', emailCampaignsRoutes)

// Document Studio - offer letters, certificates, bulk PDF generation
app.route('/', documentsRoutes)

// Email subscribers - pub/sub lists, suppression, public subscribe/unsubscribe
app.route('/', subscribersRoutes)

// R&D initiatives and log entries
app.route('/', rndRoutes)

// Email Studio - global email design library + send/activity log
app.route('/', emailStudioRoutes)
app.route('/', auditRoutes)
app.route('/', emailTrackRoutes)
app.route('/', taxRoutes)
app.route('/', legalRoutes)
app.route('/', seoRoutes)
app.route('/', blogRoutes)
app.route('/', siteSettingsRoutes)
app.route('/', socialRoutes)
app.route('/', goalsRoutes)

// Employee & Department Management
app.route('/', employeesRoutes)
app.route('/', departmentsRoutes)

// In-app notifications
app.route('/', notificationsRoutes)

export default app
