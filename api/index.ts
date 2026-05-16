import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Context, Next } from 'hono'
import { auth } from './lib/auth'
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
import settingsRoutes from './routes/settings'
import webhooksRoutes from './routes/webhooks'
import agentsRoutes from './routes/agents'

const app = new Hono()

// ── Rate limiter for /api/auth/* ──────────────────────────────────────────────
// 10 requests per 60s per IP — brute-force protection on login/signup endpoints

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
      return c.json({ error: 'Too many requests — try again in a minute' }, 429) as Response
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

// Security headers — applied to all responses
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
  ],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

// Rate-limit auth endpoints
app.use('/api/auth/*', authRateLimiter)

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'cbop-api' }))

// better-auth handles /api/auth/**
app.on(['GET', 'POST'], '/api/auth/**', (c) => auth.handler(c.req.raw))

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

// Slice 9: CEO Panel — Finance + Mentor Council
app.route('/', financeRoutes)
app.route('/', mentorRoutes)

// Slice 10: Settings — Team, Companies, System Jobs, Integrations
app.route('/', settingsRoutes)

// Slice 11: n8n webhook receivers — called by n8n after workflow completion
app.route('/', webhooksRoutes)
// Slice 12: OpenClaw agent trigger + cbop_control tool endpoints
app.route('/', agentsRoutes)

export default app
